package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stripe/stripe-go/v86"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// refundWebhookEnv is one tenant with Stripe settings, one buyer, and one paid
// episode that buyer already paid for through Checkout, wired to a running
// public API.
type refundWebhookEnv struct {
	pg      *testutil.PostgresEnv
	client  publirav1connect.PurchaseServiceClient
	tenant  testutil.Tenant
	user    testutil.TenantUser
	episode testutil.Episode
	queries *dbmodels.Queries
}

func newRefundWebhookEnv(t *testing.T, slug, domain, paymentIntentID string) refundWebhookEnv {
	t.Helper()
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, slug, domain, "Refund tenant")
	user := pg.SeedEndUser(t, tenant.ID, "REFUNDBUYER1", "refund-buyer@example.com", "Refund buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store := paymentsettings.New(dbmodels.New(pg.DB), encryptor, nil, slog.Default())
	if _, err := store.Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Enabled:                 true,
		SecretKey:               testCheckoutSecretKey,
		SecretKeyUpdateMode:     paymentsettings.SecretUpdateModeReplace,
		WebhookSecret:           testCheckoutWebhookSecret,
		WebhookSecretUpdateMode: paymentsettings.SecretUpdateModeReplace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), &testStorageProvider{}, encryptor, testutil.TokenManager(), slog.Default(), readerGuards{}, nil)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)

	env := refundWebhookEnv{
		pg:      pg,
		client:  publirav1connect.NewPurchaseServiceClient(ts.Client(), ts.URL),
		tenant:  tenant,
		user:    user,
		episode: episode,
		queries: dbmodels.New(pg.DB),
	}
	env.deliver(t, string(stripe.EventTypeCheckoutSessionCompleted), map[string]any{
		"id":             "cs_" + paymentIntentID,
		"object":         "checkout.session",
		"amount_total":   500,
		"currency":       "jpy",
		"payment_status": "paid",
		"payment_intent": paymentIntentID,
		"metadata": map[string]string{
			stripeMetadataTenantID:  tenant.ID.String(),
			stripeMetadataUserID:    user.ID.String(),
			stripeMetadataEpisodeID: episode.ID.String(),
			stripeMetadataPrice:     "500",
		},
	})
	return env
}

func (e refundWebhookEnv) deliver(t *testing.T, eventType string, object map[string]any) {
	t.Helper()
	payload, signature := signedStripeEvent(t, testCheckoutWebhookSecret, eventType, object)
	if _, err := e.client.ProcessStripeWebhook(context.Background(), connect.NewRequest(&publirav1.ProcessStripeWebhookRequest{
		Payload:         payload,
		StripeSignature: signature,
		Tenant:          &publirattypesv1.TenantContext{TenantId: e.tenant.ID.String()},
	})); err != nil {
		t.Fatalf("ProcessStripeWebhook(%s): %v", eventType, err)
	}
}

// refundState reads the refund columns of the tenant's only purchase.
func (e refundWebhookEnv) refundState(t *testing.T) (sql.NullInt32, sql.NullTime) {
	t.Helper()
	var (
		amount sql.NullInt32
		at     sql.NullTime
	)
	if err := e.pg.DB.QueryRowContext(context.Background(), `
		SELECT refunded_amount, refunded_at
		FROM purchases
		WHERE tenant_id = $1
	`, e.tenant.ID).Scan(&amount, &at); err != nil {
		t.Fatalf("read refund columns: %v", err)
	}
	return amount, at
}

func (e refundWebhookEnv) hasContentAccess(t *testing.T) bool {
	t.Helper()
	access, err := e.queries.UserHasEpisodeContentAccess(context.Background(), dbmodels.UserHasEpisodeContentAccessParams{
		TenantID:  e.tenant.ID,
		UserID:    e.user.ID,
		EpisodeID: e.episode.ID,
	})
	if err != nil {
		t.Fatalf("UserHasEpisodeContentAccess: %v", err)
	}
	return access.Valid && access.Bool
}

func refundedCharge(paymentIntentID string, amount, amountRefunded int64) map[string]any {
	return map[string]any{
		"id":              "ch_" + paymentIntentID,
		"object":          "charge",
		"currency":        "jpy",
		"amount":          amount,
		"amount_refunded": amountRefunded,
		"payment_intent":  paymentIntentID,
		"refunded":        amount == amountRefunded,
	}
}

func TestDBProcessStripeWebhookRecordsFullRefundIdempotently(t *testing.T) {
	env := newRefundWebhookEnv(t, "REFUNDFUL", "refund-full.example.com", "pi_refund_full")
	if !env.hasContentAccess(t) {
		t.Fatal("the purchase does not open the episode before the refund")
	}

	charge := refundedCharge("pi_refund_full", 500, 500)
	env.deliver(t, string(stripe.EventTypeChargeRefunded), charge)
	amount, at := env.refundState(t)
	if amount.Int32 != 500 {
		t.Fatalf("refunded_amount = %v, want 500", amount)
	}
	if !at.Valid {
		t.Fatal("refunded_at is unset after a full refund")
	}
	if env.hasContentAccess(t) {
		t.Fatal("a refunded purchase still opens the episode")
	}

	env.deliver(t, string(stripe.EventTypeChargeRefunded), charge)
	repeatAmount, repeatAt := env.refundState(t)
	if repeatAmount != amount || !repeatAt.Time.Equal(at.Time) {
		t.Fatalf("a repeated delivery changed the refund: amount %v -> %v, at %v -> %v",
			amount, repeatAmount, at.Time, repeatAt.Time)
	}
}

func TestDBProcessStripeWebhookKeepsAccessOnPartialRefund(t *testing.T) {
	env := newRefundWebhookEnv(t, "REFUNDPAR", "refund-partial.example.com", "pi_refund_partial")

	env.deliver(t, string(stripe.EventTypeChargeRefunded), refundedCharge("pi_refund_partial", 500, 200))
	amount, at := env.refundState(t)
	if amount.Int32 != 200 {
		t.Fatalf("refunded_amount = %v, want 200", amount)
	}
	if at.Valid {
		t.Fatalf("refunded_at = %v, want unset while the refund is partial", at.Time)
	}
	if !env.hasContentAccess(t) {
		t.Fatal("a partially refunded purchase no longer opens the episode")
	}

	// Stripe reports the amount refunded so far, so the delivery that completes
	// the price carries the whole of it.
	env.deliver(t, string(stripe.EventTypeChargeRefunded), refundedCharge("pi_refund_partial", 500, 500))
	amount, at = env.refundState(t)
	if amount.Int32 != 500 || !at.Valid {
		t.Fatalf("after the completing refund amount = %v at = %v, want 500 and a set instant", amount, at)
	}
	if env.hasContentAccess(t) {
		t.Fatal("a fully refunded purchase still opens the episode")
	}
}

func TestDBProcessStripeWebhookRecordsAnAmountlessRefundAsFull(t *testing.T) {
	env := newRefundWebhookEnv(t, "REFUNDAMT", "refund-amountless.example.com", "pi_refund_amountless")

	charge := refundedCharge("pi_refund_amountless", 500, 0)
	charge["refunded"] = true
	env.deliver(t, string(stripe.EventTypeChargeRefunded), charge)

	amount, at := env.refundState(t)
	if amount.Int32 != 500 || !at.Valid {
		t.Fatalf("amount = %v at = %v, want the whole price and a set instant", amount, at)
	}
	if env.hasContentAccess(t) {
		t.Fatal("a refunded purchase still opens the episode")
	}
}

func TestDBProcessStripeWebhookIgnoresRefundOfAnUnknownCharge(t *testing.T) {
	env := newRefundWebhookEnv(t, "REFUNDUNK", "refund-unknown.example.com", "pi_refund_known")

	env.deliver(t, string(stripe.EventTypeChargeRefunded), refundedCharge("pi_refund_stranger", 500, 500))
	amount, at := env.refundState(t)
	if amount.Valid || at.Valid {
		t.Fatalf("a refund naming no purchase wrote amount = %v at = %v", amount, at)
	}
	if !env.hasContentAccess(t) {
		t.Fatal("a refund naming no purchase revoked access")
	}
}
