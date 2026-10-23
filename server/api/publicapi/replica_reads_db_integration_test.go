package publicapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/testutil"
)

// replicatedPublicDBEnv is a public API server on a primary and a hot standby
// of it, both opened the way `publira server` opens them, with every span the
// pools record kept so a case can tell which server answered a request.
type replicatedPublicDBEnv struct {
	Server *httptest.Server
	PG     *testutil.ReplicatedPostgres

	spans       *tracetest.SpanRecorder
	primaryPort int64
	standbyPort int64
}

func newReplicatedPublicDBEnv(t *testing.T) *replicatedPublicDBEnv {
	t.Helper()

	pg := testutil.StartReplicatedPostgres(t)

	// The instrumented driver reads the global provider, as it does in a
	// server process where tracing.Setup installed it.
	spans := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spans))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(context.Background())
	})

	primary, err := sqldb.Open(pg.PublicURL)
	if err != nil {
		t.Fatalf("open the primary: %v", err)
	}
	t.Cleanup(func() { _ = primary.Close() })
	replica, err := sqldb.Open(pg.StandbyPublicURL)
	if err != nil {
		t.Fatalf("open the replica: %v", err)
	}
	t.Cleanup(func() { _ = replica.Close() })

	api := newAPIServer(primary, dbmodels.New(primary), nil, testutil.TokenManager(), nil, slog.Default(), openReaderGuards(), openMailGuard(), nil)
	api.reads.Replica = replica
	server := httptest.NewServer(handlerFromServer(api))
	t.Cleanup(server.Close)

	return &replicatedPublicDBEnv{
		Server:      server,
		PG:          pg,
		spans:       spans,
		primaryPort: portOf(t, pg.PublicURL),
		standbyPort: portOf(t, pg.StandbyPublicURL),
	}
}

func portOf(t *testing.T, rawURL string) int64 {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse %q: %v", rawURL, err)
	}
	port, err := strconv.ParseInt(u.Port(), 10, 64)
	if err != nil {
		t.Fatalf("port of %q: %v", rawURL, err)
	}
	return port
}

func (e *replicatedPublicDBEnv) catalogClient() publirav1connect.CatalogServiceClient {
	return publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

// answered runs call and names the queries each server answered for it: the
// statements sqlc generated, which carry their name as db.query.summary, and
// not the ones a connection is bound to its tenant with or the replica's
// position compared with.
func (e *replicatedPublicDBEnv) answered(t *testing.T, call func() error) (primary, standby []string, err error) {
	t.Helper()
	before := len(e.spans.Ended())
	err = call()
	for _, span := range e.spans.Ended()[before:] {
		var summary string
		var port int64
		for _, kv := range span.Attributes() {
			switch kv.Key {
			case semconv.DBQuerySummaryKey:
				summary = kv.Value.AsString()
			case semconv.ServerPortKey:
				port = kv.Value.AsInt64()
			}
		}
		if summary == "" {
			continue
		}
		switch port {
		case e.primaryPort:
			primary = append(primary, summary)
		case e.standbyPort:
			standby = append(standby, summary)
		default:
			t.Fatalf("query %s was answered on port %d, which is neither server", summary, port)
		}
	}
	return primary, standby, err
}

// answeredOnStandby runs call until the standby alone answers it, waiting for
// the standby to replay everything before each attempt, and fails the test
// with the last attempt's answer if it never does. The standby may still fall
// behind between the wait and the request for longer than CatchUpWait on a busy
// machine, which is the primary answering correctly, not a failure; an error
// is never retried.
func (e *replicatedPublicDBEnv) answeredOnStandby(t *testing.T, call func() error) {
	t.Helper()
	var primary, standby []string
	for range 20 {
		e.PG.WaitForReplay(t)
		var err error
		primary, standby, err = e.answered(t, call)
		if err != nil {
			t.Fatalf("on the replica: %v", err)
		}
		if len(standby) > 0 && len(primary) == 0 {
			return
		}
	}
	t.Fatalf("ran %v on the primary and %v on the replica, want the replica alone", primary, standby)
}

// Every procedure a request may be answered on the replica for is called on
// one, as a guest, with a catalogue for it to read. A hot standby refuses any
// write, so a listed procedure that writes on the side of what it reads fails
// here, and one answered anywhere but the standby shows up as a primary query.
func TestDBReplicaProceduresWriteNothing(t *testing.T) {
	env := newReplicatedPublicDBEnv(t)
	pg := env.PG
	tenant := pg.SeedTenant(t, "TENANTREPL", "replica.example.com", "Replica")
	label := pg.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELREPL", Name: "Harbor Press"})
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORREPL", Name: "Ada Harbor"})
	genre := pg.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREREPL", Name: "Drama"})
	tag := pg.SeedTag(t, tenant.ID, testutil.TagSeed{Name: "Sea"})
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREPLA", Title: "Harbor Lights", LabelID: label.ID, Published: true})
	other := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREPLB", Title: "Harbor Nights", LabelID: label.ID, Published: true})
	for _, s := range []testutil.Series{series, other} {
		pg.SeedSeriesCreator(t, tenant.ID, s.ID, creator.ID, "")
		pg.SeedSeriesGenre(t, tenant.ID, s.ID, genre.ID)
		pg.SeedSeriesTag(t, tenant.ID, s.ID, tag.ID)
	}
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREPL", Title: "Arrival", Status: testutil.EpisodeStatusPublished})
	pg.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
	pg.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		PublicID:  "BANNERREPL",
		AltText:   "Harbor Lights",
		StartsAt:  time.Now().Add(-time.Hour),
		EndsAt:    time.Now().Add(time.Hour),
		Published: true,
	})

	ctx := t.Context()
	client := env.catalogClient()
	at := tenantContext(tenant)
	web := publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB
	calls := map[string]func() error{
		publirav1connect.CatalogServiceListPublishedLabelsProcedure: func() error {
			_, err := client.ListPublishedLabels(ctx, &publirav1.ListPublishedLabelsRequest{Tenant: at, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceListPublishedSeriesProcedure: func() error {
			_, err := client.ListPublishedSeries(ctx, &publirav1.ListPublishedSeriesRequest{Tenant: at, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceGetSeriesDetailProcedure: func() error {
			_, err := client.GetSeriesDetail(ctx, &publirav1.GetSeriesDetailRequest{Tenant: at, PublicId: series.PublicID, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceGetEpisodeDetailProcedure: func() error {
			_, err := client.GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{Tenant: at, PublicId: episode.PublicID, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceListPublishedCreatorsProcedure: func() error {
			_, err := client.ListPublishedCreators(ctx, &publirav1.ListPublishedCreatorsRequest{Tenant: at, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceGetPublishedCreatorDetailProcedure: func() error {
			_, err := client.GetPublishedCreatorDetail(ctx, &publirav1.GetPublishedCreatorDetailRequest{Tenant: at, PublicId: creator.PublicID, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceGetPublishedLabelDetailProcedure: func() error {
			_, err := client.GetPublishedLabelDetail(ctx, &publirav1.GetPublishedLabelDetailRequest{Tenant: at, PublicId: label.PublicID, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceListPublishedGenresProcedure: func() error {
			_, err := client.ListPublishedGenres(ctx, &publirav1.ListPublishedGenresRequest{Tenant: at, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceListPublishedTagsProcedure: func() error {
			_, err := client.ListPublishedTags(ctx, &publirav1.ListPublishedTagsRequest{Tenant: at, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceSearchPublishedSeriesProcedure: func() error {
			_, err := client.SearchPublishedSeries(ctx, &publirav1.SearchPublishedSeriesRequest{Tenant: at, Query: "Harbor", Surface: web})
			return err
		},
		publirav1connect.CatalogServiceSearchPublishedCreatorsProcedure: func() error {
			_, err := client.SearchPublishedCreators(ctx, &publirav1.SearchPublishedCreatorsRequest{Tenant: at, Query: "Ada", Surface: web})
			return err
		},
		publirav1connect.CatalogServiceSearchPublishedLabelsProcedure: func() error {
			_, err := client.SearchPublishedLabels(ctx, &publirav1.SearchPublishedLabelsRequest{Tenant: at, Query: "Harbor", Surface: web})
			return err
		},
		publirav1connect.CatalogServiceListRecommendedSeriesProcedure: func() error {
			_, err := client.ListRecommendedSeries(ctx, &publirav1.ListRecommendedSeriesRequest{Tenant: at, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceListRankedSeriesProcedure: func() error {
			_, err := client.ListRankedSeries(ctx, &publirav1.ListRankedSeriesRequest{Tenant: at, Period: publirav1.RankingPeriod_RANKING_PERIOD_WEEKLY, Surface: web})
			return err
		},
		publirav1connect.CatalogServiceListRelatedSeriesProcedure: func() error {
			_, err := client.ListRelatedSeries(ctx, &publirav1.ListRelatedSeriesRequest{Tenant: at, SeriesId: series.ID.String(), Surface: web})
			return err
		},
		publirav1connect.CatalogServiceListSitemapEntriesProcedure: func() error {
			_, err := client.ListSitemapEntries(ctx, &publirav1.ListSitemapEntriesRequest{Tenant: at})
			return err
		},
		publirav1connect.CatalogServiceListCampaignBannersProcedure: func() error {
			_, err := client.ListCampaignBanners(ctx, &publirav1.ListCampaignBannersRequest{Tenant: at})
			return err
		},
	}

	for procedure := range replicaProcedures {
		t.Run(procedure, func(t *testing.T) {
			call, ok := calls[procedure]
			if !ok {
				t.Fatalf("%s is answered on the replica and this test does not call it", procedure)
			}
			env.answeredOnStandby(t, call)
		})
	}
}

// The replica answers a request only once it has replayed everything the
// primary had committed when the request arrived, and never a signed-in
// reader's, so lag shows nobody a write that has already returned as not made.
func TestDBReplicaReadsSeeWhatThePrimaryCommitted(t *testing.T) {
	env := newReplicatedPublicDBEnv(t)
	pg := env.PG
	tenant := pg.SeedTenant(t, "TENANTLAG", "lag.example.com", "Lag")
	reader := pg.SeedEndUser(t, tenant.ID, "READERLAG", "reader-lag@example.com", "Reader")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESLAG", Title: "Harbor Lights", Published: true})
	paid := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODELAG", Title: "Arrival", Price: 100, Status: testutil.EpisodeStatusPublished})
	pg.WaitForReplay(t)

	ctx := t.Context()
	client := env.catalogClient()
	at := tenantContext(tenant)
	web := publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB
	seriesDetail := func(publicID string) func() error {
		return func() error {
			_, err := client.GetSeriesDetail(ctx, &publirav1.GetSeriesDetailRequest{Tenant: at, PublicId: publicID, Surface: web})
			return err
		}
	}

	t.Run("a guest read is answered on a replica that has caught up", func(t *testing.T) {
		env.answeredOnStandby(t, seriesDetail(series.PublicID))
	})

	pg.PauseReplay(t)

	var published testutil.Series
	t.Run("a guest reads a series published after the replica stopped replaying", func(t *testing.T) {
		published = pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESLAGNEW", Title: "Harbor Nights", Published: true})
		primary, standby, err := env.answered(t, seriesDetail(published.PublicID))
		if err != nil {
			t.Fatalf("GetSeriesDetail of a series the replica has not replayed: %v", err)
		}
		if len(standby) != 0 || len(primary) == 0 {
			t.Fatalf("GetSeriesDetail ran %v on the primary and %v on the replica, want the primary alone", primary, standby)
		}
	})

	t.Run("a reader reads back an episode they have just bought", func(t *testing.T) {
		pg.SeedPurchase(t, tenant.ID, reader.ID, paid.ID, 100)
		var res *publirav1.GetEpisodeDetailResponse
		_, standby, err := env.answered(t, func() error {
			var err error
			res, err = client.GetEpisodeDetail(testutil.WithBearer(ctx, tokenFor(t, tenant, reader)), &publirav1.GetEpisodeDetailRequest{Tenant: at, PublicId: paid.PublicID, Surface: web})
			return err
		})
		if err != nil {
			t.Fatalf("GetEpisodeDetail: %v", err)
		}
		if res.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
			t.Fatalf("access = %v, want the purchase the reader has just made", res.Access)
		}
		if len(standby) != 0 {
			t.Fatalf("a signed-in reader's GetEpisodeDetail ran %v on the replica", standby)
		}
	})

	t.Run("the replica answers again once it has replayed the writes", func(t *testing.T) {
		pg.ResumeReplay(t)
		env.answeredOnStandby(t, seriesDetail(published.PublicID))
	})
}
