package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"strings"
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
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// A campaign open on an episode is quoted beside its price on the episode and
// in its series, and charged for the permanent copy, while the rental keeps
// its own price. A campaign that no longer undercuts the listing, and one not
// started yet, are neither quoted nor charged.
func TestDBACampaignPriceIsQuotedAndCharged(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "CAMPAIGN", "campaign.example.com", "Campaign tenant")
	user := pg.SeedEndUser(t, tenant.ID, "CAMPAIGNBUY1", "campaign-buyer@example.com", "Campaign buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "CAMPAIGNEP01",
		Title:       "Campaign episode",
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})
	ahead := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "CAMPAIGNEP02",
		Title:       "Episode on sale next week",
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
		OrderIndex:  2,
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
	endsAt := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	pg.SeedEpisodeCampaignPrice(t, tenant.ID, episode.ID, 300, time.Now().Add(-time.Hour), endsAt)
	pg.SeedEpisodeCampaignPrice(t, tenant.ID, ahead.ID, 300, time.Now().Add(7*24*time.Hour), time.Now().Add(14*24*time.Hour))
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
	catalog := publirav1connect.NewCatalogServiceClient(connect.NewClient(transport))
	token, _, err := testutil.TokenManager().Issue(user.PublicID, auth.AudiencePublic, tenant.ID.String(), user.Role, user.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	quoted := func(publicID string) *publirattypesv1.Episode {
		t.Helper()
		detail, err := catalog.GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: publicID})
		if err != nil {
			t.Fatalf("GetEpisodeDetail(%s): %v", publicID, err)
		}
		return detail.Episode
	}
	listed := func() map[string]*publirattypesv1.Episode {
		t.Helper()
		detail, err := catalog.GetSeriesDetail(ctx, &publirav1.GetSeriesDetailRequest{Tenant: tenantContext(tenant), PublicId: series.PublicID})
		if err != nil {
			t.Fatalf("GetSeriesDetail: %v", err)
		}
		episodes := make(map[string]*publirattypesv1.Episode, len(detail.Episodes))
		for _, listed := range detail.Episodes {
			episodes[listed.PublicId] = listed
		}
		return episodes
	}
	start := func(kind publirattypesv1.PurchaseKind) paymentprovider.Purchase {
		t.Helper()
		if _, err := purchases.StartEpisodeCheckout(testutil.WithBearer(ctx, token), &publirav1.StartEpisodeCheckoutRequest{
			EpisodeId: episode.ID.String(),
			Tenant:    tenantContext(tenant),
			Kind:      kind,
		}); err != nil {
			t.Fatalf("StartEpisodeCheckout(%s): %v", kind, err)
		}
		return checkout.input.Purchase
	}

	wantEndsAt := endsAt.Format(time.RFC3339)
	if got := quoted(episode.PublicID); got.Price != 500 || got.CampaignPrice != 300 || got.CampaignEndsAt != wantEndsAt || got.RentalPrice != 200 {
		t.Fatalf("episode = (price %d, campaign %d until %q, rental %d), want (500, 300 until %q, 200)", got.Price, got.CampaignPrice, got.CampaignEndsAt, got.RentalPrice, wantEndsAt)
	}
	if got := quoted(ahead.PublicID); got.CampaignPrice != 0 || got.CampaignEndsAt != "" {
		t.Fatalf("episode whose campaign has not started = (campaign %d until %q), want none", got.CampaignPrice, got.CampaignEndsAt)
	}
	rows := listed()
	if got := rows[episode.PublicID]; got == nil || got.CampaignPrice != 300 || got.CampaignEndsAt != wantEndsAt {
		t.Fatalf("listed episode = %v, want the campaign at 300 until %q", got, wantEndsAt)
	}
	if got := rows[ahead.PublicID]; got == nil || got.CampaignPrice != 0 || got.CampaignEndsAt != "" {
		t.Fatalf("listed episode whose campaign has not started = %v, want none", got)
	}

	if got := start(publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE); got.Kind != paymentprovider.KindPurchase || got.Price != 300 {
		t.Fatalf("permanent copy checkout = %+v, want the permanent copy at the campaign's 300", got)
	}
	if got := start(publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL); got.Kind != paymentprovider.KindRental || got.Price != 200 {
		t.Fatalf("rental checkout = %+v, want the rental at its own 200", got)
	}

	// An editor lowering the episode's price to the campaign's leaves the
	// campaign nothing to cut, so it stops being quoted and the episode sells
	// at its own price.
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE episode_listings
		SET price = 300
		WHERE episode_id = $1
	`, episode.ID); err != nil {
		t.Fatalf("lower the price: %v", err)
	}
	if got := quoted(episode.PublicID); got.Price != 300 || got.CampaignPrice != 0 || got.CampaignEndsAt != "" {
		t.Fatalf("episode priced at its campaign = (price %d, campaign %d until %q), want 300 and no campaign", got.Price, got.CampaignPrice, got.CampaignEndsAt)
	}
	if got := start(publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE); got.Price != 300 {
		t.Fatalf("permanent copy checkout = %+v, want the episode's own 300", got)
	}
}

// A reader who enters a promotion code at the checkout pays less than the
// checkout was started at. The purchase records what they paid and the code
// they paid it with, so a refund of the whole payment refunds it in full; a
// code that takes off the whole price still makes a purchase, with no payment
// behind it.
func TestDBAPromotionCodeRecordsWhatTheReaderPaid(t *testing.T) {
	env := newUnpaidRefundWebhookEnv(t, "PROMOCODE", "promotion-code.example.com")
	metadata := map[string]string{
		stripe.MetadataTenantID:  env.tenant.ID.String(),
		stripe.MetadataUserID:    env.user.ID.String(),
		stripe.MetadataEpisodeID: env.episode.ID.String(),
		stripe.MetadataPrice:     "500",
	}
	session := func(id string, total int, fields map[string]any) map[string]any {
		object := map[string]any{
			"id":              id,
			"object":          "checkout.session",
			"amount_subtotal": 500,
			"amount_total":    total,
			"currency":        "jpy",
			"payment_status":  "paid",
			"payment_intent":  "pi_" + id,
			"discounts":       []map[string]any{{"coupon": "co_spring", "promotion_code": "promo_spring"}},
			"total_details":   map[string]any{"amount_discount": 500 - total},
			"metadata":        metadata,
		}
		for key, value := range fields {
			object[key] = value
		}
		return object
	}
	recorded := func(checkoutID string) (int32, sql.NullString, sql.NullString) {
		t.Helper()
		var (
			price           int32
			paymentID       sql.NullString
			promotionCodeID sql.NullString
		)
		if err := env.pg.DB.QueryRowContext(context.Background(), `
			SELECT price_at_purchase, provider_payment_id, provider_promotion_code_id
			FROM purchases
			WHERE tenant_id = $1
				AND provider_checkout_id = $2
		`, env.tenant.ID, checkoutID).Scan(&price, &paymentID, &promotionCodeID); err != nil {
			t.Fatalf("read the purchase of %s: %v", checkoutID, err)
		}
		return price, paymentID, promotionCodeID
	}

	env.deliver(t, "checkout.session.completed", session("cs_promoted", 350, nil))
	price, paymentID, promotionCodeID := recorded("cs_promoted")
	if price != 350 || paymentID.String != "pi_cs_promoted" || promotionCodeID.String != "promo_spring" {
		t.Fatalf("purchase = (%d, %v, %v), want 350 paid on pi_cs_promoted with promo_spring", price, paymentID, promotionCodeID)
	}
	if !env.hasContentAccess(t) {
		t.Fatal("a purchase made with a promotion code does not open the episode")
	}

	env.deliver(t, "charge.refunded", refundedCharge("pi_cs_promoted", 350, 350))
	if amount, at := env.refundState(t); amount.Int32 != 350 || !at.Valid {
		t.Fatalf("refund = (%v, %v), want the 350 paid refunded in full", amount, at)
	}
	if env.hasContentAccess(t) {
		t.Fatal("a purchase refunded everything that was paid still opens the episode")
	}

	env.deliver(t, "checkout.session.completed", session("cs_free_code", 0, map[string]any{
		"payment_status": "no_payment_required",
		"payment_intent": nil,
	}))
	price, paymentID, promotionCodeID = recorded("cs_free_code")
	if price != 0 || paymentID.Valid || promotionCodeID.String != "promo_spring" {
		t.Fatalf("purchase = (%d, %v, %v), want nothing paid, no payment, and promo_spring", price, paymentID, promotionCodeID)
	}
	if !env.hasContentAccess(t) {
		t.Fatal("a purchase a promotion code paid for in full does not open the episode")
	}
}

// The line items a promotion code is entered against are the ones the checkout
// sells, so a code's subtotal is the price the checkout was started at, the
// campaign's while one is open.
func TestDBACampaignCheckoutAllowsPromotionCodes(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "CAMPPROMO", "campaign-promo.example.com", "Campaign promo tenant")
	user := pg.SeedEndUser(t, tenant.ID, "CAMPPROMOBY1", "campaign-promo@example.com", "Campaign promo buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		Title:       "Campaign episode",
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})
	pg.SeedEpisodeCampaignPrice(t, tenant.ID, episode.ID, 300, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, providers.Registry(), nil, slog.Default()).Upsert(ctx, tenant.ID, stripeSettings(testCheckoutSecretKey, testCheckoutWebhookSecret), paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	api := stripetest.NewAPI(t)
	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), openReaderGuards(), openMailGuard(), nil)
	server.paymentProviders = paymentprovider.NewRegistry(stripe.New(stripe.WithAPIURL(api.URL())))
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	purchases := publirav1connect.NewPurchaseServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	token, _, err := testutil.TokenManager().Issue(user.PublicID, auth.AudiencePublic, tenant.ID.String(), user.Role, user.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	if _, err := purchases.StartEpisodeCheckout(testutil.WithBearer(ctx, token), &publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: episode.ID.String(),
		Tenant:    tenantContext(tenant),
	}); err != nil {
		t.Fatalf("StartEpisodeCheckout: %v", err)
	}
	sessions := api.CheckoutSessions()
	if len(sessions) != 1 {
		t.Fatalf("checkout sessions = %d, want 1", len(sessions))
	}
	form := sessions[0].Form
	if form.Get("line_items[0][price_data][unit_amount]") != "300" || form.Get("metadata[price]") != "300" || form.Get("allow_promotion_codes") != "true" {
		t.Fatalf("session = %v, want one line at the campaign's 300 taking promotion codes", form)
	}
	if !strings.Contains(form.Get("line_items[0][price_data][product_data][name]"), "Campaign episode") {
		t.Fatalf("session = %v, want the line named for the episode", form)
	}
}
