package catalogindex

import (
	"context"
	"log/slog"
	"maps"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v5"
	"github.com/opensearch-project/opensearch-go/v5/opensearchapi"

	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

const testSurface = "web"

// index is a catalog index of the test's own on the shared node, and a plain
// client for what the backend does not expose: refreshing, and deleting every
// index the alias has named once the test is done.
type index struct {
	backend *opensearchbackend.Backend
	client  *opensearchapi.Client
	alias   string
}

func newIndex(t *testing.T) index {
	t.Helper()
	env := testutil.StartOpenSearch(t)
	ctx := context.Background()
	alias := "catalog-index-test-" + uuid.NewString()
	backend, err := opensearchbackend.New(ctx, opensearchbackend.Config{URL: env.URL, Index: alias})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	client, err := opensearchapi.NewClient(opensearchapi.Config{Client: opensearch.Config{Addresses: []string{env.URL}, DiscoverNodesOnStart: new(false)}})
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

// refresh makes what was written visible to the next search.
func (i index) refresh(t *testing.T) {
	t.Helper()
	if _, err := i.client.Indices.Refresh(context.Background(), &opensearchapi.IndicesRefreshReq{Indices: []string{i.alias}}); err != nil {
		t.Fatalf("refresh: %v", err)
	}
}

type searchFunc func(*opensearchbackend.Backend, context.Context, catalogsearch.Request) (catalogsearch.Page, error)

var (
	searchSeries   searchFunc = (*opensearchbackend.Backend).SearchSeries
	searchCreators searchFunc = (*opensearchbackend.Backend).SearchCreators
	searchLabels   searchFunc = (*opensearchbackend.Backend).SearchLabels
)

func (i index) assertHits(t *testing.T, search searchFunc, tenantID uuid.UUID, query string, want ...uuid.UUID) {
	t.Helper()
	page, err := search(i.backend, context.Background(), catalogsearch.Request{TenantID: tenantID, Surface: testSurface, Query: query, Limit: 10})
	if err != nil {
		t.Fatalf("search %q: %v", query, err)
	}
	if !slices.Equal(page.IDs, want) {
		t.Fatalf("search %q = %v, want %v", query, page.IDs, want)
	}
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
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	idx := newIndex(t)
	ctx := context.Background()
	handler := outbox.NewCatalogIndexSyncHandler(NewSyncer(pg.OpenOutboxDB(t), idx.backend))

	tenant := pg.SeedTenant(t, "INDEXSYNC001", "index-sync.example.com", "Index Sync Tenant")
	label := pg.SeedLabel(t, tenant.ID, testutil.LabelSeed{Name: "Harbor Books"})
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXSERIES1", Title: "Seed Garden", Synopsis: "A lighthouse keeper", Published: true, LabelID: label.ID})
	draft := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXSERIES2", Title: "Seed Draft"})
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Ada Lindqvist"})
	pg.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")

	queue := func(refs ...Ref) {
		t.Helper()
		if err := Queue(ctx, dbmodels.New(pg.DB), tenant.ID, refs...); err != nil {
			t.Fatalf("Queue: %v", err)
		}
	}
	queue(SeriesRef(series.ID), SeriesRef(draft.ID), CreatorRef(creator.ID), LabelRef(label.ID))
	drain(t, pg, handler)
	idx.refresh(t)

	idx.assertHits(t, searchSeries, tenant.ID, "seed", series.ID)
	idx.assertHits(t, searchSeries, tenant.ID, "lighthouse", series.ID)
	idx.assertHits(t, searchCreators, tenant.ID, "lindqvist", creator.ID)
	idx.assertHits(t, searchLabels, tenant.ID, "harbor", label.ID)

	if _, err := pg.DB.ExecContext(ctx, "UPDATE series SET title = 'Night Train' WHERE id = $1", series.ID); err != nil {
		t.Fatalf("rename series: %v", err)
	}
	queue(SeriesRef(series.ID))
	drain(t, pg, handler)
	idx.refresh(t)
	idx.assertHits(t, searchSeries, tenant.ID, "seed")
	idx.assertHits(t, searchSeries, tenant.ID, "night train", series.ID)

	if _, err := pg.DB.ExecContext(ctx, "UPDATE series SET is_published = false, published_at = NULL WHERE id = $1", series.ID); err != nil {
		t.Fatalf("unpublish series: %v", err)
	}
	queue(SeriesRef(series.ID), CreatorRef(creator.ID), LabelRef(label.ID))
	drain(t, pg, handler)
	idx.refresh(t)
	idx.assertHits(t, searchSeries, tenant.ID, "night train")
	idx.assertHits(t, searchCreators, tenant.ID, "lindqvist")
	idx.assertHits(t, searchLabels, tenant.ID, "harbor")
}

// A series scheduled for later is indexed with its instant, and the search
// finds it once that instant has passed without another event.
func TestAScheduledSeriesIsFoundOnceItsInstantPasses(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	idx := newIndex(t)
	ctx := context.Background()

	tenant := pg.SeedTenant(t, "INDEXSCHED01", "index-scheduled.example.com", "Index Scheduled Tenant")
	soon := time.Now().Add(2 * time.Second)
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXSCHED02", Title: "Seed Garden", Published: true, PublishedAt: soon})

	if err := NewSyncer(pg.OpenOutboxDB(t), idx.backend).Sync(ctx, tenant.ID, string(opensearchbackend.KindSeries), series.ID); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	idx.refresh(t)
	idx.assertHits(t, searchSeries, tenant.ID, "seed")

	time.Sleep(time.Until(soon) + 100*time.Millisecond)
	idx.assertHits(t, searchSeries, tenant.ID, "seed", series.ID)
}

func TestSyncRefusesAKindItDoesNotIndexForGood(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	idx := newIndex(t)

	tenant := pg.SeedTenant(t, "INDEXKIND001", "index-kind.example.com", "Index Kind Tenant")
	err := NewSyncer(pg.OpenOutboxDB(t), idx.backend).Sync(context.Background(), tenant.ID, "episode", uuid.Must(uuid.NewV7()))
	if !outbox.IsPermanent(err) {
		t.Fatalf("Sync of an unknown kind = %v, want a permanent error", err)
	}
}

// A rebuild fills a new index from the database and moves the alias onto it.
// What the old index held and the database no longer publishes is not carried
// across.
func TestRebuildFillsANewIndexFromTheDatabase(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	idx := newIndex(t)
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

	name, err := Rebuild(ctx, pg.OpenContentStatsDB(t), idx.backend, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatalf("Rebuild: %v", err)
	}
	if name == idx.alias+"-initial" {
		t.Fatalf("Rebuild left the alias on %s", name)
	}
	idx.refresh(t)
	idx.assertHits(t, searchSeries, tenant.ID, "seed", series.ID)
	idx.assertHits(t, searchSeries, other.ID, "seed", otherSeries.ID)
}

// The tenant-scoped pass rewrites one tenant's documents where they are: what
// the database publishes is written, what it does not is deleted, and every
// other tenant is left as it was.
func TestSyncTenantRewritesOneTenantInPlace(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	idx := newIndex(t)
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

	written, deleted, err := SyncTenant(ctx, pg.OpenContentStatsDB(t), idx.backend, tenant.ID)
	if err != nil {
		t.Fatalf("SyncTenant: %v", err)
	}
	if written != 1 || deleted != 1 {
		t.Fatalf("SyncTenant wrote %d and deleted %d, want 1 and 1", written, deleted)
	}
	idx.refresh(t)
	idx.assertHits(t, searchSeries, tenant.ID, "seed", published.ID)
	idx.assertHits(t, searchSeries, other.ID, "seed", untouched.ID)
}
