package publicapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/payjp/payjptest"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

// holdProvider saves provider for the tenant with every credential the
// fixture gives it.
func holdProvider(t *testing.T, store *paymentsettings.Store, tenant testutil.Tenant, provider paymentprovider.Provider, credentials paymentprovider.Credentials) {
	t.Helper()
	var fields []paymentsettings.FieldUpdate
	for _, field := range provider.Declaration().Fields {
		if value, ok := credentials[field.Name]; ok {
			fields = append(fields, paymentsettings.FieldUpdate{Name: field.Name, Mode: secretupdate.Replace, Value: value})
		}
	}
	if _, err := store.UpsertProvider(context.Background(), tenant.ID, paymentsettings.ProviderInput{
		Provider: provider.Declaration().ID,
		Enabled:  true,
		Currency: "JPY",
		Fields:   fields,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("hold %s: %v", provider.Declaration().ID, err)
	}
}

// A tenant that holds Stripe and PAY.JP at once offers both, sends each
// checkout to the provider the reader names, and records each purchase from
// the notification of the provider it was paid through.
func TestDBATenantHoldingTwoProvidersSellsThroughTheOneTheReaderNames(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	encryptor := newPublicTestEncryptor(t)
	stripeFixture := stripetest.NewFixture(t)
	payjpFixture := payjptest.NewFixture(t)
	registry := paymentprovider.NewRegistry(stripeFixture.Provider(), payjpFixture.Provider())

	tenant := pg.SeedTenant(t, "PAYTWO", "pay-two.example.com", "Pay Two")
	user := pg.SeedEndUser(t, tenant.ID, "PAYTWOUSER01", "two-buyer@example.com", "Two buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	published := time.Now().Add(-time.Hour)
	byStripe := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYTWOEPSTRP", Price: 500, Status: testutil.EpisodeStatusPublished, PublishedAt: published})
	byPayjp := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYTWOEPPAYJ", Price: 300, Status: testutil.EpisodeStatusPublished, PublishedAt: published})
	unbought := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYTWOEPLAST", Price: 200, Status: testutil.EpisodeStatusPublished, PublishedAt: published})

	store := paymentsettings.New(dbmodels.New(pg.DB), encryptor, registry, nil, slog.Default())
	holdProvider(t, store, tenant, stripeFixture.Provider(), stripeFixture.Credentials())
	holdProvider(t, store, tenant, payjpFixture.Provider(), payjpFixture.Credentials())

	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), openReaderGuards(), openMailGuard(), nil)
	server.paymentProviders = registry
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	transport := connecthttp.NewTransport(ts.Client(), ts.URL)
	purchases := publirav1connect.NewPurchaseServiceClient(connect.NewClient(transport))
	token, _, err := testutil.TokenManager().Issue(user.PublicID, auth.AudiencePublic, tenant.ID.String(), user.Role, user.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	signedIn := testutil.WithBearer(ctx, token)

	tenantResp, err := publirav1connect.NewTenantServiceClient(connect.NewClient(transport)).GetTenant(ctx, &publirav1.GetTenantRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	offered := tenantResp.PaymentProviders
	if !tenantResp.AcceptsPayments || len(offered) != 2 ||
		offered[0].Id != stripe.ID || !offered[0].Subscriptions ||
		offered[1].Id != payjp.ID || offered[1].Subscriptions || offered[1].DisplayName == "" {
		t.Fatalf("GetTenant offers %+v, want Stripe, which sells the plans, then PAY.JP", offered)
	}

	checkout := func(episodeID, provider string) error {
		_, err := purchases.StartEpisodeCheckout(signedIn, &publirav1.StartEpisodeCheckoutRequest{
			Tenant: tenantContext(tenant), EpisodeId: episodeID, Provider: provider,
		})
		return err
	}
	if err := checkout(byStripe.ID.String(), ""); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a checkout naming no provider: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if err := checkout(byStripe.ID.String(), "unknown"); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a checkout naming a provider the tenant does not hold: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := publirav1connect.NewSubscriptionServiceClient(connect.NewClient(transport)).StartSubscriptionCheckout(signedIn, &publirav1.StartSubscriptionCheckoutRequest{
		Tenant: tenantContext(tenant), PlanId: byStripe.ID.String(), Provider: payjp.ID,
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a plan through PAY.JP: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if err := checkout(byStripe.ID.String(), stripe.ID); err != nil {
		t.Fatalf("checkout through Stripe: %v", err)
	}
	if err := checkout(byPayjp.ID.String(), payjp.ID); err != nil {
		t.Fatalf("checkout through PAY.JP: %v", err)
	}
	if got := len(stripeFixture.API.CheckoutSessions()); got != 1 {
		t.Fatalf("Stripe checkouts = %d, want the one named Stripe", got)
	}
	if got := len(payjpFixture.API.CheckoutSessions()); got != 1 {
		t.Fatalf("PAY.JP checkouts = %d, want the one named PAY.JP", got)
	}

	paid := []struct {
		fixture  paymentprovidertest.Fixture
		provider string
		checkout paymentprovidertest.Checkout
	}{
		{stripeFixture, stripe.ID, paymentprovidertest.Checkout{
			CheckoutID: "cs_two", PaymentID: "pi_two",
			Purchase: paymentprovider.Purchase{TenantID: tenant.ID, ReaderID: user.ID, EpisodeID: byStripe.ID, Price: 500, Currency: "JPY"},
		}},
		{payjpFixture, payjp.ID, paymentprovidertest.Checkout{
			CheckoutID: "cs_payjp_two", PaymentID: "pfw_two",
			Purchase: paymentprovider.Purchase{TenantID: tenant.ID, ReaderID: user.ID, EpisodeID: byPayjp.ID, Price: 300, Currency: "JPY"},
		}},
	}
	for _, p := range paid {
		payload, headers := p.fixture.CheckoutCompleted(t, p.fixture.Credentials(), p.checkout)
		if _, err := purchases.ProcessPaymentWebhook(ctx, paymentWebhookRequest(tenant.ID.String(), p.provider, payload, headers)); err != nil {
			t.Fatalf("%s notification: %v", p.provider, err)
		}
		var provider string
		if err := pg.DB.QueryRowContext(ctx, `
			SELECT provider FROM purchases WHERE tenant_id = $1 AND episode_id = $2
		`, tenant.ID, p.checkout.Purchase.EpisodeID).Scan(&provider); err != nil {
			t.Fatalf("read the %s purchase: %v", p.provider, err)
		}
		if provider != p.provider {
			t.Fatalf("purchase paid through %s recorded as %s", p.provider, provider)
		}
	}

	// A notification is verified against the credentials of the provider its
	// route names, never another the tenant holds.
	payload, headers := payjpFixture.CheckoutCompleted(t, payjpFixture.Credentials(), paid[1].checkout)
	if _, err := purchases.ProcessPaymentWebhook(ctx, paymentWebhookRequest(tenant.ID.String(), stripe.ID, payload, headers)); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("PAY.JP's notification on Stripe's route: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	// PAY.JP switched off is a provider the tenant holds that cannot take a
	// checkout now, and leaves Stripe the one a checkout may leave unnamed.
	if _, err := store.UpsertProvider(ctx, tenant.ID, paymentsettings.ProviderInput{Provider: payjp.ID, Enabled: false}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("switch PAY.JP off: %v", err)
	}
	if err := checkout(unbought.ID.String(), payjp.ID); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a checkout through PAY.JP switched off: code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	if err := checkout(unbought.ID.String(), ""); err != nil {
		t.Fatalf("a checkout naming no provider while Stripe alone sells: %v", err)
	}
	if got := len(stripeFixture.API.CheckoutSessions()); got != 2 {
		t.Fatalf("Stripe checkouts = %d, want the unnamed one sent there too", got)
	}
}
