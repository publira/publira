package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/secretupdate"
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
	env := newUnpaidRefundWebhookEnv(t, slug, domain)
	env.deliverCheckout(t, paymentIntentID)
	return env
}

// newUnpaidRefundWebhookEnv is the same tenant, buyer, and episode with no
// purchase yet, for the deliveries that arrive before one exists.
func newUnpaidRefundWebhookEnv(t *testing.T, slug, domain string) refundWebhookEnv {
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
		SecretKeyUpdateMode:     secretupdate.Replace,
		WebhookSecret:           testCheckoutWebhookSecret,
		WebhookSecretUpdateMode: secretupdate.Replace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), readerGuards{}, nil)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)

	return refundWebhookEnv{
		pg:      pg,
		client:  publirav1connect.NewPurchaseServiceClient(ts.Client(), ts.URL),
		tenant:  tenant,
		user:    user,
		episode: episode,
		queries: dbmodels.New(pg.DB),
	}
}

func (e refundWebhookEnv) deliverCheckout(t *testing.T, paymentIntentID string) {
	t.Helper()
	e.deliver(t, "checkout.session.completed", map[string]any{
		"id":             "cs_" + paymentIntentID,
		"object":         "checkout.session",
		"amount_total":   500,
		"currency":       "jpy",
		"payment_status": "paid",
		"payment_intent": paymentIntentID,
		"metadata": map[string]string{
			stripe.MetadataTenantID:  e.tenant.ID.String(),
			stripe.MetadataUserID:    e.user.ID.String(),
			stripe.MetadataEpisodeID: e.episode.ID.String(),
			stripe.MetadataPrice:     "500",
		},
	})
}

// heldRefundCount is how many refunds are still waiting for a purchase.
func (e refundWebhookEnv) heldRefundCount(t *testing.T) int {
	t.Helper()
	var count int
	if err := e.pg.DB.QueryRowContext(context.Background(), `
		SELECT count(*)
		FROM unapplied_stripe_refunds
		WHERE tenant_id = $1
	`, e.tenant.ID).Scan(&count); err != nil {
		t.Fatalf("count held refunds: %v", err)
	}
	return count
}

func (e refundWebhookEnv) deliver(t *testing.T, eventType string, object map[string]any) {
	t.Helper()
	payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, eventType, object)
	if _, err := e.client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(e.tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("ProcessPaymentWebhook(%s): %v", eventType, err)
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
	return access
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

func TestDBProcessPaymentWebhookRecordsFullRefundIdempotently(t *testing.T) {
	env := newRefundWebhookEnv(t, "REFUNDFUL", "refund-full.example.com", "pi_refund_full")
	if !env.hasContentAccess(t) {
		t.Fatal("the purchase does not open the episode before the refund")
	}

	charge := refundedCharge("pi_refund_full", 500, 500)
	env.deliver(t, "charge.refunded", charge)
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

	env.deliver(t, "charge.refunded", charge)
	repeatAmount, repeatAt := env.refundState(t)
	if repeatAmount != amount || !repeatAt.Time.Equal(at.Time) {
		t.Fatalf("a repeated delivery changed the refund: amount %v -> %v, at %v -> %v",
			amount, repeatAmount, at.Time, repeatAt.Time)
	}
}

func TestDBProcessPaymentWebhookKeepsAccessOnPartialRefund(t *testing.T) {
	env := newRefundWebhookEnv(t, "REFUNDPAR", "refund-partial.example.com", "pi_refund_partial")

	env.deliver(t, "charge.refunded", refundedCharge("pi_refund_partial", 500, 200))
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
	env.deliver(t, "charge.refunded", refundedCharge("pi_refund_partial", 500, 500))
	amount, at = env.refundState(t)
	if amount.Int32 != 500 || !at.Valid {
		t.Fatalf("after the completing refund amount = %v at = %v, want 500 and a set instant", amount, at)
	}
	if env.hasContentAccess(t) {
		t.Fatal("a fully refunded purchase still opens the episode")
	}
}

func TestDBProcessPaymentWebhookRecordsAnAmountlessRefundAsFull(t *testing.T) {
	env := newRefundWebhookEnv(t, "REFUNDAMT", "refund-amountless.example.com", "pi_refund_amountless")

	charge := refundedCharge("pi_refund_amountless", 500, 0)
	charge["refunded"] = true
	env.deliver(t, "charge.refunded", charge)

	amount, at := env.refundState(t)
	if amount.Int32 != 500 || !at.Valid {
		t.Fatalf("amount = %v at = %v, want the whole price and a set instant", amount, at)
	}
	if env.hasContentAccess(t) {
		t.Fatal("a refunded purchase still opens the episode")
	}
}

func TestDBProcessPaymentWebhookHoldsARefundOfAnUnknownCharge(t *testing.T) {
	env := newRefundWebhookEnv(t, "REFUNDUNK", "refund-unknown.example.com", "pi_refund_known")

	env.deliver(t, "charge.refunded", refundedCharge("pi_refund_stranger", 500, 500))
	amount, at := env.refundState(t)
	if amount.Valid || at.Valid {
		t.Fatalf("a refund naming another charge wrote amount = %v at = %v on this purchase", amount, at)
	}
	if !env.hasContentAccess(t) {
		t.Fatal("a refund naming another charge revoked access")
	}
	if held := env.heldRefundCount(t); held != 1 {
		t.Fatalf("held refunds = %d, want the unmatched one kept", held)
	}
}

// Stripe orders neither its events nor its retries, so the refund of a payment
// whose Checkout event is still being retried can arrive first. It has to
// survive until that event lands, or the purchase it creates would open the
// episode for money the reader already has back.
func TestDBProcessPaymentWebhookAppliesARefundThatArrivedBeforeItsPurchase(t *testing.T) {
	env := newUnpaidRefundWebhookEnv(t, "REFUNDPRE", "refund-early.example.com")

	env.deliver(t, "charge.refunded", refundedCharge("pi_refund_early", 500, 500))
	if held := env.heldRefundCount(t); held != 1 {
		t.Fatalf("held refunds = %d, want the early refund kept", held)
	}
	if env.hasContentAccess(t) {
		t.Fatal("an episode with no purchase already opens")
	}

	env.deliverCheckout(t, "pi_refund_early")
	amount, at := env.refundState(t)
	if amount.Int32 != 500 || !at.Valid {
		t.Fatalf("amount = %v at = %v, want the early refund written onto the new purchase", amount, at)
	}
	if env.hasContentAccess(t) {
		t.Fatal("a purchase created after its refund still opens the episode")
	}
	if held := env.heldRefundCount(t); held != 0 {
		t.Fatalf("held refunds = %d, want the applied one released", held)
	}

	// A redelivery of the Checkout event finds nothing held and changes
	// nothing.
	env.deliverCheckout(t, "pi_refund_early")
	repeatAmount, repeatAt := env.refundState(t)
	if repeatAmount != amount || !repeatAt.Time.Equal(at.Time) {
		t.Fatalf("a repeated Checkout delivery changed the refund: amount %v -> %v, at %v -> %v",
			amount, repeatAmount, at.Time, repeatAt.Time)
	}
}

// A partial refund that arrives first leaves the purchase readable, the same
// as one that arrives after.
func TestDBProcessPaymentWebhookAppliesAnEarlyPartialRefundWithoutRevokingAccess(t *testing.T) {
	env := newUnpaidRefundWebhookEnv(t, "REFUNDPRP", "refund-early-partial.example.com")

	env.deliver(t, "charge.refunded", refundedCharge("pi_refund_early_partial", 500, 200))
	env.deliverCheckout(t, "pi_refund_early_partial")

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
	if held := env.heldRefundCount(t); held != 0 {
		t.Fatalf("held refunds = %d, want the applied one released", held)
	}
}
