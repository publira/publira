package publicapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// purchaseSurfaceEnv is a public API on the test database whose Stripe sessions
// are captured instead of created, for a tenant that accepts payments.
type purchaseSurfaceEnv struct {
	pg       *testutil.PostgresEnv
	ts       *httptest.Server
	checkout *capturingCheckoutProvider
	tenant   testutil.Tenant
	token    string
}

func newPurchaseSurfaceEnv(t *testing.T) purchaseSurfaceEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "PAYSURF", "pay-surface.example.com", "Pay Surface")
	user := pg.SeedEndUser(t, tenant.ID, "PAYSURFUSR01", "surface-buyer@example.com", "Surface Buyer")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, nil, slog.Default()).Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Enabled:                 true,
		SecretKey:               testCheckoutSecretKey,
		SecretKeyUpdateMode:     paymentsettings.SecretUpdateModeReplace,
		WebhookSecret:           testCheckoutWebhookSecret,
		WebhookSecretUpdateMode: paymentsettings.SecretUpdateModeReplace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	checkout := &capturingCheckoutProvider{url: "https://checkout.stripe.test/cs_test"}
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), slog.Default(), openReaderGuards(), openMailGuard())
	server.newStripeProvider = func(string) stripeSessionCreator { return checkout }
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)

	token, _, err := testutil.TokenManager().Issue(user.PublicID, auth.AudiencePublic, tenant.ID.String(), user.Role, user.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return purchaseSurfaceEnv{pg: pg, ts: ts, checkout: checkout, tenant: tenant, token: token}
}

func (e purchaseSurfaceEnv) exec(t *testing.T, statement string, args ...any) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := e.pg.DB.ExecContext(ctx, statement, args...); err != nil {
		t.Fatalf("%s: %v", statement, err)
	}
}

func (e purchaseSurfaceEnv) setTenantDefault(t *testing.T, value string) {
	t.Helper()
	e.exec(t, `
		INSERT INTO tenant_config (tenant_id, purchase_availability) VALUES ($1, $2)
		ON CONFLICT (tenant_id) DO UPDATE SET purchase_availability = EXCLUDED.purchase_availability
	`, e.tenant.ID, value)
}

func (e purchaseSurfaceEnv) setEpisodePurchase(t *testing.T, episodeID uuid.UUID, value any) {
	t.Helper()
	e.exec(t, `UPDATE episodes SET purchase_availability = $2 WHERE id = $1`, episodeID, value)
}

// startCheckout answers the code a checkout from client ends with, and whether
// it created a Stripe session.
func (e purchaseSurfaceEnv) startCheckout(t *testing.T, episodePublicID string, client publirav1.StartEpisodeCheckoutRequest_Client) (connect.Code, bool) {
	t.Helper()

	e.checkout.input = stripeCheckoutInput{}
	_, err := publirav1connect.NewPurchaseServiceClient(e.ts.Client(), e.ts.URL).StartEpisodeCheckout(context.Background(), newBearerRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodePublicId: episodePublicID,
		Tenant:          tenantContext(e.tenant),
		Client:          client,
	}, e.token))
	var code connect.Code
	if err != nil {
		code = connect.CodeOf(err)
	}
	return code, e.checkout.input.successURL != ""
}

const (
	checkoutFromWeb    = publirav1.StartEpisodeCheckoutRequest_CLIENT_WEB
	checkoutFromApp    = publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE
	checkoutFromAnyone = publirav1.StartEpisodeCheckoutRequest_CLIENT_UNSPECIFIED
	checkoutSucceeded  = connect.Code(0)
)

// A checkout is refused from a surface the episode is not sold on, resolved
// from the tenant through the series to the episode, and an episode sold on
// both surfaces is bought from either exactly as before.
func TestDBStartEpisodeCheckoutRefusesASurfaceThatMayNotSellTheEpisode(t *testing.T) {
	env := newPurchaseSurfaceEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "PAYSURFSR001", Title: "Sold Apart", Published: true})
	episode := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYSURFEP001", Status: testutil.EpisodeStatusPublished, Price: 500})

	steps := []struct {
		name    string
		arrange func()
		client  publirav1.StartEpisodeCheckoutRequest_Client
		want    connect.Code
	}{
		{name: "both surfaces, from the storefront", arrange: func() {}, client: checkoutFromWeb, want: checkoutSucceeded},
		{name: "both surfaces, from the app", arrange: func() {}, client: checkoutFromApp, want: checkoutSucceeded},
		{name: "an app-only tenant, from the storefront", arrange: func() { env.setTenantDefault(t, "app") }, client: checkoutFromWeb, want: connect.CodeFailedPrecondition},
		{name: "an app-only tenant, from an unnamed client", arrange: func() {}, client: checkoutFromAnyone, want: connect.CodeFailedPrecondition},
		{name: "an app-only tenant, from the app", arrange: func() {}, client: checkoutFromApp, want: checkoutSucceeded},
		{name: "a series sold on the web, from the app", arrange: func() {
			env.exec(t, `UPDATE series SET purchase_availability = 'web' WHERE id = $1`, series.ID)
		}, client: checkoutFromApp, want: connect.CodeFailedPrecondition},
		{name: "a series sold on the web, from the storefront", arrange: func() {}, client: checkoutFromWeb, want: checkoutSucceeded},
		{name: "an episode sold in the app, from the storefront", arrange: func() { env.setEpisodePurchase(t, episode.ID, "app") }, client: checkoutFromWeb, want: connect.CodeFailedPrecondition},
		{name: "an episode sold in the app, from the app", arrange: func() {}, client: checkoutFromApp, want: checkoutSucceeded},
		{name: "an episode following its series again", arrange: func() { env.setEpisodePurchase(t, episode.ID, nil) }, client: checkoutFromApp, want: connect.CodeFailedPrecondition},
	}
	for _, step := range steps {
		step.arrange()
		code, created := env.startCheckout(t, episode.PublicID, step.client)
		if code != step.want {
			t.Fatalf("%s: code = %v, want %v", step.name, code, step.want)
		}
		if created != (step.want == checkoutSucceeded) {
			t.Fatalf("%s: created a Stripe session = %v", step.name, created)
		}
	}
}

// A surface that may not show the episode cannot sell it either, and answers as
// the catalog does for a work it does not have.
func TestDBStartEpisodeCheckoutOfAnEpisodeTheSurfaceDoesNotShowIsNotFound(t *testing.T) {
	env := newPurchaseSurfaceEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "PAYSURFSR002", Title: "Shown Apart", Published: true})
	episode := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYSURFEP002", Status: testutil.EpisodeStatusPublished, Price: 500, Availability: "app"})

	if code, created := env.startCheckout(t, episode.PublicID, checkoutFromWeb); code != connect.CodeNotFound || created {
		t.Fatalf("storefront checkout of an app-only episode = %v (session %v), want not_found and none", code, created)
	}
	if code, created := env.startCheckout(t, episode.PublicID, checkoutFromApp); code != checkoutSucceeded || !created {
		t.Fatalf("app checkout of an app-only episode = %v (session %v), want success", code, created)
	}
}

// The episode reads carry where an episode may be bought, resolved, so a client
// draws the action the checkout will accept; the tenant read carries the store
// listings a reader is sent to.
func TestDBCatalogReadsCarryWhereAnEpisodeMayBeBought(t *testing.T) {
	env := newPurchaseSurfaceEnv(t)
	env.setTenantDefault(t, "app")
	env.exec(t, `
		UPDATE tenant_config
		SET app_store_url = 'https://apps.apple.com/app/id123456789',
			google_play_url = 'https://play.google.com/store/apps/details?id=com.example.reader'
		WHERE tenant_id = $1
	`, env.tenant.ID)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "PAYSURFSR003", Title: "Sold Apart", Published: true})
	following := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYSURFEP003", Status: testutil.EpisodeStatusPublished, Price: 500})
	webSold := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYSURFEP004", Status: testutil.EpisodeStatusPublished, Price: 500, PurchaseAvailability: "web"})

	catalog := publirav1connect.NewCatalogServiceClient(env.ts.Client(), env.ts.URL)
	ctx := context.Background()
	want := map[string]publirattypesv1.SurfaceAvailability{
		following.PublicID: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
		webSold.PublicID:   publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB,
	}

	detail, err := catalog.GetSeriesDetail(ctx, connect.NewRequest(&publirav1.GetSeriesDetailRequest{Tenant: tenantContext(env.tenant), PublicId: series.PublicID}))
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if len(detail.Msg.Episodes) != len(want) {
		t.Fatalf("series detail lists %d episodes, want %d", len(detail.Msg.Episodes), len(want))
	}
	for _, episode := range detail.Msg.Episodes {
		if episode.PurchaseAvailability != want[episode.PublicId] {
			t.Fatalf("series detail episode %s purchase_availability = %s, want %s", episode.PublicId, episode.PurchaseAvailability, want[episode.PublicId])
		}
	}
	for publicID, wantAvailability := range want {
		got, err := catalog.GetEpisodeDetail(ctx, connect.NewRequest(&publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(env.tenant), PublicId: publicID}))
		if err != nil {
			t.Fatalf("GetEpisodeDetail %s: %v", publicID, err)
		}
		if got.Msg.Episode.PurchaseAvailability != wantAvailability {
			t.Fatalf("episode detail %s purchase_availability = %s, want %s", publicID, got.Msg.Episode.PurchaseAvailability, wantAvailability)
		}
	}

	tenant, err := publirav1connect.NewTenantServiceClient(env.ts.Client(), env.ts.URL).GetTenant(ctx, connect.NewRequest(&publirav1.GetTenantRequest{Tenant: tenantContext(env.tenant)}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if tenant.Msg.AppStoreUrl != "https://apps.apple.com/app/id123456789" ||
		tenant.Msg.GooglePlayUrl != "https://play.google.com/store/apps/details?id=com.example.reader" {
		t.Fatalf("store listings = %q, %q", tenant.Msg.AppStoreUrl, tenant.Msg.GooglePlayUrl)
	}
}

// The links either side of an episode carry where each neighbour may be bought,
// resolved from the tenant through the series to the neighbour as the episode
// read resolves it, so the storefront does not quote a price it cannot take.
func TestDBEpisodeNeighborsCarryWhereTheyMayBeBought(t *testing.T) {
	env := newPurchaseSurfaceEnv(t)
	env.setTenantDefault(t, "web")
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "PAYSURFSR004", Title: "Neighbours Apart", Published: true})
	previous := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYSURFEP005", Status: testutil.EpisodeStatusPublished, Price: 500, PurchaseAvailability: "app"})
	current := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYSURFEP006", Status: testutil.EpisodeStatusPublished, Price: 500})
	next := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYSURFEP007", Status: testutil.EpisodeStatusPublished, Price: 500})

	catalog := publirav1connect.NewCatalogServiceClient(env.ts.Client(), env.ts.URL)
	neighbors := func() (previousAvailability, nextAvailability publirattypesv1.SurfaceAvailability) {
		t.Helper()
		got, err := catalog.GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(env.tenant), PublicId: current.PublicID}))
		if err != nil {
			t.Fatalf("GetEpisodeDetail: %v", err)
		}
		if got.Msg.PreviousEpisode.GetPublicId() != previous.PublicID || got.Msg.NextEpisode.GetPublicId() != next.PublicID {
			t.Fatalf("neighbours = %q, %q", got.Msg.PreviousEpisode.GetPublicId(), got.Msg.NextEpisode.GetPublicId())
		}
		return got.Msg.PreviousEpisode.PurchaseAvailability, got.Msg.NextEpisode.PurchaseAvailability
	}

	steps := []struct {
		name         string
		arrange      func()
		wantPrevious publirattypesv1.SurfaceAvailability
		wantNext     publirattypesv1.SurfaceAvailability
	}{
		{
			name:         "the episode's own value, and the tenant's",
			arrange:      func() {},
			wantPrevious: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
			wantNext:     publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB,
		},
		{
			name: "the series' value over the tenant's",
			arrange: func() {
				env.exec(t, `UPDATE series SET purchase_availability = 'app' WHERE id = $1`, series.ID)
			},
			wantPrevious: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
			wantNext:     publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
		},
		{
			name:         "the episode's own value over the series'",
			arrange:      func() { env.setEpisodePurchase(t, previous.ID, "all") },
			wantPrevious: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_ALL,
			wantNext:     publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
		},
	}
	for _, step := range steps {
		step.arrange()
		gotPrevious, gotNext := neighbors()
		if gotPrevious != step.wantPrevious || gotNext != step.wantNext {
			t.Fatalf("%s: neighbours purchase_availability = %s, %s, want %s, %s", step.name, gotPrevious, gotNext, step.wantPrevious, step.wantNext)
		}
	}
}
