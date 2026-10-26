package publicapi

import (
	"context"
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

// volumePurchaseEnv is a tenant selling one volume of two published episodes
// beside a third episode the volume does not hold, to a signed-in reader.
type volumePurchaseEnv struct {
	pg        *testutil.PostgresEnv
	tenant    testutil.Tenant
	series    testutil.Series
	volume    testutil.Volume
	inVolume  []testutil.Episode
	outside   testutil.Episode
	checkout  *capturingCheckoutProvider
	purchases publirav1connect.PurchaseServiceClient
	catalog   publirav1connect.CatalogServiceClient
	token     string
}

func newVolumePurchaseEnv(t *testing.T, slug, domain string) volumePurchaseEnv {
	t.Helper()
	pg := testutil.StartIsolatedPostgres(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, slug, domain, "Volume tenant")
	user := pg.SeedEndUser(t, tenant.ID, slug+"BUY", strings.ToLower(slug)+"-buyer@example.com", "Volume buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	paid := func(publicID, title string) testutil.Episode {
		return pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
			PublicID:    publicID,
			Title:       title,
			Price:       500,
			Status:      testutil.EpisodeStatusPublished,
			PublishedAt: time.Now().Add(-time.Hour),
		})
	}
	first, second, outside := paid("VOLEPISODE01", "First"), paid("VOLEPISODE02", "Second"), paid("VOLEPISODE03", "Outside")
	volume := pg.SeedVolume(t, tenant.ID, series.ID, testutil.VolumeSeed{
		Title:      "Volume One",
		Price:      900,
		Published:  true,
		EpisodeIDs: []uuid.UUID{first.ID, second.ID},
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
	transport := connecthttp.NewTransport(ts.Client(), ts.URL)
	token, _, err := testutil.TokenManager().Issue(user.PublicID, auth.AudiencePublic, tenant.ID.String(), user.Role, user.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return volumePurchaseEnv{
		pg:        pg,
		tenant:    tenant,
		series:    series,
		volume:    volume,
		inVolume:  []testutil.Episode{first, second},
		outside:   outside,
		checkout:  checkout,
		purchases: publirav1connect.NewPurchaseServiceClient(connect.NewClient(transport)),
		catalog:   publirav1connect.NewCatalogServiceClient(connect.NewClient(transport)),
		token:     token,
	}
}

func (env volumePurchaseEnv) startVolumeCheckout(ctx context.Context, volumeID uuid.UUID) error {
	_, err := env.purchases.StartVolumeCheckout(testutil.WithBearer(ctx, env.token), &publirav1.StartVolumeCheckoutRequest{
		Tenant:   tenantContext(env.tenant),
		VolumeId: volumeID.String(),
	})
	return err
}

// pay completes the checkout last started, as the provider reports it.
func (env volumePurchaseEnv) pay(t *testing.T, ctx context.Context, checkoutID string) {
	t.Helper()
	purchase := env.checkout.input.Purchase
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
	if _, err := env.purchases.ProcessPaymentWebhook(ctx, stripeWebhookRequest(env.tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("ProcessPaymentWebhook(%s): %v", checkoutID, err)
	}
}

// access answers the reader's access to each published episode of the
// series, by episode id.
func (env volumePurchaseEnv) access(t *testing.T, ctx context.Context) map[uuid.UUID]publirav1.EpisodeAccess {
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
	return access
}

// Buying a volume opens every episode it holds and none outside it, keeps the
// reader from paying for any of them again, and is listed in the library as
// the volume it bought.
func TestDBBuyingAVolumeOpensEveryEpisodeInItAndNoneOutside(t *testing.T) {
	t.Parallel()

	env := newVolumePurchaseEnv(t, "VOLUMEBUY", "volume-buy.example.com")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	detail, err := env.catalog.GetSeriesDetail(ctx, &publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(env.tenant),
		PublicId: env.series.PublicID,
	})
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if len(detail.Volumes) != 1 {
		t.Fatalf("volumes = %v, want the one on sale", detail.Volumes)
	}
	if got, want := detail.Volumes[0].EpisodeIds, []string{env.inVolume[0].ID.String(), env.inVolume[1].ID.String()}; strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("volume episode_ids = %v, want %v", got, want)
	}

	for id, access := range env.access(t, ctx) {
		if access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
			t.Fatalf("episode %s before the purchase = %s, want LOCKED", id, access)
		}
	}

	if err := env.startVolumeCheckout(ctx, env.volume.ID); err != nil {
		t.Fatalf("StartVolumeCheckout: %v", err)
	}
	started := env.checkout.input
	if started.Purchase.VolumeID != env.volume.ID || started.Purchase.EpisodeID != uuid.Nil || started.Purchase.Price != 900 || started.Purchase.Kind != paymentprovider.KindPurchase || started.Purchase.ReadingPeriodHours != 0 {
		t.Fatalf("checkout purchase = %+v, want the volume at 900 for good", started.Purchase)
	}
	if started.LineItemName != "Volume One" {
		t.Fatalf("line item = %q, want the volume's title", started.LineItemName)
	}
	success, err := url.Parse(started.SuccessURL)
	if err != nil {
		t.Fatalf("parse success URL: %v", err)
	}
	if success.Path != "/series/"+env.series.PublicID || success.Query().Get("volume") != env.volume.PublicID || success.Query().Get("checkout") != "success" {
		t.Fatalf("success URL = %s, want the series page naming the volume", started.SuccessURL)
	}
	if !strings.HasPrefix(started.IdempotencyKey, "volume-checkout:") {
		t.Fatalf("idempotency key = %q, want one of a volume checkout", started.IdempotencyKey)
	}

	env.pay(t, ctx, "cs_volume")
	// A redelivery of the same checkout records nothing more.
	env.pay(t, ctx, "cs_volume")

	var (
		purchaseCount int
		episodeID     uuid.NullUUID
		volumeID      uuid.NullUUID
		receipts      int
	)
	if err := env.pg.DB.QueryRowContext(ctx, `
		SELECT count(*) OVER (), episode_id, volume_id
		FROM purchases
		WHERE tenant_id = $1
	`, env.tenant.ID).Scan(&purchaseCount, &episodeID, &volumeID); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	if purchaseCount != 1 || episodeID.Valid || volumeID.UUID != env.volume.ID {
		t.Fatalf("purchases = %d, episode %v, volume %v; want one purchase of the volume and no episode", purchaseCount, episodeID, volumeID)
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

	access := env.access(t, ctx)
	for _, episode := range env.inVolume {
		if access[episode.ID] != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
			t.Fatalf("episode %s in the volume = %s, want ENTITLED", episode.Title, access[episode.ID])
		}
	}
	if access[env.outside.ID] != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("episode outside the volume = %s, want LOCKED", access[env.outside.ID])
	}
	episodeDetail, err := env.catalog.GetEpisodeDetail(testutil.WithBearer(ctx, env.token), &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(env.tenant),
		PublicId: env.inVolume[0].PublicID,
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if episodeDetail.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED || episodeDetail.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_PURCHASE {
		t.Fatalf("episode detail = (%s, %s), want ENTITLED by a purchase", episodeDetail.Access, episodeDetail.EntitlementSource)
	}

	if err := env.startVolumeCheckout(ctx, env.volume.ID); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("buying the volume again = %v, want already_exists", err)
	}
	startEpisode := func(episode testutil.Episode) error {
		_, err := env.purchases.StartEpisodeCheckout(testutil.WithBearer(ctx, env.token), &publirav1.StartEpisodeCheckoutRequest{
			Tenant:    tenantContext(env.tenant),
			EpisodeId: episode.ID.String(),
		})
		return err
	}
	if err := startEpisode(env.inVolume[1]); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("buying an episode of the bought volume = %v, want already_exists", err)
	}
	if err := startEpisode(env.outside); err != nil {
		t.Fatalf("buying the episode outside the volume: %v", err)
	}

	library, err := env.purchases.ListMyPurchases(testutil.WithBearer(ctx, env.token), &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(env.tenant)})
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	if len(library.Purchases) != 1 {
		t.Fatalf("library = %v, want the one purchase", library.Purchases)
	}
	bought := library.Purchases[0]
	if bought.Episode != nil || bought.GetVolume().GetId() != env.volume.ID.String() || bought.GetVolume().GetTitle() != "Volume One" {
		t.Fatalf("library purchase = %+v, want the volume and no episode", bought)
	}
	if bought.GetSeries().GetId() != env.series.ID.String() || !bought.IsActive || bought.PriceAtPurchase != 900 || bought.Kind != publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE {
		t.Fatalf("library purchase = %+v, want an active purchase at 900 of the volume's series", bought)
	}

	// A refund in full takes back every episode the volume opened.
	refund, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "charge.refunded", refundedCharge("pi_cs_volume", 900, 900))
	if _, err := env.purchases.ProcessPaymentWebhook(ctx, stripeWebhookRequest(env.tenant.ID.String(), refund, signature)); err != nil {
		t.Fatalf("ProcessPaymentWebhook(refund): %v", err)
	}
	for id, access := range env.access(t, ctx) {
		if access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
			t.Fatalf("episode %s after a full refund = %s, want LOCKED", id, access)
		}
	}
	if err := env.startVolumeCheckout(ctx, env.volume.ID); err != nil {
		t.Fatalf("buying the volume again after a full refund: %v", err)
	}
	if env.checkout.input.IdempotencyKey == started.IdempotencyKey {
		t.Fatalf("buying again reuses the key %q of the paid checkout", started.IdempotencyKey)
	}
}

// The purchase of a volume writes down what each of its episodes accounts for
// of the amount paid, in proportion to their prices when the payment arrives,
// with the parts adding up to the amount. A redelivery writes nothing more,
// and a price changed afterwards moves nothing.
func TestDBAVolumePurchaseRecordsTheEpisodesItPaidFor(t *testing.T) {
	t.Parallel()

	env := newVolumePurchaseEnv(t, "VOLPART", "volume-part.example.com")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := env.startVolumeCheckout(ctx, env.volume.ID); err != nil {
		t.Fatalf("StartVolumeCheckout: %v", err)
	}
	if _, err := env.pg.DB.ExecContext(ctx, "UPDATE episode_listings SET price = 300 WHERE episode_id = $1", env.inVolume[1].ID); err != nil {
		t.Fatalf("reprice the second episode: %v", err)
	}
	env.pay(t, ctx, "cs_volume_parts")
	env.pay(t, ctx, "cs_volume_parts")
	if _, err := env.pg.DB.ExecContext(ctx, "UPDATE episode_listings SET price = 100 WHERE episode_id = $1", env.inVolume[0].ID); err != nil {
		t.Fatalf("reprice the first episode: %v", err)
	}

	rows, err := env.pg.DB.QueryContext(ctx, `
		SELECT vpe.episode_id, vpe."position", vpe.list_price, vpe.price
		FROM volume_purchase_episodes vpe
			JOIN purchases p ON p.tenant_id = vpe.tenant_id
			AND p.id = vpe.purchase_id
		WHERE p.tenant_id = $1
			AND p.volume_id = $2
		ORDER BY vpe."position"
	`, env.tenant.ID, env.volume.ID)
	if err != nil {
		t.Fatalf("read the episodes of the purchase: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	type part struct {
		episodeID           uuid.UUID
		position, list, got int32
	}
	var parts []part
	for rows.Next() {
		var p part
		if err := rows.Scan(&p.episodeID, &p.position, &p.list, &p.got); err != nil {
			t.Fatalf("scan a part: %v", err)
		}
		parts = append(parts, p)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read the parts: %v", err)
	}
	want := []part{
		{env.inVolume[0].ID, 0, 500, 562},
		{env.inVolume[1].ID, 1, 300, 338},
	}
	if len(parts) != len(want) {
		t.Fatalf("parts = %+v, want %+v", parts, want)
	}
	for i := range want {
		if parts[i] != want[i] {
			t.Fatalf("part %d = %+v, want %+v", i, parts[i], want[i])
		}
	}
}

// A volume is sold only where it can be shown and only while it sells
// something the reader could open.
func TestDBStartVolumeCheckoutRefusesAVolumeNotOnSale(t *testing.T) {
	t.Parallel()

	env := newVolumePurchaseEnv(t, "VOLUMENOT", "volume-not.example.com")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	draft := env.pg.SeedEpisode(t, env.tenant.ID, env.series.ID, testutil.EpisodeSeed{PublicID: "VOLEPISODE04", Title: "Draft", Price: 500})
	unpublished := env.pg.SeedVolume(t, env.tenant.ID, env.series.ID, testutil.VolumeSeed{
		Title:      "Unpublished",
		OrderIndex: 1,
		EpisodeIDs: []uuid.UUID{env.outside.ID},
	})
	ofDrafts := env.pg.SeedVolume(t, env.tenant.ID, env.series.ID, testutil.VolumeSeed{
		Title:      "Drafts only",
		OrderIndex: 2,
		Published:  true,
		EpisodeIDs: []uuid.UUID{draft.ID},
	})
	for name, volumeID := range map[string]uuid.UUID{
		"an unpublished volume":         unpublished.ID,
		"a volume of no episode out":    ofDrafts.ID,
		"a volume of no series of ours": uuid.Must(uuid.NewV7()),
	} {
		if err := env.startVolumeCheckout(ctx, volumeID); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s = %v, want not_found", name, err)
		}
	}

	detail, err := env.catalog.GetSeriesDetail(ctx, &publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(env.tenant),
		PublicId: env.series.PublicID,
	})
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if len(detail.Volumes) != 1 || detail.Volumes[0].Id != env.volume.ID.String() {
		t.Fatalf("volumes = %v, want only the one on sale with an episode out", detail.Volumes)
	}
}

// A volume's checkout that expires unpaid moves the reader's next attempt
// onto a checkout of its own.
func TestDBAnExpiredVolumeCheckoutMovesTheNextAttemptOn(t *testing.T) {
	t.Parallel()

	env := newVolumePurchaseEnv(t, "VOLUMEEXP", "volume-expired.example.com")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := env.startVolumeCheckout(ctx, env.volume.ID); err != nil {
		t.Fatalf("StartVolumeCheckout: %v", err)
	}
	first := env.checkout.input
	payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.expired", map[string]any{
		"id":       "cs_volume_expired",
		"object":   "checkout.session",
		"currency": strings.ToLower(first.Purchase.Currency),
		"metadata": stripetest.PurchaseMetadata(first.Purchase),
	})
	if _, err := env.purchases.ProcessPaymentWebhook(ctx, stripeWebhookRequest(env.tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("ProcessPaymentWebhook(expired): %v", err)
	}
	var recorded string
	if err := env.pg.DB.QueryRowContext(ctx, `
		SELECT provider_checkout_id
		FROM expired_volume_checkouts
		WHERE tenant_id = $1
			AND volume_id = $2
	`, env.tenant.ID, env.volume.ID).Scan(&recorded); err != nil {
		t.Fatalf("read the expired volume checkout: %v", err)
	}
	if recorded != "cs_volume_expired" {
		t.Fatalf("expired checkout = %q, want cs_volume_expired", recorded)
	}
	if err := env.startVolumeCheckout(ctx, env.volume.ID); err != nil {
		t.Fatalf("StartVolumeCheckout after the expiry: %v", err)
	}
	if env.checkout.input.IdempotencyKey == first.IdempotencyKey {
		t.Fatalf("the attempt after an expiry reuses the key %q", first.IdempotencyKey)
	}
}

// Buying a volume buys each of its episodes, so a volume is sold, and listed,
// only on a surface where every one of them may be bought.
func TestDBAVolumeIsSoldOnlyWhereEveryEpisodeIsSold(t *testing.T) {
	t.Parallel()

	env := newVolumePurchaseEnv(t, "VOLUMESRF", "volume-surface.example.com")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if _, err := env.pg.DB.ExecContext(ctx, `
		UPDATE episodes
		SET purchase_availability = 'web'
		WHERE id = $1
	`, env.inVolume[1].ID); err != nil {
		t.Fatalf("sell an episode of the volume on the web alone: %v", err)
	}

	volumesOn := func(surface publirattypesv1.ClientSurface) []*publirattypesv1.Volume {
		t.Helper()
		detail, err := env.catalog.GetSeriesDetail(ctx, &publirav1.GetSeriesDetailRequest{
			Tenant:   tenantContext(env.tenant),
			PublicId: env.series.PublicID,
			Surface:  surface,
		})
		if err != nil {
			t.Fatalf("GetSeriesDetail(%s): %v", surface, err)
		}
		return detail.Volumes
	}
	if got := volumesOn(publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB); len(got) != 1 {
		t.Fatalf("volumes on the web = %v, want the volume", got)
	}
	if got := volumesOn(publirattypesv1.ClientSurface_CLIENT_SURFACE_APP); len(got) != 0 {
		t.Fatalf("volumes in the app = %v, want none: one of its episodes is not sold there", got)
	}

	_, err := env.purchases.StartVolumeCheckout(testutil.WithBearer(ctx, env.token), &publirav1.StartVolumeCheckoutRequest{
		Tenant:   tenantContext(env.tenant),
		VolumeId: env.volume.ID.String(),
		Client:   publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("buying the volume in the app = %v, want not_found", err)
	}
	if err := env.startVolumeCheckout(ctx, env.volume.ID); err != nil {
		t.Fatalf("buying the volume on the web: %v", err)
	}
}
