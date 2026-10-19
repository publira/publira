package publicapi

import (
	"context"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

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

// seriesRemainderEnv is a tenant selling a series of four published
// episodes, with a 10% bundle discount, to a signed-in reader who already
// holds the first: owned at 500, then 300, then 200 with a 48-hour reading
// period, and a free one.
type seriesRemainderEnv struct {
	pg        *testutil.PostgresEnv
	tenant    testutil.Tenant
	reader    testutil.TenantUser
	series    testutil.Series
	owned     testutil.Episode
	second    testutil.Episode
	lent      testutil.Episode
	free      testutil.Episode
	checkout  *capturingCheckoutProvider
	purchases publirav1connect.PurchaseServiceClient
	catalog   publirav1connect.CatalogServiceClient
	token     string
}

func newSeriesRemainderEnv(t *testing.T, slug, domain string) seriesRemainderEnv {
	t.Helper()
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, slug, domain, "Remainder tenant")
	reader := pg.SeedEndUser(t, tenant.ID, slug+"BUY", strings.ToLower(slug)+"-buyer@example.com", "Remainder buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := func(publicID, title string, price int32) testutil.Episode {
		return pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
			PublicID:    publicID,
			Title:       title,
			Price:       price,
			Status:      testutil.EpisodeStatusPublished,
			PublishedAt: time.Now().Add(-time.Hour),
		})
	}
	owned := episode(slug[:4]+"EPISODE1", "Owned", 500)
	second := episode(slug[:4]+"EPISODE2", "Second", 300)
	lent := episode(slug[:4]+"EPISODE3", "Lent", 200)
	free := episode(slug[:4]+"EPISODE4", "Free", 0)
	pg.SeedPurchase(t, tenant.ID, reader.ID, owned.ID, 500)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE episode_listings
		SET reading_period_hours = 48
		WHERE episode_id = $1
	`, lent.ID); err != nil {
		t.Fatalf("give an episode a reading period: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE series_listings
		SET bundle_discount_percent = 10
		WHERE series_id = $1
	`, series.ID); err != nil {
		t.Fatalf("give the series a bundle discount: %v", err)
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
	token, _, err := testutil.TokenManager().Issue(reader.PublicID, auth.AudiencePublic, tenant.ID.String(), reader.Role, reader.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return seriesRemainderEnv{
		pg:        pg,
		tenant:    tenant,
		reader:    reader,
		series:    series,
		owned:     owned,
		second:    second,
		lent:      lent,
		free:      free,
		checkout:  checkout,
		purchases: publirav1connect.NewPurchaseServiceClient(connect.NewClient(transport)),
		catalog:   publirav1connect.NewCatalogServiceClient(connect.NewClient(transport)),
		token:     token,
	}
}

func (env seriesRemainderEnv) startRemainderCheckout(ctx context.Context, seriesID uuid.UUID) error {
	_, err := env.purchases.StartSeriesRemainderCheckout(testutil.WithBearer(ctx, env.token), &publirav1.StartSeriesRemainderCheckoutRequest{
		Tenant:   tenantContext(env.tenant),
		SeriesId: seriesID.String(),
	})
	return err
}

// pay completes the checkout last started as Stripe reports a session of
// several line items with a coupon on it.
func (env seriesRemainderEnv) pay(t *testing.T, ctx context.Context, checkoutID string) {
	t.Helper()
	started := env.checkout.input
	lineItems := make([]map[string]any, 0, len(started.LineItems))
	subtotal := int32(0)
	for i, line := range started.LineItems {
		lineItems = append(lineItems, map[string]any{
			"id":           fmt.Sprintf("li_%s_%d", checkoutID, i),
			"object":       "item",
			"description":  line.Name,
			"amount_total": line.DiscountedPrice,
			"quantity":     1,
		})
		subtotal += line.Price
	}
	payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.completed", map[string]any{
		"id":              checkoutID,
		"object":          "checkout.session",
		"amount_subtotal": subtotal,
		"amount_total":    started.Purchase.Price,
		"total_details":   map[string]any{"amount_discount": subtotal - started.Purchase.Price},
		"line_items":      map[string]any{"object": "list", "data": lineItems},
		"currency":        strings.ToLower(started.Purchase.Currency),
		"payment_status":  "paid",
		"livemode":        true,
		"payment_intent":  "pi_" + checkoutID,
		"metadata":        stripetest.PurchaseMetadata(started.Purchase),
	})
	if _, err := env.purchases.ProcessPaymentWebhook(ctx, stripeWebhookRequest(env.tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("ProcessPaymentWebhook(%s): %v", checkoutID, err)
	}
}

// access answers the reader's access to each published episode of the
// series, by episode id, and the rest of the series it quotes.
func (env seriesRemainderEnv) access(t *testing.T, ctx context.Context) (map[uuid.UUID]publirav1.EpisodeAccess, *publirav1.SeriesRemainderOffer) {
	t.Helper()
	res, err := env.catalog.GetSeriesEpisodeAccess(testutil.WithBearer(ctx, env.token), &publirav1.GetSeriesEpisodeAccessRequest{
		Tenant:   tenantContext(env.tenant),
		SeriesId: env.series.ID.String(),
	})
	if err != nil {
		t.Fatalf("GetSeriesEpisodeAccess: %v", err)
	}
	access := make(map[uuid.UUID]publirav1.EpisodeAccess, len(res.Episodes))
	for _, episode := range res.Episodes {
		access[uuid.MustParse(episode.EpisodeId)] = episode.Access
	}
	return access, res.Remainder
}

// Buying the rest of a series sells every priced episode the reader does not
// hold, one line each, with the series' discount taken off the total; the
// payment is recorded once as a purchase of the bundle, which opens each of
// those episodes for as long as its own purchase would.
func TestDBBuyingTheRestOfASeriesOpensEveryEpisodeTheReaderDidNotHold(t *testing.T) {
	env := newSeriesRemainderEnv(t, "REMAINBUY", "remainder-buy.example.com")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	_, offer := env.access(t, ctx)
	if offer.GetEpisodeCount() != 2 || offer.GetListPrice() != 500 || offer.GetDiscountPercent() != 10 || offer.GetPrice() != 450 {
		t.Fatalf("offer = %+v, want 2 episodes at 500 less 10%%, 450", offer)
	}

	if err := env.startRemainderCheckout(ctx, env.series.ID); err != nil {
		t.Fatalf("StartSeriesRemainderCheckout: %v", err)
	}
	started := env.checkout.input
	purchase := started.Purchase
	if purchase.SeriesBundleID == uuid.Nil || purchase.EpisodeID != uuid.Nil || purchase.VolumeID != uuid.Nil || purchase.Price != 450 || purchase.Kind != paymentprovider.KindPurchase || purchase.ReadingPeriodHours != 0 {
		t.Fatalf("checkout purchase = %+v, want a bundle at 450", purchase)
	}
	wantLines := []paymentprovider.LineItem{
		{Name: "Second", Price: 300, DiscountedPrice: 270},
		{Name: "Lent", Price: 200, DiscountedPrice: 180},
	}
	if fmt.Sprint(started.LineItems) != fmt.Sprint(wantLines) {
		t.Fatalf("line items = %+v, want %+v", started.LineItems, wantLines)
	}
	if started.Discount == nil || started.Discount.Amount != 50 || started.Discount.Name == "" {
		t.Fatalf("discount = %+v, want 50 off under a name", started.Discount)
	}
	success, err := url.Parse(started.SuccessURL)
	if err != nil {
		t.Fatalf("parse success URL: %v", err)
	}
	if success.Path != "/series/"+env.series.PublicID || success.Query().Get("remainder") != "1" || success.Query().Get("checkout") != "success" {
		t.Fatalf("success URL = %s, want the series page naming the rest of the series", started.SuccessURL)
	}
	if !strings.HasPrefix(started.IdempotencyKey, "series-remainder-checkout:") {
		t.Fatalf("idempotency key = %q, want one of a remainder checkout", started.IdempotencyKey)
	}

	// A retried request is the same checkout of the same bundle.
	if err := env.startRemainderCheckout(ctx, env.series.ID); err != nil {
		t.Fatalf("StartSeriesRemainderCheckout again: %v", err)
	}
	if env.checkout.input.IdempotencyKey != started.IdempotencyKey || env.checkout.input.Purchase.SeriesBundleID != purchase.SeriesBundleID {
		t.Fatalf("retry = (%q, %s), want (%q, %s)", env.checkout.input.IdempotencyKey, env.checkout.input.Purchase.SeriesBundleID, started.IdempotencyKey, purchase.SeriesBundleID)
	}
	var bundles, bundleEpisodes int
	if err := env.pg.DB.QueryRowContext(ctx, `
		SELECT count(DISTINCT b.id), count(sbe.episode_id)
		FROM series_bundles b
			JOIN series_bundle_episodes sbe ON sbe.series_bundle_id = b.id
		WHERE b.tenant_id = $1
	`, env.tenant.ID).Scan(&bundles, &bundleEpisodes); err != nil {
		t.Fatalf("count bundles: %v", err)
	}
	if bundles != 1 || bundleEpisodes != 2 {
		t.Fatalf("bundles = %d holding %d episodes, want one holding 2", bundles, bundleEpisodes)
	}

	env.pay(t, ctx, "cs_remainder")
	// A redelivery of the same checkout records nothing more.
	env.pay(t, ctx, "cs_remainder")

	var (
		purchaseCount  int
		seriesBundleID uuid.NullUUID
		price          int32
		receipts       int
	)
	if err := env.pg.DB.QueryRowContext(ctx, `
		SELECT count(*) OVER (), series_bundle_id, price_at_purchase
		FROM purchases
		WHERE tenant_id = $1
			AND provider_checkout_id IS NOT NULL
	`, env.tenant.ID).Scan(&purchaseCount, &seriesBundleID, &price); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	if purchaseCount != 1 || seriesBundleID.UUID != purchase.SeriesBundleID || price != 450 {
		t.Fatalf("purchases = %d, bundle %v at %d; want one purchase of the bundle at 450", purchaseCount, seriesBundleID, price)
	}
	if err := env.pg.DB.QueryRowContext(ctx, `
		SELECT count(*)
		FROM outbox_events
		WHERE tenant_id = $1
			AND event_type = 'purchase_receipt'
	`, env.tenant.ID).Scan(&receipts); err != nil {
		t.Fatalf("count receipts: %v", err)
	}
	if receipts != 1 {
		t.Fatalf("receipts queued = %d, want 1", receipts)
	}

	access, offer := env.access(t, ctx)
	for _, episode := range []testutil.Episode{env.owned, env.second, env.lent} {
		if access[episode.ID] != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
			t.Fatalf("episode %s after the purchase = %s, want ENTITLED", episode.Title, access[episode.ID])
		}
	}
	if offer != nil {
		t.Fatalf("offer after buying the rest = %+v, want none", offer)
	}
	if err := env.startRemainderCheckout(ctx, env.series.ID); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("buying the rest again = %v, want already_exists", err)
	}
	if _, err := env.purchases.StartEpisodeCheckout(testutil.WithBearer(ctx, env.token), &publirav1.StartEpisodeCheckoutRequest{
		Tenant:    tenantContext(env.tenant),
		EpisodeId: env.second.ID.String(),
	}); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("buying an episode of the bought bundle = %v, want already_exists", err)
	}

	library, err := env.purchases.ListMyPurchases(testutil.WithBearer(ctx, env.token), &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(env.tenant)})
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	var bought *publirav1.MyPurchase
	for _, item := range library.Purchases {
		if item.GetSeriesBundle() != nil {
			bought = item
		}
	}
	if bought == nil || bought.Episode != nil || bought.Volume != nil {
		t.Fatalf("library = %v, want the bundle and no episode or volume on it", library.Purchases)
	}
	if bundle := bought.GetSeriesBundle(); bundle.Id != purchase.SeriesBundleID.String() || bundle.EpisodeCount != 2 || bundle.DiscountPercent != 10 {
		t.Fatalf("library bundle = %+v, want the 2 episodes bought at 10%% off", bundle)
	}
	if bought.GetSeries().GetId() != env.series.ID.String() || !bought.IsActive || bought.PriceAtPurchase != 450 || bought.ExpiresAt != "" || bought.Kind != publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE {
		t.Fatalf("library purchase = %+v, want an active purchase at 450 of the series, with no expiry of its own", bought)
	}

	// The episode whose own purchase had a reading period closes when it runs
	// out, and is the rest of the series once more; the other stays open.
	if _, err := env.pg.DB.ExecContext(ctx, `
		UPDATE purchases
		SET purchased_at = purchased_at - interval '49 hours'
		WHERE series_bundle_id = $1
	`, purchase.SeriesBundleID); err != nil {
		t.Fatalf("age the purchase: %v", err)
	}
	access, offer = env.access(t, ctx)
	if access[env.lent.ID] != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED || access[env.second.ID] != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
		t.Fatalf("after the reading period = lent %s, second %s; want LOCKED and ENTITLED", access[env.lent.ID], access[env.second.ID])
	}
	if offer.GetEpisodeCount() != 1 || offer.GetPrice() != 180 {
		t.Fatalf("offer after the reading period = %+v, want the lent episode at 180", offer)
	}

	// A refund in full takes back every episode the bundle opened.
	refund, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "charge.refunded", refundedCharge("pi_cs_remainder", 450, 450))
	if _, err := env.purchases.ProcessPaymentWebhook(ctx, stripeWebhookRequest(env.tenant.ID.String(), refund, signature)); err != nil {
		t.Fatalf("ProcessPaymentWebhook(refund): %v", err)
	}
	access, _ = env.access(t, ctx)
	if access[env.second.ID] != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED || access[env.owned.ID] != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
		t.Fatalf("after a full refund = second %s, owned %s; want LOCKED and ENTITLED", access[env.second.ID], access[env.owned.ID])
	}
}

// The rest of a series is no sale when nothing is left to sell, when more is
// left than one checkout lists, or when the reader is credited on part of it.
func TestDBStartSeriesRemainderCheckoutRefusesWhatItCannotSell(t *testing.T) {
	env := newSeriesRemainderEnv(t, "REMAINNOT", "remainder-not.example.com")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := env.startRemainderCheckout(ctx, uuid.Must(uuid.NewV7())); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("a series of no tenant of ours = %v, want not_found", err)
	}

	freeSeries := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "REMAINFREESR", Published: true})
	env.pg.SeedEpisode(t, env.tenant.ID, freeSeries.ID, testutil.EpisodeSeed{
		PublicID: "REMAINFREE01",
		Title:    "Free for all",
		Status:   testutil.EpisodeStatusPublished,
	})
	if err := env.startRemainderCheckout(ctx, freeSeries.ID); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a series of free episodes = %v, want failed_precondition", err)
	}

	creator := env.pg.SeedCreator(t, env.tenant.ID, testutil.CreatorSeed{PublicID: "REMAINCRED01", Name: "Credited"})
	env.pg.SeedEpisodeCreator(t, env.tenant.ID, env.lent.ID, creator.ID, "")
	env.pg.SeedCreatorAccount(t, env.tenant.ID, creator.ID, env.reader.ID)
	if err := env.startRemainderCheckout(ctx, env.series.ID); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a reader credited on part of the rest = %v, want permission_denied", err)
	}
	if _, offer := env.access(t, ctx); offer != nil {
		t.Fatalf("offer to a credited reader = %+v, want none", offer)
	}

	long := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "REMAINLONGSR", Published: true})
	for i := range maxSeriesRemainderEpisodes + 1 {
		env.pg.SeedEpisode(t, env.tenant.ID, long.ID, testutil.EpisodeSeed{
			PublicID: fmt.Sprintf("REMAINLONG%02X", i),
			Title:    fmt.Sprintf("Episode %d", i+1),
			Price:    100,
			Status:   testutil.EpisodeStatusPublished,
		})
	}
	if err := env.startRemainderCheckout(ctx, long.ID); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a series with more left than one checkout lists = %v, want failed_precondition", err)
	}
}

// A remainder checkout that expires unpaid moves the reader's next attempt
// onto a checkout of its own.
func TestDBAnExpiredRemainderCheckoutMovesTheNextAttemptOn(t *testing.T) {
	env := newSeriesRemainderEnv(t, "REMAINEXP", "remainder-expired.example.com")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := env.startRemainderCheckout(ctx, env.series.ID); err != nil {
		t.Fatalf("StartSeriesRemainderCheckout: %v", err)
	}
	first := env.checkout.input
	payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.expired", map[string]any{
		"id":       "cs_remainder_expired",
		"object":   "checkout.session",
		"currency": strings.ToLower(first.Purchase.Currency),
		"metadata": stripetest.PurchaseMetadata(first.Purchase),
	})
	if _, err := env.purchases.ProcessPaymentWebhook(ctx, stripeWebhookRequest(env.tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("ProcessPaymentWebhook(expired): %v", err)
	}
	var recorded string
	if err := env.pg.DB.QueryRowContext(ctx, `
		SELECT expired_provider_checkout_id
		FROM series_bundles
		WHERE tenant_id = $1
			AND id = $2
	`, env.tenant.ID, first.Purchase.SeriesBundleID).Scan(&recorded); err != nil {
		t.Fatalf("read the expired checkout: %v", err)
	}
	if recorded != "cs_remainder_expired" {
		t.Fatalf("expired checkout = %q, want cs_remainder_expired", recorded)
	}
	if err := env.startRemainderCheckout(ctx, env.series.ID); err != nil {
		t.Fatalf("StartSeriesRemainderCheckout after the expiry: %v", err)
	}
	next := env.checkout.input
	if next.IdempotencyKey == first.IdempotencyKey || next.Purchase.SeriesBundleID == first.Purchase.SeriesBundleID {
		t.Fatalf("the attempt after an expiry reuses the key %q or the bundle %s", first.IdempotencyKey, first.Purchase.SeriesBundleID)
	}
}

// A checkout started again after an editor changed what one of its episodes
// opens for is a checkout of its own, whose bundle records the new period:
// the request alone names the lines by title and price, which the change
// leaves as they were.
func TestDBARemainderCheckoutStartedAfterAPeriodChangeIsANewOne(t *testing.T) {
	env := newSeriesRemainderEnv(t, "REMAINPER", "remainder-period.example.com")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := env.startRemainderCheckout(ctx, env.series.ID); err != nil {
		t.Fatalf("StartSeriesRemainderCheckout: %v", err)
	}
	first := env.checkout.input
	if _, err := env.pg.DB.ExecContext(ctx, `
		UPDATE episode_listings
		SET reading_period_hours = 72
		WHERE episode_id = $1
	`, env.lent.ID); err != nil {
		t.Fatalf("change the reading period: %v", err)
	}
	if err := env.startRemainderCheckout(ctx, env.series.ID); err != nil {
		t.Fatalf("StartSeriesRemainderCheckout after the change: %v", err)
	}
	next := env.checkout.input
	if next.IdempotencyKey == first.IdempotencyKey || next.Purchase.SeriesBundleID == first.Purchase.SeriesBundleID {
		t.Fatalf("the checkout after the change reuses the key %q or the bundle %s", first.IdempotencyKey, first.Purchase.SeriesBundleID)
	}
	var hours int32
	if err := env.pg.DB.QueryRowContext(ctx, `
		SELECT reading_period_hours
		FROM series_bundle_episodes
		WHERE series_bundle_id = $1
			AND episode_id = $2
	`, next.Purchase.SeriesBundleID, env.lent.ID).Scan(&hours); err != nil {
		t.Fatalf("read the new bundle's period: %v", err)
	}
	if hours != 72 {
		t.Fatalf("new bundle's period = %d, want 72", hours)
	}
}
