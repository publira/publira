package adminapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest/readbacktest"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// refundFollowFixture is a tenant that sells through the fake of a provider
// that sends no notification of a refund, with one purchase paid through it.
type refundFollowFixture struct {
	env        *adminDBEnv
	admin      adminDBTenant
	fake       *readbacktest.Fixture
	purchaseID uuid.UUID
	// paymentID is the purchase's payment as the provider reports it.
	paymentID string
}

func newRefundFollowFixture(t *testing.T) *refundFollowFixture {
	t.Helper()
	return newRefundFollowFixtureOf(t, readbacktest.NewFixture)
}

// newRefundFollowFixtureOf answers the tenant of newRefundFollowFixture selling
// through the fake newFixture answers.
func newRefundFollowFixtureOf(t *testing.T, newFixture func(testing.TB) *readbacktest.Fixture) *refundFollowFixture {
	t.Helper()
	fake := newFixture(t)
	providerID := fake.Provider().Declaration().ID
	env := newAdminDBEnvWithPaymentProviders(t, paymentprovider.NewRegistry(fake.Provider()))
	admin := env.seedTenantWithAdmin(t, "FOLLOWA", "follow-a.example.com", "Follow A", "FAADMIN01", "admin@follow-a.example.com")
	series := env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "FOLLOWSR1", Published: true})
	episode := env.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "FOLLOWEP1", Price: 500, Status: testutil.EpisodeStatusPublished, PublishedAt: time.Now().Add(-time.Hour)})
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "FOLLOWRDR01", "follow-reader@example.com", "Follow reader")
	apiKey := fake.Credentials()[readbacktest.FieldAPIKey]
	if _, err := env.paymentClient().UpsertTenantPaymentProvider(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.UpsertTenantPaymentProviderRequest{
		Tenant:   admin.tenantContext(),
		Provider: providerID,
		Enabled:  true,
		Currency: "JPY",
		Fields: []*publiraadminv1.PaymentCredentialFieldUpdate{
			{Name: readbacktest.FieldAPIKey, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: apiKey},
		},
	}); err != nil {
		t.Fatalf("save the provider's settings: %v", err)
	}
	fake.API().Pay(fake.Credentials(), "checkout_follow", "payment_follow", 500, "JPY", false, time.Now())
	paymentID := fake.API().PaymentID("checkout_follow", "payment_follow")
	purchaseID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at, currency, provider, provider_checkout_id, provider_payment_id)
		VALUES ($1, $2, $3, $4, 500, NOW() - INTERVAL '1 hour', 'JPY', $5, 'checkout_follow', $6)
	`, purchaseID, admin.Tenant.ID, reader.ID, episode.ID, providerID, paymentID); err != nil {
		t.Fatalf("insert a purchase: %v", err)
	}
	return &refundFollowFixture{env: env, admin: admin, fake: fake, purchaseID: purchaseID, paymentID: paymentID}
}

func (f *refundFollowFixture) client() publiraadminv1connect.AdminPurchaseServiceClient {
	return publiraadminv1connect.NewAdminPurchaseServiceClient(connect.NewClient(connecthttp.NewTransport(f.env.Server.Client(), f.env.Server.URL)))
}

func (f *refundFollowFixture) followUps(t *testing.T) int {
	t.Helper()
	return f.env.countRows(t, "SELECT count(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = $2", f.admin.Tenant.ID, outbox.EventTypePaymentRefundFollow)
}

// A refund staff ask of a provider that notifies none is followed up, so the
// purchase hears what became of it, and so is its retry after a request that
// failed before the provider made anything: the first follow-up finds nothing
// to record and is done, and only the retry's reads what the retry made. Both
// hold whether the provider names the payment by an id of its own or by its
// checkout's.
func TestDBRefundPurchaseQueuesTheFollowUpOfEveryRequestForAnUnnotifiedRefund(t *testing.T) {
	t.Parallel()

	for id, newFixture := range map[string]func(testing.TB) *readbacktest.Fixture{
		readbacktest.ID:           readbacktest.NewFixture,
		readbacktest.IDByCheckout: readbacktest.NewFixtureByCheckout,
	} {
		t.Run(id, func(t *testing.T) {
			t.Parallel()
			testRefundPurchaseQueuesTheFollowUpOfEveryRequest(t, newRefundFollowFixtureOf(t, newFixture))
		})
	}
}

func testRefundPurchaseQueuesTheFollowUpOfEveryRequest(t *testing.T, f *refundFollowFixture) {
	t.Helper()
	ctx := testutil.WithBearer(context.Background(), f.admin.token())
	request := &publiraadminv1.RefundPurchaseRequest{Tenant: f.admin.tenantContext(), PurchaseId: f.purchaseID.String(), Reason: "The reader bought the episode twice."}
	f.fake.API().BreakNextRefund(f.fake.Credentials(), f.paymentID)
	if _, err := f.client().RefundPurchase(ctx, request); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("RefundPurchase the provider did not answer: error = %v, want Unavailable", err)
	}
	if got := f.followUps(t); got != 1 {
		t.Fatalf("follow-ups after the failed request = %d, want 1", got)
	}
	if _, err := f.client().RefundPurchase(ctx, request); err != nil {
		t.Fatalf("RefundPurchase: %v", err)
	}
	if got := f.followUps(t); got != 2 {
		t.Fatalf("follow-ups after the retry = %d, want 2", got)
	}
	if got := f.fake.RefundedTotal(t, f.fake.Credentials(), f.paymentID); got != 500 {
		t.Fatalf("refunded total = %d, want 500", got)
	}
}

func TestDBRefundPurchaseInPartQueuesTheFollowUpOfAnUnnotifiedRefund(t *testing.T) {
	t.Parallel()

	f := newRefundFollowFixture(t)
	ctx := testutil.WithBearer(context.Background(), f.admin.token())
	if _, err := f.client().RefundPurchaseInPart(ctx, &publiraadminv1.RefundPurchaseInPartRequest{
		Tenant:     f.admin.tenantContext(),
		PurchaseId: f.purchaseID.String(),
		Amount:     200,
		Reason:     "Part of the episode was missing.",
	}); err != nil {
		t.Fatalf("RefundPurchaseInPart: %v", err)
	}
	if got := f.followUps(t); got != 1 {
		t.Fatalf("follow-ups = %d, want 1", got)
	}
}

// A refund the provider refused made nothing to follow.
func TestDBRefundPurchaseQueuesNoFollowUpOfARefusedRefund(t *testing.T) {
	t.Parallel()

	f := newRefundFollowFixture(t)
	f.fake.FailNextRefund(t, f.fake.Credentials(), f.paymentID)
	ctx := testutil.WithBearer(context.Background(), f.admin.token())
	_, err := f.client().RefundPurchase(ctx, &publiraadminv1.RefundPurchaseRequest{Tenant: f.admin.tenantContext(), PurchaseId: f.purchaseID.String(), Reason: "The reader bought the episode twice."})
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeFailedPrecondition {
		t.Fatalf("RefundPurchase error = %v, want FailedPrecondition", err)
	}
	if got := f.followUps(t); got != 0 {
		t.Fatalf("follow-ups = %d, want 0", got)
	}
}
