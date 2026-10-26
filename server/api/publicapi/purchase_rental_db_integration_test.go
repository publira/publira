package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// A reader who rents an episode holds it for the rental period and may still
// buy the permanent copy, and one who holds the permanent copy may buy
// neither again. Each purchase keeps the kind it was paid for.
func TestDBARentalLeavesThePermanentCopyToBuy(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "RENTAL", "rental.example.com", "Rental tenant")
	user := pg.SeedEndUser(t, tenant.ID, "RENTALBUYER1", "rental-buyer@example.com", "Rental buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		Title:       "Paid episode",
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE episode_listings
		SET rental_price = 200,
			rental_period_hours = 48
		WHERE episode_id = $1
	`, episode.ID); err != nil {
		t.Fatalf("rent the episode: %v", err)
	}
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, providers.Registry(), nil, slog.Default()).Upsert(ctx, tenant.ID, stripeSettings(testCheckoutSecretKey, testCheckoutWebhookSecret), paymentsettings.AuditMeta{}); err != nil {
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

	catalog := publirav1connect.NewCatalogServiceClient(connect.NewClient(transport))
	detail, err := catalog.GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if got := detail.Episode; got.Price != 500 || got.RentalPrice != 200 || got.RentalPeriodHours != 48 {
		t.Fatalf("episode prices = (%d, rental %d for %dh), want (500, rental 200 for 48h)", got.Price, got.RentalPrice, got.RentalPeriodHours)
	}
	seriesDetail, err := catalog.GetSeriesDetail(ctx, &publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
	})
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if got := seriesDetail.Episodes; len(got) != 1 || got[0].RentalPrice != 200 || got[0].RentalPeriodHours != 48 {
		t.Fatalf("series episodes = %v, want the one rented at 200 for 48 hours", got)
	}

	start := func(kind publirattypesv1.PurchaseKind) error {
		_, err := purchases.StartEpisodeCheckout(testutil.WithBearer(ctx, token), &publirav1.StartEpisodeCheckoutRequest{
			EpisodeId: episode.ID.String(),
			Tenant:    tenantContext(tenant),
			Kind:      kind,
			// The rental's line item is named in the reader's locale, not
			// the tenant's.
			Locale: "en",
		})
		return err
	}
	// pay completes the checkout last started, as the provider reports it.
	pay := func(checkoutID string) {
		t.Helper()
		purchase := checkout.input.Purchase
		payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.completed", map[string]any{
			"id":             checkoutID,
			"object":         "checkout.session",
			"amount_total":   purchase.Price,
			"currency":       strings.ToLower(purchase.Currency),
			"payment_status": "paid",
			"livemode":       true,
			"payment_intent": "pi_" + checkoutID,
			"metadata":       stripetest.PurchaseMetadata(purchase),
		})
		if _, err := purchases.ProcessPaymentWebhook(ctx, stripeWebhookRequest(tenant.ID.String(), payload, signature)); err != nil {
			t.Fatalf("ProcessPaymentWebhook(%s): %v", checkoutID, err)
		}
	}

	if err := start(publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL); err != nil {
		t.Fatalf("StartEpisodeCheckout(rental): %v", err)
	}
	if got := checkout.input; got.Purchase.Kind != paymentprovider.KindRental || got.Purchase.Price != 200 || got.LineItemName != "Paid episode (rental, 48 hours)" {
		t.Fatalf("rental checkout = %+v, want a rental at 200 named for its period", got)
	}
	paidAt := time.Now()
	pay("cs_rental")

	var (
		kind      string
		expiresAt sql.NullTime
	)
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT kind, expires_at
		FROM purchases
		WHERE tenant_id = $1
			AND provider_checkout_id = 'cs_rental'
	`, tenant.ID).Scan(&kind, &expiresAt); err != nil {
		t.Fatalf("read the rental: %v", err)
	}
	if kind != "rental" {
		t.Fatalf("rental recorded as kind %q", kind)
	}
	if want := paidAt.Add(48 * time.Hour); !expiresAt.Valid || expiresAt.Time.Before(want.Add(-time.Minute)) || expiresAt.Time.After(want.Add(time.Minute)) {
		t.Fatalf("rental expires at %v, want about %v", expiresAt, want)
	}

	if err := start(publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("a second rental over an active one = %v, want already_exists", err)
	}

	// Once the rental runs out the reader may rent again, with the very
	// request they paid before, and that has to reach a checkout of its own
	// rather than the one the provider completed.
	paidKey := checkout.input.IdempotencyKey
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE purchases
		SET expires_at = now() - interval '1 minute'
		WHERE tenant_id = $1
			AND provider_checkout_id = 'cs_rental'
	`, tenant.ID); err != nil {
		t.Fatalf("let the rental run out: %v", err)
	}
	if err := start(publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL); err != nil {
		t.Fatalf("StartEpisodeCheckout(rental) after the rental ran out: %v", err)
	}
	if checkout.input.IdempotencyKey == paidKey {
		t.Fatalf("renting again reuses the key %q of the paid rental", paidKey)
	}
	if err := start(publirattypesv1.PurchaseKind_PURCHASE_KIND_UNSPECIFIED); err != nil {
		t.Fatalf("StartEpisodeCheckout(permanent copy) over a rental: %v", err)
	}
	if got := checkout.input.Purchase; got.Kind != paymentprovider.KindPurchase || got.Price != 500 {
		t.Fatalf("permanent copy checkout = %+v, want the permanent copy at 500", got)
	}
	pay("cs_permanent")

	for _, kind := range []publirattypesv1.PurchaseKind{publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE} {
		if err := start(kind); connect.CodeOf(err) != connect.CodeAlreadyExists {
			t.Fatalf("%s over the permanent copy = %v, want already_exists", kind, err)
		}
	}

	library, err := purchases.ListMyPurchases(testutil.WithBearer(ctx, token), &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	kinds := map[publirattypesv1.PurchaseKind]string{}
	for _, purchase := range library.Purchases {
		kinds[purchase.Kind] = strconv.Itoa(int(purchase.PriceAtPurchase)) + ":" + strconv.FormatBool(purchase.ExpiresAt != "")
	}
	want := map[publirattypesv1.PurchaseKind]string{
		publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL:   "200:true",
		publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE: "500:false",
	}
	if len(kinds) != len(want) || kinds[publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL] != want[publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL] || kinds[publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE] != want[publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE] {
		t.Fatalf("library (kind: price:expires) = %v, want %v", kinds, want)
	}
}

// A checkout started before an episode had two sales names no kind, and
// completes as the permanent copy it sold.
func TestDBACheckoutThatNamesNoKindIsRecordedAsThePermanentCopy(t *testing.T) {
	t.Parallel()

	env := newRefundWebhookEnv(t, "UNNAMEDKIND", "unnamed-kind.example.com", "pi_unnamed_kind")

	var kind string
	if err := env.pg.DB.QueryRowContext(context.Background(), `
		SELECT kind
		FROM purchases
		WHERE tenant_id = $1
	`, env.tenant.ID).Scan(&kind); err != nil {
		t.Fatalf("read purchase kind: %v", err)
	}
	if kind != "purchase" {
		t.Fatalf("kind = %q, want purchase", kind)
	}
}
