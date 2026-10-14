package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// stripeFixtureCredentials are the credentials refundWebhookEnv's tenant
// verifies Stripe's signatures with, as the fixture events read them.
var stripeFixtureCredentials = paymentprovider.Credentials{
	stripe.FieldSecretKey:     testCheckoutSecretKey,
	stripe.FieldWebhookSecret: testCheckoutWebhookSecret,
}

func (e refundWebhookEnv) deliverSigned(t *testing.T, payload []byte, headers http.Header) {
	t.Helper()
	if _, err := e.client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(e.tenant.ID.String(), payload, headers)); err != nil {
		t.Fatalf("ProcessPaymentWebhook: %v", err)
	}
}

func (e refundWebhookEnv) deliverDispute(t *testing.T, paymentIntentID string) {
	t.Helper()
	payload, headers := stripetest.Fixture{}.Disputed(t, stripeFixtureCredentials, paymentIntentID)
	e.deliverSigned(t, payload, headers)
}

// revocation reads the revocation columns of the tenant's only purchase.
func (e refundWebhookEnv) revocation(t *testing.T) (sql.NullTime, sql.NullString) {
	t.Helper()
	var (
		at     sql.NullTime
		reason sql.NullString
	)
	if err := e.pg.DB.QueryRowContext(context.Background(), `
		SELECT revoked_at, revocation_reason
		FROM purchases
		WHERE tenant_id = $1
	`, e.tenant.ID).Scan(&at, &reason); err != nil {
		t.Fatalf("read revocation columns: %v", err)
	}
	return at, reason
}

// heldDisputeCount is how many disputes are still waiting for a purchase.
func (e refundWebhookEnv) heldDisputeCount(t *testing.T) int {
	t.Helper()
	var count int
	if err := e.pg.DB.QueryRowContext(context.Background(), `
		SELECT count(*)
		FROM unapplied_disputes
		WHERE tenant_id = $1
	`, e.tenant.ID).Scan(&count); err != nil {
		t.Fatalf("count held disputes: %v", err)
	}
	return count
}

// mayBuyAgain reports whether the reader may start another checkout of the
// episode, which a valid purchase of it would refuse.
func (e refundWebhookEnv) mayBuyAgain(t *testing.T) bool {
	t.Helper()
	has, err := e.queries.UserHasValidPurchaseForEpisode(context.Background(), dbmodels.UserHasValidPurchaseForEpisodeParams{
		TenantID:  e.tenant.ID,
		UserID:    e.user.ID,
		EpisodeID: e.episode.ID,
	})
	if err != nil {
		t.Fatalf("UserHasValidPurchaseForEpisode: %v", err)
	}
	return !has
}

func TestDBProcessPaymentWebhookRevokesADisputedPurchase(t *testing.T) {
	env := newRefundWebhookEnv(t, "DISPUTED", "disputed.example.com", "pi_disputed")
	if !env.hasContentAccess(t) {
		t.Fatal("the purchase does not open the episode before the dispute")
	}

	env.deliverDispute(t, "pi_disputed")
	at, reason := env.revocation(t)
	if !at.Valid || reason.String != "dispute" {
		t.Fatalf("revocation = (%v, %v), want revoked for a dispute", at, reason)
	}
	if env.hasContentAccess(t) {
		t.Fatal("a disputed purchase still opens the episode")
	}
	if !env.mayBuyAgain(t) {
		t.Fatal("a disputed purchase still counts as a valid purchase")
	}
	// A dispute takes the reading right away and nothing else: the money is
	// the bank's to decide, so no refund is recorded.
	if amount, refundedAt := env.refundState(t); amount.Valid || refundedAt.Valid {
		t.Fatalf("a dispute recorded a refund: amount = %v at = %v", amount, refundedAt)
	}

	env.deliverDispute(t, "pi_disputed")
	repeatAt, repeatReason := env.revocation(t)
	if !repeatAt.Time.Equal(at.Time) || repeatReason != reason {
		t.Fatalf("a repeated delivery changed the revocation: %v %v -> %v %v", at.Time, reason, repeatAt.Time, repeatReason)
	}
	if held := env.heldDisputeCount(t); held != 0 {
		t.Fatalf("held disputes = %d, want none for a dispute that met its purchase", held)
	}
}

// A full refund revokes the purchase as a refund, and a dispute that follows
// leaves that reason alone.
func TestDBProcessPaymentWebhookKeepsTheFirstRevocationReason(t *testing.T) {
	env := newRefundWebhookEnv(t, "REVFIRST", "revocation-first.example.com", "pi_revocation_first")

	env.deliver(t, "charge.refunded", refundedCharge("pi_revocation_first", 500, 500))
	at, reason := env.revocation(t)
	if !at.Valid || reason.String != "refund" {
		t.Fatalf("revocation = (%v, %v), want revoked for a refund", at, reason)
	}

	env.deliverDispute(t, "pi_revocation_first")
	disputedAt, disputedReason := env.revocation(t)
	if !disputedAt.Time.Equal(at.Time) || disputedReason.String != "refund" {
		t.Fatalf("revocation after the dispute = (%v, %v), want (%v, refund)", disputedAt.Time, disputedReason, at.Time)
	}
}

// A partial refund leaves the purchase open, so it records no revocation.
func TestDBProcessPaymentWebhookDoesNotRevokeOnAPartialRefund(t *testing.T) {
	env := newRefundWebhookEnv(t, "REVPART", "revocation-partial.example.com", "pi_revocation_partial")

	env.deliver(t, "charge.refunded", refundedCharge("pi_revocation_partial", 500, 200))
	if at, reason := env.revocation(t); at.Valid || reason.Valid {
		t.Fatalf("revocation = (%v, %v), want none while the refund is partial", at, reason)
	}
}

// A dispute held for a payment whose Checkout event is still being retried
// revokes the purchase that event creates, as a held refund does.
func TestDBProcessPaymentWebhookRevokesAPurchaseWhoseDisputeArrivedFirst(t *testing.T) {
	env := newUnpaidRefundWebhookEnv(t, "DISPPRE", "dispute-early.example.com")

	env.deliverDispute(t, "pi_dispute_early")
	if held := env.heldDisputeCount(t); held != 1 {
		t.Fatalf("held disputes = %d, want the early dispute kept", held)
	}

	env.deliverCheckout(t, "pi_dispute_early")
	at, reason := env.revocation(t)
	if !at.Valid || reason.String != "dispute" {
		t.Fatalf("revocation = (%v, %v), want the early dispute applied to the new purchase", at, reason)
	}
	if env.hasContentAccess(t) {
		t.Fatal("a purchase created after its dispute still opens the episode")
	}
	if held := env.heldDisputeCount(t); held != 0 {
		t.Fatalf("held disputes = %d, want the applied one released", held)
	}
}

// A dispute of a charge this tenant has no purchase for is held and touches
// nothing else, as an unmatched refund is.
func TestDBProcessPaymentWebhookHoldsADisputeOfAnUnknownCharge(t *testing.T) {
	env := newRefundWebhookEnv(t, "DISPUNK", "dispute-unknown.example.com", "pi_dispute_known")

	env.deliverDispute(t, "pi_dispute_stranger")
	if at, reason := env.revocation(t); at.Valid || reason.Valid {
		t.Fatalf("a dispute naming another charge revoked this purchase: (%v, %v)", at, reason)
	}
	if held := env.heldDisputeCount(t); held != 1 {
		t.Fatalf("held disputes = %d, want the unmatched one kept", held)
	}
}

// A reader whose checkout expired unpaid can start again: the next checkout is
// a new one rather than the provider's answer for the key of the expired one,
// and a repeated report of the same expiry does not move it again.
func TestDBStartEpisodeCheckoutStartsAFreshCheckoutAfterOneExpires(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "EXPIRED", "checkout-expired.example.com", "Expired checkout tenant")
	user := pg.SeedEndUser(t, tenant.ID, "EXPIREDBUYR1", "expired-buyer@example.com", "Expired buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, providers.Registry(), nil, slog.Default()).Upsert(ctx, tenant.ID, stripeSettings(testCheckoutSecretKey, testCheckoutWebhookSecret), paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	checkout := newCapturingCheckoutProvider()
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), openReaderGuards(), openMailGuard(), nil)
	server.paymentProviders = paymentprovider.NewRegistry(checkout)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	purchases := publirav1connect.NewPurchaseServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	token, _, err := testutil.TokenManager().Issue(user.PublicID, auth.AudiencePublic, tenant.ID.String(), user.Role, user.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	start := func() string {
		t.Helper()
		if _, err := purchases.StartEpisodeCheckout(testutil.WithBearer(ctx, token), &publirav1.StartEpisodeCheckoutRequest{
			EpisodeId: episode.ID.String(),
			Tenant:    tenantContext(tenant),
		}); err != nil {
			t.Fatalf("StartEpisodeCheckout: %v", err)
		}
		return checkout.input.IdempotencyKey
	}
	expire := func(checkoutID string) {
		t.Helper()
		payload, headers := stripetest.Fixture{}.CheckoutExpired(t, stripeFixtureCredentials, paymentprovidertest.Checkout{
			CheckoutID: checkoutID,
			Purchase: paymentprovider.Purchase{
				TenantID:  tenant.ID,
				ReaderID:  user.ID,
				EpisodeID: episode.ID,
				Price:     500,
				Currency:  "JPY",
			},
		})
		if _, err := purchases.ProcessPaymentWebhook(ctx, stripeWebhookRequest(tenant.ID.String(), payload, headers)); err != nil {
			t.Fatalf("ProcessPaymentWebhook(checkout.session.expired): %v", err)
		}
	}

	first := start()
	if again := start(); again != first {
		t.Fatalf("a retried checkout was keyed %q, want the first key %q", again, first)
	}

	expire("cs_expired_first")
	second := start()
	if second == first {
		t.Fatal("the checkout after an expiry reused the key of the expired one")
	}

	expire("cs_expired_first")
	if again := start(); again != second {
		t.Fatalf("a repeated expiry moved the key to %q, want %q", again, second)
	}

	expire("cs_expired_second")
	if third := start(); third == first || third == second {
		t.Fatalf("the checkout after a second expiry was keyed %q, a key already used", third)
	}
	if len(checkout.sent) != 3 {
		t.Fatalf("provider received %d idempotency keys, want 3", len(checkout.sent))
	}
	// Nothing was bought, so nothing was revoked or recorded as a purchase.
	var bought int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM purchases WHERE tenant_id = $1", tenant.ID).Scan(&bought); err != nil {
		t.Fatalf("count purchases: %v", err)
	}
	if bought != 0 {
		t.Fatalf("purchases = %d, want none for expired checkouts", bought)
	}
}
