package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/paymentsettings"
)

// EventTypeGooglePlayPurchaseConsume consumes a Google Play purchase the
// server has recorded. It is queued in the transaction that records the
// purchase, because Google Play refunds a purchase nobody acknowledged within
// three days, and a consumable nobody consumed cannot be bought again: the
// next episode at the same price would be refused as already owned.
const EventTypeGooglePlayPurchaseConsume = "google_play_purchase_consume"

// GooglePlayPurchaseConsumePayload names the purchase by what the Developer
// API looks it up by.
type GooglePlayPurchaseConsumePayload struct {
	TenantID      string `json:"tenant_id"`
	PurchaseID    string `json:"purchase_id"`
	ProductID     string `json:"product_id"`
	PurchaseToken string `json:"purchase_token"`
}

// GooglePlayPurchases is the part of the Google Play Developer API the
// handler calls.
type GooglePlayPurchases interface {
	GetProductPurchase(ctx context.Context, serviceAccountKey []byte, packageName, productID, token string) (googleplay.ProductPurchase, error)
	ConsumeProductPurchase(ctx context.Context, serviceAccountKey []byte, packageName, productID, token string) error
}

// GooglePlayHandlerConfig is what the worker resolves once at startup for the
// consume handler. The tenant's credentials are read per event.
type GooglePlayHandlerConfig struct {
	DB        *sql.DB
	Encryptor paymentsettings.SecretManager
	Purchases GooglePlayPurchases
	Logger    *slog.Logger
}

// NewGooglePlayPurchaseConsumeHandler consumes the purchase an event names.
func NewGooglePlayPurchaseConsumeHandler(cfg GooglePlayHandlerConfig) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil || cfg.Purchases == nil {
			return errors.New("google play purchase handler is not configured")
		}
		var payload GooglePlayPurchaseConsumePayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode google play purchase payload: %w", err))
		}
		tenantID, err := uuid.Parse(strings.TrimSpace(payload.TenantID))
		if err != nil || !event.TenantID.Valid || event.TenantID.UUID != tenantID {
			return Permanent(errors.New("google play purchase payload names another tenant than its event"))
		}
		if payload.ProductID == "" || payload.PurchaseToken == "" {
			return Permanent(errors.New("google play purchase payload names no purchase"))
		}

		// A tenant that switched Google Play off or broke its key is retried
		// rather than dropped: the reader paid, and the purchase is refunded
		// unless someone restores the credentials before the three days are out.
		credentials, err := paymentsettings.NewAppStores(dbmodels.New(cfg.DB), cfg.Encryptor).LoadGooglePlayCredentials(ctx, tenantID)
		if err != nil {
			return fmt.Errorf("load google play credentials: %w", err)
		}
		key := []byte(credentials.ServiceAccountKey)

		purchase, err := cfg.Purchases.GetProductPurchase(ctx, key, credentials.PackageName, payload.ProductID, payload.PurchaseToken)
		if errors.Is(err, googleplay.ErrPurchaseNotFound) {
			return Permanent(err)
		}
		if err != nil {
			return fmt.Errorf("get google play purchase: %w", err)
		}
		// The app may have consumed it first, and a repeated delivery finds it
		// consumed by the first.
		if purchase.ConsumptionState == googleplay.ConsumptionStateConsumed {
			return nil
		}
		err = cfg.Purchases.ConsumeProductPurchase(ctx, key, credentials.PackageName, payload.ProductID, payload.PurchaseToken)
		if errors.Is(err, googleplay.ErrPurchaseNotFound) {
			return Permanent(err)
		}
		if err != nil {
			return fmt.Errorf("consume google play purchase: %w", err)
		}
		if cfg.Logger != nil {
			cfg.Logger.InfoContext(ctx, "consumed a google play purchase",
				"tenant_id", tenantID,
				"purchase_id", payload.PurchaseID,
				"outbox_event_id", event.ID,
			)
		}
		return nil
	}
}
