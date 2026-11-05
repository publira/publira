package outbox

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/buildinfo"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/tenantwebhooks"
)

// EventTypeWebhookDelivery sends one event to one of a tenant's webhook
// endpoints. It is written with the webhook_deliveries row it sends, in the
// transaction that records the change the event is about, and written again by
// a resend.
const EventTypeWebhookDelivery = tenantwebhooks.OutboxEventType

// webhookTimeout bounds one attempt, the answer included. An endpoint that
// takes longer is tried again.
const webhookTimeout = 10 * time.Second

// WebhookDeliveryHandlerConfig is what the webhook delivery handler needs.
type WebhookDeliveryHandlerConfig struct {
	DB        *sql.DB
	Encryptor emailsettings.SecretManager
	Logger    *slog.Logger
	// Client sends the deliveries. Nil is [tenantwebhooks.NewHTTPClient] with
	// AllowedAddresses; a test sending to a server on the loopback address
	// hands its own.
	Client *http.Client
	// AllowedAddresses are the addresses a delivery may reach besides public
	// ones. Empty leaves it public addresses alone.
	AllowedAddresses []netip.Prefix
	// Now is the clock the signature's timestamp is read from. Nil is
	// time.Now.
	Now func() time.Time
}

// NewWebhookDeliveryHandler POSTs a delivery's body to its endpoint, signed
// with the endpoint's secret as it stands now, and records the attempt on the
// delivery. A 2xx answer delivers it. Any other 4xx but 408 and 429 means the
// endpoint will not take it however often it is sent, and gives it up, as
// does a host that resolves to a restricted address; everything else is tried
// again, until [tenantwebhooks.MaxAttempts] attempts have been made, the
// budget the worker registers this event type with.
//
// A delivery whose endpoint was deleted is gone with it, and one already
// delivered is not sent again. A delivery whose endpoint was disabled after it
// was queued is given up without an attempt.
func NewWebhookDeliveryHandler(cfg WebhookDeliveryHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	client := cfg.Client
	if client == nil {
		client = tenantwebhooks.NewHTTPClient(webhookTimeout, cfg.AllowedAddresses)
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil {
			return errors.New("webhook delivery handler database is not configured")
		}
		var payload tenantwebhooks.OutboxPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode webhook delivery payload: %w", err))
		}
		tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
		if err != nil {
			return Permanent(err)
		}
		deliveryID, err := uuid.Parse(payload.DeliveryID)
		if err != nil {
			return Permanent(fmt.Errorf("webhook delivery payload has an invalid delivery_id: %w", err))
		}

		delivery, err := queries.GetWebhookDeliveryToSend(ctx, dbmodels.GetWebhookDeliveryToSendParams{TenantID: tenantID, ID: deliveryID})
		if errors.Is(err, sql.ErrNoRows) {
			logger.InfoContext(ctx, "dropped a webhook delivery whose endpoint was deleted", "tenant_id", tenantID, "delivery_id", deliveryID)
			return nil
		}
		if err != nil {
			return giveUpOnLastAttempt(ctx, queries, event, tenantID, deliveryID, fmt.Errorf("load webhook delivery: %w", err))
		}
		if delivery.Status == tenantwebhooks.StatusDelivered {
			return nil
		}
		// A test is sent whatever the endpoint is set to, which is the point of
		// it; anything else waits on an endpoint that is switched on.
		if !delivery.Enabled && delivery.EventType != tenantwebhooks.EventTest {
			if err := queries.GiveUpWebhookDelivery(ctx, dbmodels.GiveUpWebhookDeliveryParams{
				TenantID:  tenantID,
				ID:        deliveryID,
				LastError: sql.NullString{String: "the endpoint is disabled", Valid: true},
			}); err != nil {
				return fmt.Errorf("give up a webhook delivery: %w", err)
			}
			return nil
		}
		// A key the worker does not hold is the operator's to restore, and no
		// attempt brings it back, so the delivery waits for it without spending
		// its budget.
		if cfg.Encryptor == nil {
			return Blocked(errors.New("webhook delivery handler has no secret encryption keys to open the endpoint's secret with"))
		}
		secret, err := cfg.Encryptor.DecryptString(delivery.SecretEncrypted)
		if err != nil {
			return Blocked(fmt.Errorf("open the endpoint's webhook secret: %w", err))
		}

		status, sendErr := sendWebhook(ctx, client, delivery, secret, now())
		final := sendErr != nil && (IsPermanent(sendErr) || int(event.Attempts)+1 >= tenantwebhooks.MaxAttempts)
		record := dbmodels.RecordWebhookDeliveryAttemptParams{
			TenantID: tenantID,
			ID:       deliveryID,
			Status:   tenantwebhooks.StatusDelivered,
		}
		if status != 0 {
			record.LastStatusCode = sql.NullInt32{Int32: int32(status), Valid: true}
		}
		switch {
		case sendErr == nil:
		case final:
			record.Status = tenantwebhooks.StatusDead
			record.LastError = lastErrorValue(sendErr)
		default:
			record.Status = tenantwebhooks.StatusFailed
			record.LastError = lastErrorValue(sendErr)
		}
		if err := queries.RecordWebhookDeliveryAttempt(ctx, record); err != nil {
			return giveUpOnLastAttempt(ctx, queries, event, tenantID, deliveryID, fmt.Errorf("record a webhook delivery attempt: %w", err))
		}
		return sendErr
	}
}

// giveUpOnLastAttempt answers herr, a failure no send was recorded for, and
// marks the delivery dead first when it is the attempt that spends the
// budget: the outbox event dies with it, and a delivery left pending or failed
// would be one ResendWebhookDelivery refuses, so nothing could owe it again.
func giveUpOnLastAttempt(ctx context.Context, queries *dbmodels.Queries, event dbmodels.OutboxEvent, tenantID, deliveryID uuid.UUID, herr error) error {
	if int(event.Attempts)+1 < tenantwebhooks.MaxAttempts {
		return herr
	}
	if err := queries.GiveUpWebhookDelivery(ctx, dbmodels.GiveUpWebhookDeliveryParams{
		TenantID:  tenantID,
		ID:        deliveryID,
		LastError: lastErrorValue(herr),
	}); err != nil {
		return errors.Join(herr, fmt.Errorf("give up a webhook delivery: %w", err))
	}
	return herr
}

// sendWebhook makes one attempt at a delivery and answers the HTTP status it
// got, 0 for none.
func sendWebhook(ctx context.Context, client *http.Client, delivery dbmodels.GetWebhookDeliveryToSendRow, secret string, at time.Time) (int, error) {
	body := []byte(delivery.Payload)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, delivery.Url, bytes.NewReader(body))
	if err != nil {
		return 0, Permanent(fmt.Errorf("build the webhook request: %w", err))
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "Publira-Webhooks/"+buildinfo.Version())
	request.Header.Set(tenantwebhooks.HeaderSignature, tenantwebhooks.Sign(secret, at, body))
	request.Header.Set(tenantwebhooks.HeaderEvent, delivery.EventType)
	request.Header.Set(tenantwebhooks.HeaderDelivery, delivery.ID.String())

	response, err := client.Do(request)
	if err != nil {
		if errors.Is(err, tenantwebhooks.ErrRestrictedAddress) {
			return 0, Permanent(tenantwebhooks.ErrRestrictedAddress)
		}
		return 0, fmt.Errorf("send the webhook: %w", err)
	}
	defer response.Body.Close() //nolint:errcheck
	// What the endpoint answers is of no use beyond its status; reading a
	// little of it lets the connection be kept.
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))

	code := response.StatusCode
	switch {
	case code >= 200 && code < 300:
		return code, nil
	case code >= 400 && code < 500 && code != http.StatusRequestTimeout && code != http.StatusTooManyRequests:
		return code, Permanent(fmt.Errorf("the endpoint answered HTTP %d", code))
	default:
		return code, fmt.Errorf("the endpoint answered HTTP %d", code)
	}
}
