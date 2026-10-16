package catalogindex_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v5"
	"github.com/opensearch-project/opensearch-go/v5/opensearchapi"

	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

const testSurface = "web"

// index is the catalog indices of the test's own on the shared node, one for
// each locale a reader searches in, and a plain client for what the backend
// does not expose: refreshing, and deleting every index the aliases have named
// once the test is done.
type index struct {
	backend *opensearchbackend.Backend
	client  *opensearchapi.Client
	alias   string
}

func newIndex(t *testing.T, engine testutil.SearchEngine) index {
	t.Helper()
	ctx := context.Background()
	alias := "catalog-index-test-" + uuid.NewString()
	backend, err := opensearchbackend.New(ctx, opensearchbackend.Config{URL: engine.URL, Index: alias, Locales: locale.Supported})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	client, err := opensearchapi.NewClient(opensearchapi.Config{Client: opensearch.Config{Addresses: []string{engine.URL}, DiscoverNodesOnStart: new(false)}})
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	t.Cleanup(func() {
		resp, err := client.Indices.Get(context.Background(), &opensearchapi.IndicesGetReq{Indices: []string{alias + "*"}})
		if err != nil || resp.Entries == nil {
			return
		}
		if indices := slices.Collect(maps.Keys(resp.Entries)); len(indices) > 0 {
			_, _ = client.Indices.Delete(context.Background(), &opensearchapi.IndicesDeleteReq{Indices: indices})
		}
	})
	return index{backend: backend, client: client, alias: alias}
}

// every names the index of every locale.
func (i index) every() []string {
	return []string{i.alias + "-*"}
}

// refresh makes what was written visible to the next search.
func (i index) refresh(t *testing.T) {
	t.Helper()
	if _, err := i.client.Indices.Refresh(context.Background(), &opensearchapi.IndicesRefreshReq{Indices: i.every()}); err != nil {
		t.Fatalf("refresh: %v", err)
	}
}

// backdate rewrites the instant an entity's indexed documents were published
// at, in every locale's index, as if that much time had passed since they were
// written, and refreshes.
func (i index) backdate(t *testing.T, entityID uuid.UUID, publishedAt time.Time) {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"query": map[string]any{"term": map[string]any{"entity_id": entityID.String()}},
		"script": map[string]any{
			"source": "ctx._source.published_at = params.published_at",
			"params": map[string]any{"published_at": publishedAt.UTC().Format(time.RFC3339Nano)},
		},
	})
	if err != nil {
		t.Fatalf("backdate body: %v", err)
	}
	resp, err := i.client.UpdateByQuery(context.Background(), &opensearchapi.UpdateByQueryReq{
		Indices:    i.every(),
		BodyReader: bytes.NewReader(body),
		Params:     &opensearchapi.UpdateByQueryParams{Refresh: "true"},
	})
	if err != nil {
		t.Fatalf("backdate %s: %v", entityID, err)
	}
	var result struct {
		Updated int `json:"updated"`
	}
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		t.Fatalf("backdate %s: decode response: %v", entityID, err)
	}
	if result.Updated != len(locale.Supported) {
		t.Fatalf("backdate %s updated %d documents, want %d", entityID, result.Updated, len(locale.Supported))
	}
}

type searchFunc func(*opensearchbackend.Backend, context.Context, catalogsearch.Request) (catalogsearch.Page, error)

var (
	// A series search asking for no order and no filter is the one the other
	// two kinds answer.
	searchSeries searchFunc = func(b *opensearchbackend.Backend, ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
		return b.SearchSeries(ctx, catalogsearch.SeriesRequest{Request: req})
	}
	searchCreators searchFunc = (*opensearchbackend.Backend).SearchCreators
	searchLabels   searchFunc = (*opensearchbackend.Backend).SearchLabels
)

// assertHits searches in every locale, which find the same hits wherever no
// series has a translation of its own in one.
func (i index) assertHits(t *testing.T, search searchFunc, tenantID uuid.UUID, query string, want ...uuid.UUID) {
	t.Helper()
	for _, code := range locale.Supported {
		i.assertHitsIn(t, search, tenantID, code, query, want...)
	}
}

func (i index) assertHitsIn(t *testing.T, search searchFunc, tenantID uuid.UUID, code, query string, want ...uuid.UUID) {
	t.Helper()
	page, err := search(i.backend, context.Background(), catalogsearch.Request{TenantID: tenantID, Surface: testSurface, Query: query, Locale: code, Limit: 10})
	if err != nil {
		t.Fatalf("search %q in %s: %v", query, code, err)
	}
	if !slices.Equal(page.IDs, want) {
		t.Fatalf("search %q in %s = %v, want %v", query, code, page.IDs, want)
	}
}

// syncHandler is the handler the worker registers, writing through a Syncer
// into the test's index. No cache sits in front of these searches, so it
// records no drop.
func syncHandler(t *testing.T, pg *testutil.PostgresEnv, idx index) outbox.Handler {
	t.Helper()
	return outbox.NewCatalogIndexSyncHandler(syncerIndexer{catalogindex.NewSyncer(pg.OpenOutboxDB(t), idx.backend)}, nil)
}

// syncerIndexer reports every write as one into the index the search answers
// from, which in these tests it is.
type syncerIndexer struct {
	syncer *catalogindex.Syncer
}

func (s syncerIndexer) Sync(ctx context.Context, tenantID uuid.UUID, kind string, id uuid.UUID) (bool, error) {
	if err := s.syncer.Sync(ctx, tenantID, kind, id); err != nil {
		return false, err
	}
	return true, nil
}

// drain runs the catalog_index_sync events still pending through the handler
// the worker registers, and marks them done the way the worker does.
func drain(t *testing.T, pg *testutil.PostgresEnv, handler outbox.Handler) {
	t.Helper()
	ctx := context.Background()
	rows, err := pg.DB.QueryContext(ctx,
		"SELECT id, tenant_id, payload FROM outbox_events WHERE event_type = $1 AND status = 'pending' ORDER BY id",
		outbox.EventTypeCatalogIndexSync,
	)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	var events []dbmodels.OutboxEvent
	for rows.Next() {
		event := dbmodels.OutboxEvent{EventType: outbox.EventTypeCatalogIndexSync}
		if err := rows.Scan(&event.ID, &event.TenantID, &event.Payload); err != nil {
			t.Fatalf("scan event: %v", err)
		}
		events = append(events, event)
	}
	if err := rows.Close(); err != nil {
		t.Fatalf("close events: %v", err)
	}
	if len(events) == 0 {
		t.Fatal("no catalog_index_sync event is pending")
	}
	for _, event := range events {
		if err := handler(ctx, event); err != nil {
			t.Fatalf("handle %s: %v", event.Payload, err)
		}
		if _, err := pg.DB.ExecContext(ctx, "UPDATE outbox_events SET status = 'done' WHERE id = $1", event.ID); err != nil {
			t.Fatalf("mark %s done: %v", event.ID, err)
		}
	}
}

// A publish, a rename, and an unpublish each reach the index through the
// events the write queued, and a creator or a label follows the series that
// publishes it.
func TestEventsKeepTheIndexInStepWithTheCatalog(t *testing.T) {
	testutil.EachSearchEngine(t, func(t *testing.T, engine testutil.SearchEngine) {
		pg := testutil.StartPostgres(t)
		pg.Reset(t)
		idx := newIndex(t, engine)
		ctx := context.Background()
		handler := syncHandler(t, pg, idx)

		tenant := pg.SeedTenant(t, "INDEXSYNC001", "index-sync.example.com", "Index Sync Tenant")
		label := pg.SeedLabel(t, tenant.ID, testutil.LabelSeed{Name: "Harbor Books"})
		series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXSERIES1", Title: "Seed Garden", Synopsis: "A lighthouse keeper", Published: true, LabelID: label.ID})
		draft := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXSERIES2", Title: "Seed Draft"})
		creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Ada Lindqvist"})
		pg.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")

		queue := func(refs ...catalogindex.Ref) {
			t.Helper()
			if err := catalogindex.Queue(ctx, dbmodels.New(pg.DB), tenant.ID, refs...); err != nil {
				t.Fatalf("Queue: %v", err)
			}
		}
		queue(catalogindex.SeriesRef(series.ID), catalogindex.SeriesRef(draft.ID), catalogindex.CreatorRef(creator.ID), catalogindex.LabelRef(label.ID))
		drain(t, pg, handler)
		idx.refresh(t)

		idx.assertHits(t, searchSeries, tenant.ID, "seed", series.ID)
		idx.assertHits(t, searchSeries, tenant.ID, "lighthouse", series.ID)
		idx.assertHits(t, searchCreators, tenant.ID, "lindqvist", creator.ID)
		idx.assertHits(t, searchLabels, tenant.ID, "harbor", label.ID)

		if _, err := pg.DB.ExecContext(ctx, "UPDATE series_translations SET title = 'Night Train' WHERE series_id = $1", series.ID); err != nil {
			t.Fatalf("rename series: %v", err)
		}
		queue(catalogindex.SeriesRef(series.ID))
		drain(t, pg, handler)
		idx.refresh(t)
		idx.assertHits(t, searchSeries, tenant.ID, "seed")
		idx.assertHits(t, searchSeries, tenant.ID, "night train", series.ID)

		if _, err := pg.DB.ExecContext(ctx, "UPDATE series SET is_published = false, published_at = NULL WHERE id = $1", series.ID); err != nil {
			t.Fatalf("unpublish series: %v", err)
		}
		queue(catalogindex.SeriesRef(series.ID), catalogindex.CreatorRef(creator.ID), catalogindex.LabelRef(label.ID))
		drain(t, pg, handler)
		idx.refresh(t)
		idx.assertHits(t, searchSeries, tenant.ID, "night train")
		idx.assertHits(t, searchCreators, tenant.ID, "lindqvist")
		idx.assertHits(t, searchLabels, tenant.ID, "harbor")
	})
}

// A series scheduled for later is indexed with its instant, and the search
// finds it once that instant has passed without another event. The instant is
// moved into the past in the indexed document itself, right before the search
// that has to see it pass: nothing syncs the series again, so the search has
// only the instant the sync wrote to compare with the time it runs, and the
// runner's speed does not decide which side of the instant either search lands.
func TestAScheduledSeriesIsFoundOnceItsInstantPasses(t *testing.T) {
	testutil.EachSearchEngine(t, func(t *testing.T, engine testutil.SearchEngine) {
		pg := testutil.StartPostgres(t)
		pg.Reset(t)
		idx := newIndex(t, engine)
		ctx := context.Background()

		tenant := pg.SeedTenant(t, "INDEXSCHED01", "index-scheduled.example.com", "Index Scheduled Tenant")
		series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXSCHED02", Title: "Seed Garden", Published: true, PublishedAt: time.Now().Add(time.Hour)})

		if err := catalogindex.NewSyncer(pg.OpenOutboxDB(t), idx.backend).Sync(ctx, tenant.ID, string(opensearchbackend.KindSeries), series.ID); err != nil {
			t.Fatalf("Sync: %v", err)
		}
		idx.refresh(t)
		idx.assertHits(t, searchSeries, tenant.ID, "seed")

		idx.backdate(t, series.ID, time.Now().Add(-time.Second))
		idx.assertHits(t, searchSeries, tenant.ID, "seed", series.ID)
	})
}

func TestSyncRefusesAKindItDoesNotIndexForGood(t *testing.T) {
	testutil.EachSearchEngine(t, func(t *testing.T, engine testutil.SearchEngine) {
		pg := testutil.StartPostgres(t)
		pg.Reset(t)
		idx := newIndex(t, engine)

		tenant := pg.SeedTenant(t, "INDEXKIND001", "index-kind.example.com", "Index Kind Tenant")
		err := catalogindex.NewSyncer(pg.OpenOutboxDB(t), idx.backend).Sync(context.Background(), tenant.ID, "episode", uuid.Must(uuid.NewV7()))
		if !outbox.IsPermanent(err) {
			t.Fatalf("Sync of an unknown kind = %v, want a permanent error", err)
		}
	})
}

// A rebuild fills a new index from the database and moves the alias onto it.
// What the old index held and the database no longer publishes is not carried
// across.
func TestRebuildFillsANewIndexFromTheDatabase(t *testing.T) {
	testutil.EachSearchEngine(t, func(t *testing.T, engine testutil.SearchEngine) {
		pg := testutil.StartPostgres(t)
		pg.Reset(t)
		idx := newIndex(t, engine)
		ctx := context.Background()

		tenant := pg.SeedTenant(t, "INDEXREBLD01", "index-rebuild.example.com", "Index Rebuild Tenant")
		other := pg.SeedTenant(t, "INDEXREBLD02", "index-rebuild-other.example.com", "Index Rebuild Other Tenant")
		series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXREBLD03", Title: "Seed Garden", Published: true})
		otherSeries := pg.SeedSeries(t, other.ID, testutil.SeriesSeed{PublicID: "INDEXREBLD04", Title: "Seed Harbor", Published: true})
		stale := opensearchbackend.Document{
			Kind: opensearchbackend.KindSeries, TenantID: tenant.ID, ID: uuid.Must(uuid.NewV7()),
			Title: "Seed Ghost", Surfaces: []string{testSurface}, PublishedAt: time.Now().Add(-time.Hour),
		}
		if err := idx.backend.Put(ctx, stale); err != nil {
			t.Fatalf("Put: %v", err)
		}

		names, err := catalogindex.Rebuild(ctx, pg.OpenContentStatsDB(t), idx.backend, slog.New(slog.DiscardHandler))
		if err != nil {
			t.Fatalf("Rebuild: %v", err)
		}
		if len(names) != len(locale.Supported) {
			t.Fatalf("Rebuild answered %v, want an index for each of %v", names, locale.Supported)
		}
		for _, name := range names {
			if strings.HasSuffix(name, "-initial") {
				t.Fatalf("Rebuild left an alias on %s", name)
			}
		}
		idx.refresh(t)
		idx.assertHits(t, searchSeries, tenant.ID, "seed", series.ID)
		idx.assertHits(t, searchSeries, other.ID, "seed", otherSeries.ID)
	})
}

// The tenant-scoped pass rewrites one tenant's documents where they are: what
// the database publishes is written, what it does not is deleted, and every
// other tenant is left as it was.
func TestSyncTenantRewritesOneTenantInPlace(t *testing.T) {
	testutil.EachSearchEngine(t, func(t *testing.T, engine testutil.SearchEngine) {
		pg := testutil.StartPostgres(t)
		pg.Reset(t)
		idx := newIndex(t, engine)
		ctx := context.Background()

		tenant := pg.SeedTenant(t, "INDEXTENANT1", "index-tenant.example.com", "Index Tenant")
		other := pg.SeedTenant(t, "INDEXTENANT2", "index-tenant-other.example.com", "Index Other Tenant")
		published := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXTENANT3", Title: "Seed Garden", Published: true})
		unpublished := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXTENANT4", Title: "Seed Draft"})
		untouched := opensearchbackend.Document{
			Kind: opensearchbackend.KindSeries, TenantID: other.ID, ID: uuid.Must(uuid.NewV7()),
			Title: "Seed Elsewhere", Surfaces: []string{testSurface}, PublishedAt: time.Now().Add(-time.Hour),
		}
		// The document of a series that was published when it was written.
		leftover := opensearchbackend.Document{
			Kind: opensearchbackend.KindSeries, TenantID: tenant.ID, ID: unpublished.ID,
			Title: "Seed Draft", Surfaces: []string{testSurface}, PublishedAt: time.Now().Add(-time.Hour),
		}
		if err := idx.backend.PutAll(ctx, []opensearchbackend.Document{untouched, leftover}); err != nil {
			t.Fatalf("PutAll: %v", err)
		}

		written, deleted, err := catalogindex.SyncTenant(ctx, pg.OpenContentStatsDB(t), idx.backend, tenant.ID)
		if err != nil {
			t.Fatalf("SyncTenant: %v", err)
		}
		if written != 1 || deleted != 1 {
			t.Fatalf("SyncTenant wrote %d and deleted %d, want 1 and 1", written, deleted)
		}
		idx.refresh(t)
		idx.assertHits(t, searchSeries, tenant.ID, "seed", published.ID)
		idx.assertHits(t, searchSeries, other.ID, "seed", untouched.ID)
	})
}

// A series document in a locale's index carries the translation a reader in
// that locale is shown: its own where it has one, and the one it falls back
// to where it has none. A search in English finds a series by its English
// title and not by a word only its Japanese one has, and finds a series with
// no English translation by its Japanese title.
func TestASearchInALocaleFindsASeriesByTheTextShownInIt(t *testing.T) {
	testutil.EachSearchEngine(t, func(t *testing.T, engine testutil.SearchEngine) {
		pg := testutil.StartPostgres(t)
		pg.Reset(t)
		idx := newIndex(t, engine)
		ctx := context.Background()

		tenant := pg.SeedTenant(t, "INDEXLOCALE1", "index-locale.example.com", "Index Locale Tenant")
		translated := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXLOCALE2", Title: "銀河鉄道の夜", Synopsis: "ジョバンニの旅", Published: true})
		pg.SeedSeriesTranslation(t, tenant.ID, translated.ID, "en", "Night on the Galactic Railroad", "Giovanni rides among the stars")
		untranslated := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXLOCALE3", Title: "風の又三郎", Published: true})

		if _, _, err := catalogindex.SyncTenant(ctx, pg.OpenContentStatsDB(t), idx.backend, tenant.ID); err != nil {
			t.Fatalf("SyncTenant: %v", err)
		}
		idx.refresh(t)

		idx.assertHitsIn(t, searchSeries, tenant.ID, "en", "galactic", translated.ID)
		idx.assertHitsIn(t, searchSeries, tenant.ID, "en", "giovanni", translated.ID)
		idx.assertHitsIn(t, searchSeries, tenant.ID, "en", "銀河鉄道")
		idx.assertHitsIn(t, searchSeries, tenant.ID, "en", "又三郎", untranslated.ID)
		idx.assertHitsIn(t, searchSeries, tenant.ID, "ja", "銀河鉄道", translated.ID)
		idx.assertHitsIn(t, searchSeries, tenant.ID, "ja", "galactic")
		// Korean has no translation of either, and falls back to Japanese,
		// the tenant's default.
		idx.assertHitsIn(t, searchSeries, tenant.ID, "ko", "銀河鉄道", translated.ID)
	})
}

// The translation a series falls back to in a locale it has none in is the
// tenant default's, so the event a change of the default queues rewrites every
// document of the tenant.
func TestATenantEventRewritesWhatTheDefaultLocaleFallsBackTo(t *testing.T) {
	testutil.EachSearchEngine(t, func(t *testing.T, engine testutil.SearchEngine) {
		pg := testutil.StartPostgres(t)
		pg.Reset(t)
		idx := newIndex(t, engine)
		ctx := context.Background()
		handler := syncHandler(t, pg, idx)

		tenant := pg.SeedTenant(t, "INDEXDEFLT01", "index-default.example.com", "Index Default Tenant")
		series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXDEFLT02", Title: "Seed Garden", Published: true})
		pg.SeedSeriesTranslation(t, tenant.ID, series.ID, "en", "Seed Harbor", "")
		if err := catalogindex.Queue(ctx, dbmodels.New(pg.DB), tenant.ID, catalogindex.SeriesRef(series.ID)); err != nil {
			t.Fatalf("Queue: %v", err)
		}
		drain(t, pg, handler)
		idx.refresh(t)
		idx.assertHitsIn(t, searchSeries, tenant.ID, "ko", "garden", series.ID)
		idx.assertHitsIn(t, searchSeries, tenant.ID, "ko", "harbor")

		if _, err := pg.DB.ExecContext(ctx, "UPDATE tenants SET default_locale = 'en' WHERE id = $1", tenant.ID); err != nil {
			t.Fatalf("change the default locale: %v", err)
		}
		if err := catalogindex.Queue(ctx, dbmodels.New(pg.DB), tenant.ID, catalogindex.TenantRef(tenant.ID)); err != nil {
			t.Fatalf("Queue: %v", err)
		}
		drain(t, pg, handler)
		idx.refresh(t)
		idx.assertHitsIn(t, searchSeries, tenant.ID, "ko", "harbor", series.ID)
		idx.assertHitsIn(t, searchSeries, tenant.ID, "ko", "garden")
		idx.assertHitsIn(t, searchSeries, tenant.ID, "ja", "garden", series.ID)
	})
}
