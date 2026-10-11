package publicapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// A tenant that sells in USD charges, records, refunds, and reports the price
// it set as cents, and takes nothing paid in another currency for a purchase.
func TestDBATenantInADecimalCurrencySellsInIt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "PAYUSD", "pay-usd.example.com", "Pay USD")
	user := pg.SeedEndUser(t, tenant.ID, "PAYUSDUSER01", "usd-buyer@example.com", "USD buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		Price:       499,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	settings := stripeSettings(testCheckoutSecretKey, testCheckoutWebhookSecret)
	settings.Currency = "USD"
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, providers.Registry(), nil, slog.Default()).Upsert(ctx, tenant.ID, settings, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	checkout := newCapturingCheckoutProvider()
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), openReaderGuards(), openMailGuard(), nil)
	server.paymentProviders = paymentprovider.NewRegistry(checkout)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	transport := connecthttp.NewTransport(ts.Client(), ts.URL)
	purchases := publirav1connect.NewPurchaseServiceClient(connect.NewClient(transport))
	token, _, err := testutil.TokenManager().Issue(user.PublicID, auth.AudiencePublic, tenant.ID.String(), user.Role, user.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	tenantResp, err := publirav1connect.NewTenantServiceClient(connect.NewClient(transport)).GetTenant(ctx, &publirav1.GetTenantRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if tenantResp.Currency != "USD" {
		t.Fatalf("GetTenant currency = %q, want USD", tenantResp.Currency)
	}

	if _, err := purchases.StartEpisodeCheckout(testutil.WithBearer(ctx, token), &publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: episode.ID.String(),
		Tenant:    tenantContext(tenant),
	}); err != nil {
		t.Fatalf("StartEpisodeCheckout: %v", err)
	}
	if got := checkout.input.Purchase; got.Price != 499 || got.Currency != "USD" {
		t.Fatalf("checkout charges %d %s, want 499 USD", got.Price, got.Currency)
	}

	deliver := func(eventType string, object map[string]any) error {
		payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, eventType, object)
		_, err := purchases.ProcessPaymentWebhook(ctx, stripeWebhookRequest(tenant.ID.String(), payload, signature))
		return err
	}
	paidSession := func(id, currency string) map[string]any {
		return map[string]any{
			"id":             id,
			"object":         "checkout.session",
			"amount_total":   499,
			"currency":       currency,
			"payment_status": "paid",
			"payment_intent": "pi_" + id,
			"metadata": map[string]string{
				stripe.MetadataTenantID:  tenant.ID.String(),
				stripe.MetadataUserID:    user.ID.String(),
				stripe.MetadataEpisodeID: episode.ID.String(),
				stripe.MetadataPrice:     strconv.Itoa(499),
			},
		}
	}
	refundOf := func(id, currency string, amountRefunded int64) map[string]any {
		return map[string]any{
			"id":              "ch_" + id,
			"object":          "charge",
			"currency":        currency,
			"amount":          499,
			"amount_refunded": amountRefunded,
			"payment_intent":  "pi_" + id,
		}
	}

	if err := deliver("checkout.session.completed", paidSession("cs_usd_yen", "jpy")); err == nil {
		t.Fatal("a checkout paid in JPY was accepted for a tenant in USD")
	}
	if err := deliver("checkout.session.completed", paidSession("cs_usd", "usd")); err != nil {
		t.Fatalf("checkout paid in USD: %v", err)
	}

	library, err := purchases.ListMyPurchases(testutil.WithBearer(ctx, token), &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	if len(library.Purchases) != 1 {
		t.Fatalf("purchases = %d, want only the one paid in USD", len(library.Purchases))
	}
	if got := library.Purchases[0]; got.PriceAtPurchase != 499 || got.Currency != "USD" {
		t.Fatalf("purchase = %d %s, want 499 USD", got.PriceAtPurchase, got.Currency)
	}

	refundedAmount := func() int32 {
		t.Helper()
		var amount int32
		if err := pg.DB.QueryRowContext(ctx, `SELECT COALESCE(refunded_amount, 0) FROM purchases WHERE tenant_id = $1`, tenant.ID).Scan(&amount); err != nil {
			t.Fatalf("read refunded amount: %v", err)
		}
		return amount
	}
	if err := deliver("charge.refunded", refundOf("cs_usd", "usd", 200)); err != nil {
		t.Fatalf("partial refund in USD: %v", err)
	}
	if got := refundedAmount(); got != 200 {
		t.Fatalf("refunded amount = %d, want the 200 cents refunded", got)
	}
	// An amount in another currency is not comparable to the price, so the
	// refund is recorded as one of the whole of it.
	if err := deliver("charge.refunded", refundOf("cs_usd", "jpy", 300)); err != nil {
		t.Fatalf("refund in JPY: %v", err)
	}
	if got := refundedAmount(); got != 499 {
		t.Fatalf("refunded amount = %d, want the whole 499 for a refund in another currency", got)
	}
}
