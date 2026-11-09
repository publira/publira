package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/paymentprovider"
)

// EventTypePurchaseRefundNotice tells the reader that a refund the payment
// provider made on one of their purchases has been recorded.
//
// It is queued in the transaction that records the refund, so a refund that
// commits always has its mail owed, and one that rolls back owes none. A
// refund made through the App Store or Google Play queues none: the store
// tells the reader itself.
const EventTypePurchaseRefundNotice = "purchase_refund_notice"

// PurchaseRefundNoticePayload is one refund as the write that recorded it
// left the purchase. The amounts travel in the event rather than being read
// again, because another refund recorded before the mail is sent would change
// what a later read says this one refunded. The worker reloads what was bought
// and who bought it.
type PurchaseRefundNoticePayload struct {
	TenantID   string `json:"tenant_id"`
	PurchaseID string `json:"purchase_id"`
	// RefundedAmount is what this refund added, and RefundedTotal what every
	// refund of the purchase adds up to with it, both in the minor unit of
	// Currency, the purchase's.
	RefundedAmount int64  `json:"refunded_amount"`
	RefundedTotal  int64  `json:"refunded_total"`
	Currency       string `json:"currency"`
	// Closed is whether the refunds have reached the price, which closes what
	// the purchase opened.
	Closed bool `json:"closed"`
}

// PurchaseRefundNoticeIdempotencyKey is the outbox key for the refund that
// brought a purchase's refunded total to refundedTotal. The total only grows,
// so it tells one refund in part from the next, and a redelivered
// notification from a second refund, as the tenant's purchase.refunded event
// does.
func PurchaseRefundNoticeIdempotencyKey(purchaseID uuid.UUID, refundedTotal int32) string {
	return EventTypePurchaseRefundNotice + ":" + purchaseID.String() + ":" + strconv.FormatInt(int64(refundedTotal), 10)
}

// NewPurchaseRefundNoticeEmailHandler sends the reader the mail of a refund,
// from the tenant's SMTP settings and in the tenant's language and time zone,
// whatever their notification settings say: it is about their money.
//
// A purchase whose reader's account is gone has nobody to send it to, and the
// event is dropped rather than retried.
func NewPurchaseRefundNoticeEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("purchase refund notice email"); err != nil {
			return err
		}
		tenantID, purchaseID, payload, err := purchaseRefundNoticePayload(event)
		if err != nil {
			return Permanent(err)
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}
		purchase, err := queries.GetPurchaseReceiptForTenant(ctx, dbmodels.GetPurchaseReceiptForTenantParams{
			TenantID: tenantID,
			ID:       purchaseID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("purchase %s no longer exists", purchaseID))
		}
		if err != nil {
			return fmt.Errorf("load the refunded purchase: %w", err)
		}
		recipient := strings.TrimSpace(purchase.ReaderEmail.String)
		if recipient == "" {
			if cfg.Logger != nil {
				cfg.Logger.WarnContext(ctx, "dropped a refund notice whose reader no longer has an account",
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

		return deliverEmail(ctx, cfg, delivery.settings, recipient, purchaseRefundNoticeEmailRequest(delivery, purchase, payload, libraryURL))
	}
}

// purchaseRefundNoticePayload takes the tenant from the event row and checks
// the payload agrees, as every tenant-scoped mail does.
func purchaseRefundNoticePayload(event dbmodels.OutboxEvent) (uuid.UUID, uuid.UUID, PurchaseRefundNoticePayload, error) {
	var payload PurchaseRefundNoticePayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, uuid.Nil, payload, fmt.Errorf("decode purchase refund notice payload: %w", err)
	}
	tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
	if err != nil {
		return uuid.Nil, uuid.Nil, payload, err
	}
	purchaseID, err := uuid.Parse(payload.PurchaseID)
	if err != nil {
		return uuid.Nil, uuid.Nil, payload, errors.New("purchase refund notice payload has an invalid purchase_id")
	}
	if payload.RefundedAmount <= 0 || payload.RefundedTotal < payload.RefundedAmount || strings.TrimSpace(payload.Currency) == "" {
		return uuid.Nil, uuid.Nil, payload, errors.New("purchase refund notice payload names no refund")
	}
	return tenantID, purchaseID, payload, nil
}

// purchaseRefundNoticeEmailRequest fills the mail in. What was bought is named
// as the receipt names it; the amounts are the refund's own, in the minor unit
// with their currency, beside the price paid, so the HTML part and the
// plain-text part each write them in the tenant's locale.
func purchaseRefundNoticeEmailRequest(
	delivery tenantDelivery,
	purchase dbmodels.GetPurchaseReceiptForTenantRow,
	refund PurchaseRefundNoticePayload,
	libraryURL string,
) emailrenderer.Request {
	return emailrenderer.Request{
		Template: "purchase_refund_notice",
		Locale:   delivery.locale,
		Data: map[string]any{
			"amount":                      refund.RefundedAmount,
			"refunded_total":              refund.RefundedTotal,
			"price":                       int64(purchase.PriceAtPurchase),
			"currency":                    refund.Currency,
			"closed":                      refund.Closed,
			"episode_title":               purchase.EpisodeTitle,
			"volume_title":                purchase.VolumeTitle,
			"series_bundle_episode_count": int64(purchase.SeriesBundleEpisodeCount),
			"coin_pack_coins":             int64(purchase.CoinPackCoins),
			"coin_pack_bonus_coins":       int64(purchase.CoinPackBonusCoins),
			"coin_name":                   purchase.CoinName,
			"is_test":                     purchase.IsTest,
			"is_tip":                      purchase.Kind == string(paymentprovider.KindTip),
			"library_url":                 libraryURL,
			"series_title":                purchase.SeriesTitle,
			"tenant_name":                 delivery.tenantName,
		},
		TimeZone: delivery.timeZone,
	}
}
