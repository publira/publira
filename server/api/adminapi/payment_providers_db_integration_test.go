package adminapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/payjp/payjptest"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func providerFields(provider paymentprovider.Provider, credentials paymentprovider.Credentials) []*publiraadminv1.PaymentCredentialFieldUpdate {
	var fields []*publiraadminv1.PaymentCredentialFieldUpdate
	for _, field := range provider.Declaration().Fields {
		if value, ok := credentials[field.Name]; ok {
			fields = append(fields, &publiraadminv1.PaymentCredentialFieldUpdate{
				Name: field.Name, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: value,
			})
		}
	}
	return fields
}

func providerIDs(providers []*publiraadminv1.TenantPaymentProviderSettings) []string {
	var ids []string
	for _, provider := range providers {
		id := provider.Provider
		if provider.Retired {
			id += " (retired)"
		}
		ids = append(ids, id)
	}
	return ids
}

// A tenant holding Stripe and PAY.JP at once refunds a purchase through the
// provider it was paid through, reconciles each provider on its own, and
// keeps a provider it removes for as long as it has payments to refund.
func TestDBATenantHoldingTwoProvidersRefundsAndReconcilesEachThroughItsOwn(t *testing.T) {
	t.Parallel()

	stripeFixture := stripetest.NewFixture(t)
	payjpFixture := payjptest.NewFixture(t)
	env := newAdminDBEnvWithPaymentProviders(t, paymentprovider.NewRegistry(stripeFixture.Provider(), payjpFixture.Provider()))
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	ctx := testutil.WithBearer(context.Background(), admin.token())
	payments := env.paymentClient()

	for _, fixture := range []paymentprovidertest.Fixture{stripeFixture, payjpFixture} {
		provider := fixture.Provider()
		if _, err := payments.UpsertTenantPaymentProvider(ctx, &publiraadminv1.UpsertTenantPaymentProviderRequest{
			Tenant:   admin.tenantContext(),
			Provider: provider.Declaration().ID,
			Enabled:  true,
			Currency: "JPY",
			Fields:   providerFields(provider, fixture.Credentials()),
		}); err != nil {
			t.Fatalf("UpsertTenantPaymentProvider %s: %v", provider.Declaration().ID, err)
		}
	}
	listed, err := payments.ListTenantPaymentProviders(ctx, &publiraadminv1.ListTenantPaymentProvidersRequest{Tenant: admin.tenantContext()})
	if err != nil {
		t.Fatalf("ListTenantPaymentProviders: %v", err)
	}
	if got := providerIDs(listed.Providers); len(got) != 2 || got[0] != stripe.ID || got[1] != payjp.ID || !listed.Providers[0].Ready || !listed.Providers[1].Ready || listed.Currency != "JPY" {
		t.Fatalf("held = %+v, want Stripe then PAY.JP, both ready, in JPY", listed)
	}
	registered, err := payments.ListPaymentProviders(ctx, &publiraadminv1.ListPaymentProvidersRequest{Tenant: admin.tenantContext()})
	if err != nil {
		t.Fatalf("ListPaymentProviders: %v", err)
	}
	for _, provider := range registered.Providers {
		if provider.Subscriptions != (provider.Id == stripe.ID) {
			t.Fatalf("%s takes recurring payments = %v, want Stripe alone to", provider.Id, provider.Subscriptions)
		}
	}

	series := env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA1", Title: "Series A", Published: true})
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "READERALICE", "alice@example.com", "Alice")
	purchasedAt := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC)
	bought := func(fixture paymentprovidertest.Fixture, publicID, paymentID string) uuid.UUID {
		t.Helper()
		episode := env.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: publicID, Title: publicID, Price: 500, Status: testutil.EpisodeStatusPublished, PublishedAt: purchasedAt})
		fixture.PaymentTaken(t, fixture.Credentials(), paymentprovidertest.Checkout{
			PaymentID: paymentID,
			Purchase:  paymentprovider.Purchase{Price: 500, Currency: "JPY"},
		}, purchasedAt)
		id := uuid.Must(uuid.NewV7())
		if _, err := env.PG.DB.ExecContext(context.Background(), `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency, purchased_at,
				provider, provider_checkout_id, provider_payment_id)
			VALUES ($1, $2, $3, $4, 500, 'JPY', $5, $6, $7, $8)
		`, id, admin.Tenant.ID, reader.ID, episode.ID, purchasedAt, fixture.Provider().Declaration().ID, "cs_"+paymentID, paymentID); err != nil {
			t.Fatalf("insert purchase: %v", err)
		}
		return id
	}
	byStripe := bought(stripeFixture, "EPISODESTR", "pi_both")
	byPayjp := bought(payjpFixture, "EPISODEPAY", "pfw_both")

	purchases := env.purchaseClient()
	for _, purchase := range []struct {
		id        uuid.UUID
		fixture   paymentprovidertest.Fixture
		paymentID string
	}{
		{byStripe, stripeFixture, "pi_both"},
		{byPayjp, payjpFixture, "pfw_both"},
	} {
		got, err := purchases.GetPurchase(ctx, &publiraadminv1.GetPurchaseRequest{Tenant: admin.tenantContext(), PurchaseId: purchase.id.String()})
		if err != nil || !got.Purchase.Refundable {
			t.Fatalf("GetPurchase %s = %+v, %v; want it refundable", purchase.paymentID, got, err)
		}
		if _, err := purchases.RefundPurchase(ctx, &publiraadminv1.RefundPurchaseRequest{
			Tenant: admin.tenantContext(), PurchaseId: purchase.id.String(), Reason: "Requested by the reader",
		}); err != nil {
			t.Fatalf("RefundPurchase %s: %v", purchase.paymentID, err)
		}
		if refunded := purchase.fixture.RefundedTotal(t, purchase.fixture.Credentials(), purchase.paymentID); refunded != 500 {
			t.Fatalf("%s refunded %d, want the whole 500 through its own provider", purchase.paymentID, refunded)
		}
	}

	reconciliations, err := env.reconciliationClient().StartPaymentReconciliation(ctx, &publiraadminv1.StartPaymentReconciliationRequest{
		Tenant: admin.tenantContext(), StartDate: "2026-03-01", EndDate: "2026-03-31",
	})
	if err != nil {
		t.Fatalf("StartPaymentReconciliation: %v", err)
	}
	if runs := reconciliations.Reconciliations; len(runs) != 2 || runs[0].Provider != stripe.ID || runs[1].Provider != payjp.ID {
		t.Fatalf("reconciliations = %+v, want one run per provider the tenant holds", runs)
	}

	// The refund waits for PAY.JP's notification, so PAY.JP keeps a payment a
	// refund may reach, and removing it retires it instead.
	removed, err := payments.RemoveTenantPaymentProvider(ctx, &publiraadminv1.RemoveTenantPaymentProviderRequest{Tenant: admin.tenantContext(), Provider: payjp.ID})
	if err != nil {
		t.Fatalf("RemoveTenantPaymentProvider: %v", err)
	}
	if got := providerIDs(removed.Providers); !removed.Retired || len(got) != 2 || got[1] != payjp.ID+" (retired)" {
		t.Fatalf("removed = %+v, want PAY.JP retired", removed)
	}
	if got, err := purchases.GetPurchase(ctx, &publiraadminv1.GetPurchaseRequest{Tenant: admin.tenantContext(), PurchaseId: byPayjp.String()}); err != nil || got.Purchase.Provider != payjp.ID {
		t.Fatalf("GetPurchase of the retired provider's purchase = %+v, %v", got, err)
	}
	if _, err := payments.RemoveTenantPaymentProvider(ctx, &publiraadminv1.RemoveTenantPaymentProviderRequest{Tenant: admin.tenantContext(), Provider: "unknown"}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("removing a provider the tenant does not hold: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	legacy, err := payments.GetTenantPaymentSettings(ctx, &publiraadminv1.GetTenantPaymentSettingsRequest{Tenant: admin.tenantContext()}) //nolint:staticcheck // the deprecated RPC answers the first provider for the console of the previous release
	if err != nil || legacy.Settings.Provider != stripe.ID || !legacy.Settings.Ready {
		t.Fatalf("GetTenantPaymentSettings = %+v, %v; want Stripe, the first provider", legacy, err)
	}
}
