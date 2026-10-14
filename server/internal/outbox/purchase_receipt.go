package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
)

// EventTypePurchaseReceipt sends the reader the receipt of one purchase.
//
// It is queued in the transaction that records the purchase from the payment
// provider's notification, so a purchase that commits always has its receipt
// owed, and one that rolls back owes none.
const EventTypePurchaseReceipt = "purchase_receipt"

// PurchaseReceiptPayload names the purchase the receipt is for. The
// worker reloads it, so the receipt states what was stored rather than what
// the notification claimed.
type PurchaseReceiptPayload struct {
	TenantID   string `json:"tenant_id"`
	PurchaseID string `json:"purchase_id"`
}

// PurchaseReceiptIdempotencyKey is the outbox key for one purchase's
// receipt. It names the purchase, so however often the provider redelivers the
// notification that created it, one purchase is one receipt.
func PurchaseReceiptIdempotencyKey(purchaseID uuid.UUID) string {
	return EventTypePurchaseReceipt + ":" + purchaseID.String()
}

// libraryPath is the storefront page that lists what the reader has bought.
const libraryPath = "/my/library"

// NewPurchaseReceiptEmailHandler sends the reader the receipt of a purchase,
// from the tenant's SMTP settings and in the tenant's language and time zone.
//
// A purchase whose reader's account is gone has nobody to send the receipt to,
// and the event is dropped rather than retried.
func NewPurchaseReceiptEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("purchase receipt email"); err != nil {
			return err
		}
		tenantID, purchaseID, err := purchaseReceiptEmailIDs(event)
		if err != nil {
			return Permanent(err)
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}
		receipt, err := queries.GetPurchaseReceiptForTenant(ctx, dbmodels.GetPurchaseReceiptForTenantParams{
			TenantID: tenantID,
			ID:       purchaseID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("purchase %s no longer exists", purchaseID))
		}
		if err != nil {
			return fmt.Errorf("load purchase receipt: %w", err)
		}
		recipient := strings.TrimSpace(receipt.ReaderEmail.String)
		if recipient == "" {
			if cfg.Logger != nil {
				cfg.Logger.WarnContext(ctx, "dropped a purchase receipt whose reader no longer has an account",
					"event_id", event.ID,
					"tenant_id", tenantID,
					"purchase_id", purchaseID,
				)
			}
			return nil
		}
		libraryURL, err := tenantSiteURL(delivery.tenant, libraryPath)
		if err != nil {
			return fmt.Errorf("build library url: %w", err)
		}

		return deliverEmail(ctx, cfg, delivery.settings, recipient, purchaseReceiptEmailRequest(delivery, receipt, libraryURL))
	}
}

// purchaseReceiptEmailIDs takes the tenant from the event row and checks the
// payload agrees, as every tenant-scoped mail does.
func purchaseReceiptEmailIDs(event dbmodels.OutboxEvent) (uuid.UUID, uuid.UUID, error) {
	var payload PurchaseReceiptPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("decode purchase receipt email payload: %w", err)
	}
	tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	purchaseID, err := uuid.Parse(payload.PurchaseID)
	if err != nil {
		return uuid.Nil, uuid.Nil, errors.New("purchase receipt email payload has an invalid purchase_id")
	}
	return tenantID, purchaseID, nil
}

// purchaseReceiptEmailRequest fills the receipt in. The amount travels in the
// minor unit with its currency, and the instants as RFC 3339, so the HTML part
// and the plain-text part each write them in the tenant's locale and zone. A
// purchase with no reading period reaches the mail with an empty expires_at,
// which is what the copy leaves the line out on, and a purchase paid in the
// provider's test mode with is_test, which the copy says took no money.
func purchaseReceiptEmailRequest(
	delivery tenantDelivery,
	receipt dbmodels.GetPurchaseReceiptForTenantRow,
	libraryURL string,
) emailrenderer.Request {
	expiresAt := ""
	if receipt.ExpiresAt.Valid {
		expiresAt = receipt.ExpiresAt.Time.UTC().Format(time.RFC3339Nano)
	}
	return emailrenderer.Request{
		Template: "purchase_receipt",
		Locale:   delivery.locale,
		Data: map[string]any{
			"amount":        int64(receipt.PriceAtPurchase),
			"currency":      receipt.Currency,
			"episode_title": receipt.EpisodeTitle,
			"expires_at":    expiresAt,
			"is_test":       receipt.IsTest,
			"library_url":   libraryURL,
			"purchased_at":  receipt.PurchasedAt.UTC().Format(time.RFC3339Nano),
			"series_title":  receipt.SeriesTitle,
			"tenant_name":   delivery.tenantName,
		},
		TimeZone: delivery.timeZone,
	}
}
