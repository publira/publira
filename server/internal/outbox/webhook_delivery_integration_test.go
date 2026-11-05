package outbox_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/tenantwebhooks"
	"github.com/publira/publira/server/internal/testutil"
)

type webhookEnv struct {
	pg        *testutil.PostgresEnv
	queries   *dbmodels.Queries
	encryptor *secretcrypto.Manager
	tenantID  uuid.UUID
}

func newWebhookEnv(t *testing.T) webhookEnv {
	t.Helper()
	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "OUTBOXWH001", "outbox-webhook.example.com", "Outbox Webhook Tenant")
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"test": make([]byte, 32)}, "test")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return webhookEnv{pg: pg, queries: dbmodels.New(pg.DB), encryptor: encryptor, tenantID: tenant.ID}
}

// endpoint saves an endpoint at url and owes it a test event, answering the
// delivery's id and the outbox event that sends it.
func (e webhookEnv) endpoint(t *testing.T, ctx context.Context, url string) (uuid.UUID, dbmodels.OutboxEvent) {
	t.Helper()
	secret, err := tenantwebhooks.NewSecret()
	if err != nil {
		t.Fatalf("NewSecret: %v", err)
	}
	sealed, err := e.encryptor.EncryptString(secret)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	endpoint, err := e.queries.CreateTenantWebhookEndpoint(ctx, dbmodels.CreateTenantWebhookEndpointParams{
		ID:              uuid.Must(uuid.NewV7()),
		TenantID:        e.tenantID,
		Url:             url,
		SecretEncrypted: sealed,
		SecretHint:      "whsec_••••",
		EventTypes:      []string{tenantwebhooks.EventPurchaseCompleted},
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("CreateTenantWebhookEndpoint: %v", err)
	}
	deliveryID, err := tenantwebhooks.QueueTest(ctx, e.queries, e.tenantID, endpoint.ID)
	if err != nil {
		t.Fatalf("QueueTest: %v", err)
	}
	return deliveryID, e.event(t, ctx, deliveryID)
}

// event is the newest outbox event that sends deliveryID.
func (e webhookEnv) event(t *testing.T, ctx context.Context, deliveryID uuid.UUID) dbmodels.OutboxEvent {
	t.Helper()
	var id uuid.UUID
	if err := e.pg.DB.QueryRowContext(ctx, `
		SELECT id FROM outbox_events
		WHERE event_type = $1 AND payload->>'delivery_id' = $2
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`, outbox.EventTypeWebhookDelivery, deliveryID.String()).Scan(&id); err != nil {
		t.Fatalf("read the event of delivery %s: %v", deliveryID, err)
	}
	event, err := e.queries.GetOutboxEvent(ctx, id)
	if err != nil {
		t.Fatalf("GetOutboxEvent: %v", err)
	}
	return event
}

func (e webhookEnv) delivery(t *testing.T, ctx context.Context, id uuid.UUID) dbmodels.WebhookDelivery {
	t.Helper()
	row, err := e.queries.GetWebhookDeliveryForUpdate(ctx, dbmodels.GetWebhookDeliveryForUpdateParams{TenantID: e.tenantID, ID: id})
	if err != nil {
		t.Fatalf("read delivery: %v", err)
	}
	return row
}

// An endpoint that answers 500 is tried again, each attempt recorded, until
// the budget of its own runs out and the delivery is dead; resent, it is owed
// again, and delivered once the endpoint answers.
func TestWebhookDeliveryIsRetriedUntilDeadAndCanBeResent(t *testing.T) {
	t.Parallel()

	env := newWebhookEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	var healthy atomic.Bool
	var calls atomic.Int32
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		if healthy.Load() {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(receiver.Close)
	deliveryID, event := env.endpoint(t, ctx, receiver.URL)

	handlers := outbox.NewRegistry()
	handlers.RegisterWithAttempts(outbox.EventTypeWebhookDelivery, outbox.NewWebhookDeliveryHandler(outbox.WebhookDeliveryHandlerConfig{
		DB:        env.pg.DB,
		Encryptor: env.encryptor,
		Client:    receiver.Client(),
	}), tenantwebhooks.MaxAttempts)
	// The default budget is spent long before the webhook's own.
	startTestWorker(t, env.pg.DB, outbox.Config{Handlers: handlers, MaxAttempts: 3})

	dead := waitStatus(t, ctx, env.queries, event.ID, outbox.StatusDead)
	if dead.Attempts != tenantwebhooks.MaxAttempts {
		t.Fatalf("outbox attempts = %d, want %d", dead.Attempts, tenantwebhooks.MaxAttempts)
	}
	delivery := env.delivery(t, ctx, deliveryID)
	if delivery.Status != tenantwebhooks.StatusDead || delivery.Attempts != tenantwebhooks.MaxAttempts || delivery.LastStatusCode.Int32 != http.StatusInternalServerError || delivery.LastError.String == "" {
		t.Fatalf("delivery = %s after %d attempts (last %d, %q), want dead after %d attempts at 500", delivery.Status, delivery.Attempts, delivery.LastStatusCode.Int32, delivery.LastError.String, tenantwebhooks.MaxAttempts)
	}
	if got := calls.Load(); got != tenantwebhooks.MaxAttempts {
		t.Fatalf("the endpoint was called %d times, want %d", got, tenantwebhooks.MaxAttempts)
	}

	healthy.Store(true)
	if err := env.queries.ResendWebhookDelivery(ctx, dbmodels.ResendWebhookDeliveryParams{TenantID: env.tenantID, ID: deliveryID}); err != nil {
		t.Fatalf("ResendWebhookDelivery: %v", err)
	}
	if err := tenantwebhooks.QueueResend(ctx, env.queries, env.tenantID, deliveryID); err != nil {
		t.Fatalf("QueueResend: %v", err)
	}
	resent := env.event(t, ctx, deliveryID)
	if resent.ID == event.ID {
		t.Fatal("the resend wrote no outbox event of its own")
	}
	waitStatus(t, ctx, env.queries, resent.ID, outbox.StatusDone)
	delivery = env.delivery(t, ctx, deliveryID)
	if delivery.Status != tenantwebhooks.StatusDelivered || !delivery.DeliveredAt.Valid || delivery.Attempts != tenantwebhooks.MaxAttempts+1 {
		t.Fatalf("resent delivery = %s after %d attempts, want delivered after %d", delivery.Status, delivery.Attempts, tenantwebhooks.MaxAttempts+1)
	}
}

// What the endpoint refuses for good, and a host on a restricted address, are
// given up on the first attempt; a timeout and a 429 are tried again.
func TestWebhookDeliveryGivesUpWhatNoRetryCanFix(t *testing.T) {
	t.Parallel()

	env := newWebhookEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for name, tc := range map[string]struct {
		status    int
		permanent bool
	}{
		"400": {status: http.StatusBadRequest, permanent: true},
		"410": {status: http.StatusGone, permanent: true},
		"408": {status: http.StatusRequestTimeout},
		"429": {status: http.StatusTooManyRequests},
		"503": {status: http.StatusServiceUnavailable},
		"3xx": {status: http.StatusFound},
		"2xx": {status: http.StatusAccepted},
	} {
		receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
		}))
		deliveryID, event := env.endpoint(t, ctx, receiver.URL)
		handler := outbox.NewWebhookDeliveryHandler(outbox.WebhookDeliveryHandlerConfig{DB: env.pg.DB, Encryptor: env.encryptor, Client: receiver.Client()})
		err := handler(ctx, event)
		receiver.Close()
		delivery := env.delivery(t, ctx, deliveryID)
		switch {
		case tc.status/100 == 2:
			if err != nil || delivery.Status != tenantwebhooks.StatusDelivered {
				t.Errorf("%s: err = %v, status = %s, want delivered", name, err, delivery.Status)
			}
		case tc.permanent:
			if !outbox.IsPermanent(err) || delivery.Status != tenantwebhooks.StatusDead {
				t.Errorf("%s: err = %v, status = %s, want given up", name, err, delivery.Status)
			}
		default:
			if err == nil || outbox.IsPermanent(err) || delivery.Status != tenantwebhooks.StatusFailed {
				t.Errorf("%s: err = %v, status = %s, want tried again", name, err, delivery.Status)
			}
		}
	}

	// The default client dials public addresses alone, and the test server is
	// on the loopback one.
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("a delivery reached a loopback address")
	}))
	t.Cleanup(receiver.Close)
	deliveryID, event := env.endpoint(t, ctx, receiver.URL)
	err := outbox.NewWebhookDeliveryHandler(outbox.WebhookDeliveryHandlerConfig{DB: env.pg.DB, Encryptor: env.encryptor})(ctx, event)
	if !outbox.IsPermanent(err) {
		t.Fatalf("delivery to a loopback address = %v, want it given up", err)
	}
	if delivery := env.delivery(t, ctx, deliveryID); delivery.Status != tenantwebhooks.StatusDead {
		t.Fatalf("delivery to a loopback address = %s, want dead", delivery.Status)
	}

	// So is a private address, which no attempt ever dials.
	deliveryID, event = env.endpoint(t, ctx, "https://10.0.0.1/hook")
	err = outbox.NewWebhookDeliveryHandler(outbox.WebhookDeliveryHandlerConfig{DB: env.pg.DB, Encryptor: env.encryptor})(ctx, event)
	if !outbox.IsPermanent(err) {
		t.Fatalf("delivery to a private address = %v, want it given up", err)
	}
	if delivery := env.delivery(t, ctx, deliveryID); delivery.Status != tenantwebhooks.StatusDead {
		t.Fatalf("delivery to a private address = %s, want dead", delivery.Status)
	}
}

// The operator's allowed addresses reach the client the handler sends with:
// the receiver's certificate, which that client does not trust, is what stops
// this delivery, and that is tried again rather than given up.
func TestWebhookDeliveryToAnAllowedAddressIsAttempted(t *testing.T) {
	t.Parallel()

	env := newWebhookEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("a delivery was sent to a server with an untrusted certificate")
	}))
	t.Cleanup(receiver.Close)
	deliveryID, event := env.endpoint(t, ctx, receiver.URL)
	err := outbox.NewWebhookDeliveryHandler(outbox.WebhookDeliveryHandlerConfig{
		DB:               env.pg.DB,
		Encryptor:        env.encryptor,
		AllowedAddresses: []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")},
	})(ctx, event)
	if err == nil || outbox.IsPermanent(err) || errors.Is(err, tenantwebhooks.ErrRestrictedAddress) {
		t.Fatalf("delivery to an allowed address = %v, want it tried again", err)
	}
	if delivery := env.delivery(t, ctx, deliveryID); delivery.Status != tenantwebhooks.StatusFailed {
		t.Fatalf("delivery to an allowed address = %s, want failed", delivery.Status)
	}
}

// A delivery queued before its endpoint was disabled is given up unsent; a
// test is sent whatever the endpoint is set to.
func TestWebhookDeliveryToADisabledEndpointIsGivenUp(t *testing.T) {
	t.Parallel()

	env := newWebhookEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var calls atomic.Int32
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
	}))
	t.Cleanup(receiver.Close)
	testID, testEvent := env.endpoint(t, ctx, receiver.URL)
	var endpointID uuid.UUID
	if err := env.pg.DB.QueryRowContext(ctx, `UPDATE tenant_webhook_endpoints SET enabled = false WHERE tenant_id = $1 RETURNING id`, env.tenantID).Scan(&endpointID); err != nil {
		t.Fatalf("disable the endpoint: %v", err)
	}
	purchaseID := uuid.Must(uuid.NewV7())
	if _, err := env.pg.DB.ExecContext(ctx, `
		INSERT INTO webhook_deliveries (id, tenant_id, endpoint_id, event_type, event_id, payload)
		VALUES ($1, $2, $3, 'purchase.completed', 'evt_disabled', '{}')
	`, purchaseID, env.tenantID, endpointID); err != nil {
		t.Fatalf("owe a delivery: %v", err)
	}
	if err := tenantwebhooks.QueueResend(ctx, env.queries, env.tenantID, purchaseID); err != nil {
		t.Fatalf("QueueResend: %v", err)
	}

	handler := outbox.NewWebhookDeliveryHandler(outbox.WebhookDeliveryHandlerConfig{DB: env.pg.DB, Encryptor: env.encryptor, Client: receiver.Client()})
	if err := handler(ctx, env.event(t, ctx, purchaseID)); err != nil {
		t.Fatalf("deliver to a disabled endpoint: %v", err)
	}
	if delivery := env.delivery(t, ctx, purchaseID); delivery.Status != tenantwebhooks.StatusDead || delivery.Attempts != 0 {
		t.Fatalf("delivery to a disabled endpoint = %s after %d attempts, want given up unsent", delivery.Status, delivery.Attempts)
	}
	if err := handler(ctx, testEvent); err != nil {
		t.Fatalf("send a test to a disabled endpoint: %v", err)
	}
	if delivery := env.delivery(t, ctx, testID); delivery.Status != tenantwebhooks.StatusDelivered {
		t.Fatalf("test to a disabled endpoint = %s, want delivered", delivery.Status)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("the endpoint was called %d times, want the test alone", got)
	}
}

// A worker that does not hold the key the endpoint's secret was sealed with
// leaves the delivery waiting without spending an attempt, so restoring the
// key resumes it.
func TestWebhookDeliveryWaitsForAMissingSecretKey(t *testing.T) {
	t.Parallel()

	env := newWebhookEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("a delivery was sent unsigned")
	}))
	t.Cleanup(receiver.Close)
	deliveryID, event := env.endpoint(t, ctx, receiver.URL)
	other, err := secretcrypto.NewManager(map[string][]byte{"other": make([]byte, 32)}, "other")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	for name, cfg := range map[string]outbox.WebhookDeliveryHandlerConfig{
		"no keys":         {DB: env.pg.DB, Client: receiver.Client()},
		"another key set": {DB: env.pg.DB, Encryptor: other, Client: receiver.Client()},
	} {
		err := outbox.NewWebhookDeliveryHandler(cfg)(ctx, event)
		if !outbox.IsBlocked(err) {
			t.Errorf("%s: err = %v, want the delivery blocked", name, err)
		}
		if delivery := env.delivery(t, ctx, deliveryID); delivery.Status != tenantwebhooks.StatusPending || delivery.Attempts != 0 {
			t.Errorf("%s: delivery = %s after %d attempts, want pending and unattempted", name, delivery.Status, delivery.Attempts)
		}
	}
}
