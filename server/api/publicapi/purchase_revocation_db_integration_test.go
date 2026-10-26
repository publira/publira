package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"
	stripego "github.com/stripe/stripe-go/v87"

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
	payload, headers := stripetest.NewFixture(t).Disputed(t, stripeFixtureCredentials, paymentIntentID)
	e.deliverSigned(t, payload, headers)
}

func (e refundWebhookEnv) deliverDisputeClosed(t *testing.T, paymentIntentID string, status stripego.DisputeStatus) {
	t.Helper()
	payload, headers := stripetest.NewFixture(t).DisputeClosed(t, stripeFixtureCredentials, paymentIntentID, status)
	e.deliverSigned(t, payload, headers)
}

// disputeLostAt reads when the tenant's only purchase was recorded as lost to
// a dispute.
func (e refundWebhookEnv) disputeLostAt(t *testing.T) sql.NullTime {
	t.Helper()
	var at sql.NullTime
	if err := e.pg.DB.QueryRowContext(context.Background(), `
		SELECT dispute_lost_at
		FROM purchases
		WHERE tenant_id = $1
	`, e.tenant.ID).Scan(&at); err != nil {
		t.Fatalf("read dispute_lost_at: %v", err)
	}
	return at
}

// purchaseID reads the ID of the tenant's only purchase.
func (e refundWebhookEnv) purchaseID(t *testing.T) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := e.pg.DB.QueryRowContext(context.Background(), `
		SELECT id
		FROM purchases
		WHERE tenant_id = $1
	`, e.tenant.ID).Scan(&id); err != nil {
		t.Fatalf("read purchase id: %v", err)
	}
	return id
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
	held, err := e.queries.GetActiveEpisodePurchaseKinds(context.Background(), dbmodels.GetActiveEpisodePurchaseKindsParams{
		TenantID:  e.tenant.ID,
		UserID:    e.user.ID,
		EpisodeID: e.episode.ID,
	})
	if err != nil {
		t.Fatalf("GetActiveEpisodePurchaseKinds: %v", err)
	}
	return !held.HoldsPurchase
}

func TestDBProcessPaymentWebhookRevokesADisputedPurchase(t *testing.T) {
	t.Parallel()

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
	t.Parallel()

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
	t.Parallel()

	env := newRefundWebhookEnv(t, "REVPART", "revocation-partial.example.com", "pi_revocation_partial")

	env.deliver(t, "charge.refunded", refundedCharge("pi_revocation_partial", 500, 200))
	if at, reason := env.revocation(t); at.Valid || reason.Valid {
		t.Fatalf("revocation = (%v, %v), want none while the refund is partial", at, reason)
	}
}

// A dispute held for a payment whose Checkout event is still being retried
// revokes the purchase that event creates, as a held refund does.
func TestDBProcessPaymentWebhookRevokesAPurchaseWhoseDisputeArrivedFirst(t *testing.T) {
	t.Parallel()

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
	t.Parallel()

	env := newRefundWebhookEnv(t, "DISPUNK", "dispute-unknown.example.com", "pi_dispute_known")

	env.deliverDispute(t, "pi_dispute_stranger")
	if at, reason := env.revocation(t); at.Valid || reason.Valid {
		t.Fatalf("a dispute naming another charge revoked this purchase: (%v, %v)", at, reason)
	}
	if held := env.heldDisputeCount(t); held != 1 {
		t.Fatalf("held disputes = %d, want the unmatched one kept", held)
	}
}

// A lost dispute is recorded on the purchase the dispute already revoked, and
// leaves the revocation and the refund columns as they were: the money went
// back through the bank, not through a refund.
func TestDBProcessPaymentWebhookRecordsALostDispute(t *testing.T) {
	t.Parallel()

	env := newRefundWebhookEnv(t, "DISPLOST", "dispute-lost.example.com", "pi_dispute_lost")

	env.deliverDispute(t, "pi_dispute_lost")
	at, reason := env.revocation(t)
	if lostAt := env.disputeLostAt(t); lostAt.Valid {
		t.Fatalf("an open dispute was recorded lost at %v", lostAt.Time)
	}

	env.deliverDisputeClosed(t, "pi_dispute_lost", stripego.DisputeStatusLost)
	lostAt := env.disputeLostAt(t)
	if !lostAt.Valid {
		t.Fatal("a lost dispute was not recorded")
	}
	if lostAt, lostReason := env.revocation(t); !lostAt.Time.Equal(at.Time) || lostReason != reason {
		t.Fatalf("the lost dispute changed the revocation: %v %v -> %v %v", at.Time, reason, lostAt.Time, lostReason)
	}
	if amount, refundedAt := env.refundState(t); amount.Valid || refundedAt.Valid {
		t.Fatalf("a lost dispute recorded a refund: amount = %v at = %v", amount, refundedAt)
	}

	env.deliverDisputeClosed(t, "pi_dispute_lost", stripego.DisputeStatusLost)
	if repeat := env.disputeLostAt(t); !repeat.Time.Equal(lostAt.Time) {
		t.Fatalf("a repeated delivery moved the loss: %v -> %v", lostAt.Time, repeat.Time)
	}
}

// A won dispute leaves the purchase as the dispute left it: revoked, and still
// a sale, since the payment stayed with the tenant.
func TestDBProcessPaymentWebhookLeavesAWonDisputeRevoked(t *testing.T) {
	t.Parallel()

	env := newRefundWebhookEnv(t, "DISPWON", "dispute-won.example.com", "pi_dispute_won")

	env.deliverDispute(t, "pi_dispute_won")
	at, reason := env.revocation(t)

	env.deliverDisputeClosed(t, "pi_dispute_won", stripego.DisputeStatusWon)
	if wonAt, wonReason := env.revocation(t); !wonAt.Time.Equal(at.Time) || wonReason != reason {
		t.Fatalf("the won dispute changed the revocation: %v %v -> %v %v", at.Time, reason, wonAt.Time, wonReason)
	}
	if env.hasContentAccess(t) {
		t.Fatal("a purchase whose dispute was won opens the episode again")
	}
	if lostAt := env.disputeLostAt(t); lostAt.Valid {
		t.Fatalf("a won dispute was recorded lost at %v", lostAt.Time)
	}
}

// A lost dispute whose opening notification never arrived revokes the
// purchase itself.
func TestDBProcessPaymentWebhookRevokesOnALostDisputeAlone(t *testing.T) {
	t.Parallel()

	env := newRefundWebhookEnv(t, "DISPLONE", "dispute-lost-alone.example.com", "pi_dispute_lost_alone")

	env.deliverDisputeClosed(t, "pi_dispute_lost_alone", stripego.DisputeStatusLost)
	if at, reason := env.revocation(t); !at.Valid || reason.String != "dispute" {
		t.Fatalf("revocation = (%v, %v), want revoked for a dispute", at, reason)
	}
	if !env.disputeLostAt(t).Valid {
		t.Fatal("a lost dispute was not recorded")
	}
	if env.hasContentAccess(t) {
		t.Fatal("a purchase lost to a dispute still opens the episode")
	}
}

// A lost dispute held for a payment whose Checkout event is still being
// retried is recorded on the purchase that event creates.
func TestDBProcessPaymentWebhookRecordsALostDisputeThatArrivedFirst(t *testing.T) {
	t.Parallel()

	env := newUnpaidRefundWebhookEnv(t, "DISPLPRE", "dispute-lost-early.example.com")

	env.deliverDisputeClosed(t, "pi_dispute_lost_early", stripego.DisputeStatusLost)
	// The notification that opened the dispute, delivered again after it.
	env.deliverDispute(t, "pi_dispute_lost_early")
	if held := env.heldDisputeCount(t); held != 1 {
		t.Fatalf("held disputes = %d, want the early dispute kept once", held)
	}

	env.deliverCheckout(t, "pi_dispute_lost_early")
	if at, reason := env.revocation(t); !at.Valid || reason.String != "dispute" {
		t.Fatalf("revocation = (%v, %v), want the early dispute applied to the new purchase", at, reason)
	}
	if !env.disputeLostAt(t).Valid {
		t.Fatal("the held dispute was not recorded lost on the new purchase")
	}
	if held := env.heldDisputeCount(t); held != 0 {
		t.Fatalf("held disputes = %d, want the applied one released", held)
	}
}

// Nothing that takes back a refund reopens a purchase whose dispute was lost,
// whatever revoked it first: the reader's bank has returned the money.
func TestDBALostDisputeKeepsThePurchaseRevoked(t *testing.T) {
	t.Parallel()

	ctx := context.Background()

	t.Run("a refund that fails after the dispute is lost", func(t *testing.T) {
		env := newRefundWebhookEnv(t, "LOSTFAIL", "lost-refund-failed.example.com", "pi_lost_refund_failed")
		env.deliver(t, "charge.refunded", refundedCharge("pi_lost_refund_failed", 500, 500))
		env.deliverDisputeClosed(t, "pi_lost_refund_failed", stripego.DisputeStatusLost)

		if _, err := env.queries.RecordFailedRefundOnPurchase(ctx, dbmodels.RecordFailedRefundOnPurchaseParams{
			TenantID:          env.tenant.ID,
			Provider:          stripe.ID,
			ProviderPaymentID: "pi_lost_refund_failed",
			Currency:          "JPY",
			RefundedAmount:    0,
		}); err != nil {
			t.Fatalf("RecordFailedRefundOnPurchase: %v", err)
		}
		if at, reason := env.revocation(t); !at.Valid || reason.String != "refund" {
			t.Fatalf("revocation = (%v, %v), want the refund's kept", at, reason)
		}
	})

	t.Run("a staff refund the provider refuses after the dispute is lost", func(t *testing.T) {
		env := newRefundWebhookEnv(t, "LOSTSTAFF", "lost-staff.example.com", "pi_lost_staff")
		purchaseID := env.purchaseID(t)
		if _, err := env.queries.RevokePurchaseForStaff(ctx, dbmodels.RevokePurchaseForStaffParams{TenantID: env.tenant.ID, ID: purchaseID}); err != nil {
			t.Fatalf("RevokePurchaseForStaff: %v", err)
		}
		env.deliverDisputeClosed(t, "pi_lost_staff", stripego.DisputeStatusLost)

		_, err := env.queries.LiftStaffRevocation(ctx, dbmodels.LiftStaffRevocationParams{TenantID: env.tenant.ID, ID: purchaseID, NextAttempt: true})
		if !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("LiftStaffRevocation error = %v, want no row lifted", err)
		}
		if at, reason := env.revocation(t); !at.Valid || reason.String != "staff" {
			t.Fatalf("revocation = (%v, %v), want staff's kept", at, reason)
		}
	})
}

// A reader whose checkout expired unpaid can start again: the next checkout is
// a new one rather than the provider's answer for the key of the expired one,
// and a repeated report of the same expiry does not move it again.
func TestDBStartEpisodeCheckoutStartsAFreshCheckoutAfterOneExpires(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)

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
		payload, headers := stripetest.NewFixture(t).CheckoutExpired(t, stripeFixtureCredentials, paymentprovidertest.Checkout{
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
