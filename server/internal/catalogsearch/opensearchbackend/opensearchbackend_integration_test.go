package opensearchbackend

import (
	"context"
	"database/sql"
	"errors"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v5"
	"github.com/opensearch-project/opensearch-go/v5/opensearchapi"

	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publishedseries"
	"github.com/publira/publira/server/internal/testutil"
)

const testSurface = "web"

// newTestBackend connects to the shared node with an index of the test's own,
// created through New the way a starting process creates it.
func newTestBackend(t *testing.T) *Backend {
	t.Helper()
	env := testutil.StartOpenSearch(t)

	ctx := context.Background()
	backend, err := New(ctx, Config{URL: env.URL, Index: "catalog-test-" + uuid.NewString()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { deleteIndices(backend) })
	return backend
}

// deleteIndices deletes every index the test's alias has named. The alias
// itself cannot be deleted by name, and a rebuild leaves its index behind it.
func deleteIndices(backend *Backend) {
	ctx := context.Background()
	resp, err := backend.client.Indices.Get(ctx, &opensearchapi.IndicesGetReq{Indices: []string{backend.index + "*"}})
	if err != nil || resp.Entries == nil {
		return
	}
	indices := slices.Collect(maps.Keys(resp.Entries))
	if len(indices) > 0 {
		_, _ = backend.client.Indices.Delete(ctx, &opensearchapi.IndicesDeleteReq{Indices: indices})
	}
}

// put indexes docs and refreshes the index, so the next search sees them.
func put(t *testing.T, backend *Backend, docs ...Document) {
	t.Helper()
	ctx := context.Background()
	for _, doc := range docs {
		if err := backend.Put(ctx, doc); err != nil {
			t.Fatalf("Put %s: %v", doc.ID, err)
		}
	}
	refresh(t, backend)
}

func refresh(t *testing.T, backend *Backend) {
	t.Helper()
	if _, err := backend.client.Indices.Refresh(context.Background(), &opensearchapi.IndicesRefreshReq{Indices: []string{backend.index}}); err != nil {
		t.Fatalf("refresh: %v", err)
	}
}

func publishedSeries(tenantID uuid.UUID, title, reading string) Document {
	return Document{
		Kind:        KindSeries,
		TenantID:    tenantID,
		ID:          uuid.Must(uuid.NewV7()),
		Title:       title,
		Reading:     reading,
		Surfaces:    []string{testSurface},
		PublishedAt: time.Now().Add(-time.Hour),
	}
}

func searchSeries(t *testing.T, backend *Backend, tenantID uuid.UUID, query string, limit int32, cursor pagination.Cursor) catalogsearch.Page {
	t.Helper()
	page, err := backend.SearchSeries(context.Background(), catalogsearch.SeriesRequest{Request: catalogsearch.Request{
		TenantID: tenantID,
		Surface:  testSurface,
		Query:    query,
		Limit:    limit,
		Cursor:   cursor,
	}})
	if err != nil {
		t.Fatalf("SearchSeries(%q): %v", query, err)
	}
	return page
}

func decodeToken(t *testing.T, token string) pagination.Cursor {
	t.Helper()
	if token == "" {
		t.Fatal("token is empty")
	}
	cursor, err := pagination.Decode(token)
	if err != nil {
		t.Fatalf("decode token: %v", err)
	}
	return cursor
}

func assertIDs(t *testing.T, query string, got []uuid.UUID, want ...uuid.UUID) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Fatalf("search %q = %v, want %v", query, got, want)
	}
}

func TestKanaQueryMatchesAKanjiTitleByItsReading(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())

	night := publishedSeries(tenantID, "銀河鉄道の夜", "ぎんがてつどうのよる")
	other := publishedSeries(tenantID, "風の又三郎", "かぜのまたさぶろう")
	put(t, backend, night, other)

	for _, query := range []string{"ぎんがてつどう", "ギンガテツドウ", "銀河鉄道"} {
		page := searchSeries(t, backend, tenantID, query, 10, pagination.Cursor{})
		assertIDs(t, query, page.IDs, night.ID)
	}
}

// Without an entered reading, the one the dictionary gives the title is
// matched instead.
func TestKanaQueryMatchesAKanjiTitleByTheDictionaryReading(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())

	cat := publishedSeries(tenantID, "吾輩は猫である", "")
	other := publishedSeries(tenantID, "走れメロス", "")
	put(t, backend, cat, other)

	page := searchSeries(t, backend, tenantID, "わがはいはねこ", 10, pagination.Cursor{})
	assertIDs(t, "わがはいはねこ", page.IDs, cat.ID)
}

func TestOneWrongCharacterMatchesLatinText(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())

	seed := publishedSeries(tenantID, "The Seed Garden", "")
	other := publishedSeries(tenantID, "Harbor Lights", "")
	put(t, backend, seed, other)

	for _, query := range []string{"seed", "Sead", "gardn", "SEED GARDEN"} {
		page := searchSeries(t, backend, tenantID, query, 10, pagination.Cursor{})
		assertIDs(t, query, page.IDs, seed.ID)
	}
	// Two edits are a different word.
	page := searchSeries(t, backend, tenantID, "sxxd", 10, pagination.Cursor{})
	assertIDs(t, "sxxd", page.IDs)
}

func TestSearchFindsOnlyWhatTheTenantPublishedOnTheSurface(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())

	visible := publishedSeries(tenantID, "Seed Garden", "")
	otherTenant := publishedSeries(uuid.Must(uuid.NewV7()), "Seed Garden", "")
	otherSurface := publishedSeries(tenantID, "Seed Garden", "")
	otherSurface.Surfaces = []string{"app"}
	scheduled := publishedSeries(tenantID, "Seed Garden", "")
	scheduled.PublishedAt = time.Now().Add(time.Hour)
	unpublished := publishedSeries(tenantID, "Seed Garden", "")
	unpublished.Surfaces = nil
	unpublished.PublishedAt = time.Time{}
	put(t, backend, visible, otherTenant, otherSurface, scheduled, unpublished)

	page := searchSeries(t, backend, tenantID, "seed", 10, pagination.Cursor{})
	assertIDs(t, "seed", page.IDs, visible.ID)

	if err := backend.Delete(context.Background(), KindSeries, tenantID, visible.ID, 0); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	// A row that has no document is already gone.
	if err := backend.Delete(context.Background(), KindSeries, tenantID, visible.ID, 0); err != nil {
		t.Fatalf("Delete of a missing document: %v", err)
	}
	refresh(t, backend)
	page = searchSeries(t, backend, tenantID, "seed", 10, pagination.Cursor{})
	assertIDs(t, "seed", page.IDs)
}

func TestSearchesCreatorsAndLabelsByName(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())
	published := time.Now().Add(-time.Hour)

	creator := Document{Kind: KindCreator, TenantID: tenantID, ID: uuid.Must(uuid.NewV7()), Name: "宮沢賢治", Reading: "みやざわけんじ", Surfaces: []string{testSurface}, PublishedAt: published}
	label := Document{Kind: KindLabel, TenantID: tenantID, ID: uuid.Must(uuid.NewV7()), Name: "Night Train Books", Surfaces: []string{testSurface}, PublishedAt: published}
	series := publishedSeries(tenantID, "Night Train", "")
	put(t, backend, creator, label, series)

	ctx := context.Background()
	creators, err := backend.SearchCreators(ctx, catalogsearch.Request{TenantID: tenantID, Surface: testSurface, Query: "みやざわ", Limit: 10})
	if err != nil {
		t.Fatalf("SearchCreators: %v", err)
	}
	assertIDs(t, "みやざわ", creators.IDs, creator.ID)

	labels, err := backend.SearchLabels(ctx, catalogsearch.Request{TenantID: tenantID, Surface: testSurface, Query: "nigt train", Limit: 10})
	if err != nil {
		t.Fatalf("SearchLabels: %v", err)
	}
	assertIDs(t, "nigt train", labels.IDs, label.ID)
}

func TestPagesThroughHitsInBothDirections(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())

	docs := []Document{
		publishedSeries(tenantID, "Seed", ""),
		publishedSeries(tenantID, "Seed Garden", ""),
		publishedSeries(tenantID, "Seed Garden Stories", ""),
		publishedSeries(tenantID, "Seed Garden Stories Again", ""),
	}
	put(t, backend, docs...)

	first := searchSeries(t, backend, tenantID, "seed", 2, pagination.Cursor{})
	if len(first.IDs) != 2 || first.PreviousToken != "" || first.NextToken == "" {
		t.Fatalf("first page = %+v, want two hits and only a next token", first)
	}
	// The whole title typed as it is written ranks first.
	if first.IDs[0] != docs[0].ID {
		t.Fatalf("first hit = %s, want the exact title %s", first.IDs[0], docs[0].ID)
	}

	second := searchSeries(t, backend, tenantID, "Seed", 2, decodeToken(t, first.NextToken))
	if len(second.IDs) != 2 || second.NextToken != "" || second.PreviousToken == "" {
		t.Fatalf("second page = %+v, want two hits and only a previous token", second)
	}
	all := append(slices.Clone(first.IDs), second.IDs...)
	for _, doc := range docs {
		if !slices.Contains(all, doc.ID) {
			t.Fatalf("pages %v miss %s", all, doc.ID)
		}
	}

	back := searchSeries(t, backend, tenantID, "seed", 2, decodeToken(t, second.PreviousToken))
	assertIDs(t, "seed", back.IDs, first.IDs...)
	if back.PreviousToken != "" || back.NextToken == "" {
		t.Fatalf("page back = %+v, want only a next token", back)
	}

	if _, err := backend.SearchSeries(context.Background(), catalogsearch.SeriesRequest{Request: catalogsearch.Request{
		TenantID: tenantID, Surface: testSurface, Query: "garden", Limit: 2, Cursor: decodeToken(t, first.NextToken),
	}}); !errors.Is(err, catalogsearch.ErrTokenForAnotherQuery) {
		t.Fatalf("search with another query's token: error = %v, want %v", err, catalogsearch.ErrTokenForAnotherQuery)
	}
}

func TestRecoveryTokenReturnsToTheBoundaryHit(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())

	kept := publishedSeries(tenantID, "Seed", "")
	removed := publishedSeries(tenantID, "Seed Garden", "")
	put(t, backend, kept, removed)

	first := searchSeries(t, backend, tenantID, "seed", 1, pagination.Cursor{})
	assertIDs(t, "seed", first.IDs, kept.ID)

	if err := backend.Delete(context.Background(), KindSeries, tenantID, removed.ID, 0); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	refresh(t, backend)

	empty := searchSeries(t, backend, tenantID, "seed", 1, decodeToken(t, first.NextToken))
	if len(empty.IDs) != 0 || empty.NextToken != "" {
		t.Fatalf("page past the last hit = %+v, want no hits and no next token", empty)
	}
	recovered := searchSeries(t, backend, tenantID, "seed", 1, decodeToken(t, empty.PreviousToken))
	assertIDs(t, "seed", recovered.IDs, kept.ID)

	// A recovery token whose boundary is gone too answers an empty page with
	// no tokens, so the reader falls back to the first page.
	if err := backend.Delete(context.Background(), KindSeries, tenantID, kept.ID, 0); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	refresh(t, backend)
	gone := searchSeries(t, backend, tenantID, "seed", 1, decodeToken(t, empty.PreviousToken))
	if len(gone.IDs) != 0 || gone.PreviousToken != "" || gone.NextToken != "" {
		t.Fatalf("recovery page with its boundary gone = %+v, want nothing", gone)
	}
}

// A second process starting against an index the first one created leaves it
// as it is.
func TestEnsureIndexKeepsAnExistingIndex(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())

	seed := publishedSeries(tenantID, "Seed", "")
	put(t, backend, seed)
	if err := backend.EnsureIndex(context.Background()); err != nil {
		t.Fatalf("EnsureIndex on an existing index: %v", err)
	}
	page := searchSeries(t, backend, tenantID, "seed", 10, pagination.Cursor{})
	assertIDs(t, "seed", page.IDs, seed.ID)
}

// A first start puts the index behind the configured name as an alias, which
// is what a rebuild moves.
func TestEnsureIndexCreatesTheIndexBehindAnAlias(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)

	indices, err := backend.aliasIndices(context.Background())
	if err != nil {
		t.Fatalf("aliasIndices: %v", err)
	}
	if want := []string{backend.index + initialIndexSuffix}; !slices.Equal(indices, want) {
		t.Fatalf("alias %q names %v, want %v", backend.index, indices, want)
	}
}

// A row read before another write carries the lower version, so writing it
// last leaves the later read in place, a delete included.
func TestAWriteOfALowerVersionLeavesTheDocumentAsItIs(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())
	ctx := context.Background()

	renamed := publishedSeries(tenantID, "Harbor Lights", "")
	renamed.Version = 20
	stale := renamed
	stale.Title = "Seed Garden"
	stale.Version = 10
	put(t, backend, renamed, stale)

	assertIDs(t, "harbor", searchSeries(t, backend, tenantID, "harbor", 10, pagination.Cursor{}).IDs, renamed.ID)
	assertIDs(t, "seed", searchSeries(t, backend, tenantID, "seed", 10, pagination.Cursor{}).IDs)

	if err := backend.Delete(ctx, KindSeries, tenantID, renamed.ID, 15); err != nil {
		t.Fatalf("Delete of a lower version: %v", err)
	}
	refresh(t, backend)
	assertIDs(t, "harbor", searchSeries(t, backend, tenantID, "harbor", 10, pagination.Cursor{}).IDs, renamed.ID)

	// The engine forgets a deleted document's version once index.gc_deletes
	// has passed. With it at zero, only a delete that keeps its version as a
	// document can refuse the stale write that follows it.
	if _, err := backend.client.Indices.PutSettings(ctx, &opensearchapi.IndicesPutSettingsReq{
		Indices:    []string{backend.index},
		BodyReader: strings.NewReader(`{"index":{"gc_deletes":"0s"}}`),
	}); err != nil {
		t.Fatalf("set gc_deletes: %v", err)
	}
	if err := backend.Delete(ctx, KindSeries, tenantID, renamed.ID, 30); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	refresh(t, backend)
	put(t, backend, stale)
	assertIDs(t, "seed", searchSeries(t, backend, tenantID, "seed", 10, pagination.Cursor{}).IDs)
}

func TestRebuildMovesTheAliasOntoTheNewIndex(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())
	ctx := context.Background()

	old := publishedSeries(tenantID, "Seed Garden", "")
	put(t, backend, old)

	rebuild, err := backend.StartRebuild(ctx)
	if err != nil {
		t.Fatalf("StartRebuild: %v", err)
	}
	rebuilt := publishedSeries(tenantID, "Seed Harbor", "")
	if err := rebuild.PutAll(ctx, []Document{rebuilt}); err != nil {
		t.Fatalf("PutAll: %v", err)
	}
	// Until the swap, searches answer from the index the alias names.
	assertIDs(t, "seed", searchSeries(t, backend, tenantID, "seed", 10, pagination.Cursor{}).IDs, old.ID)

	if err := rebuild.Swap(ctx); err != nil {
		t.Fatalf("Swap: %v", err)
	}
	assertIDs(t, "seed", searchSeries(t, backend, tenantID, "seed", 10, pagination.Cursor{}).IDs, rebuilt.ID)
	indices, err := backend.aliasIndices(ctx)
	if err != nil {
		t.Fatalf("aliasIndices: %v", err)
	}
	if want := []string{rebuild.Index()}; !slices.Equal(indices, want) {
		t.Fatalf("alias names %v after the swap, want %v", indices, want)
	}
	if exists, err := backend.nameExists(ctx, backend.index+initialIndexSuffix); err != nil || exists {
		t.Fatalf("the index the alias named before exists = %v (%v), want it deleted", exists, err)
	}
}

func TestAbortedRebuildLeavesTheAliasWhereItWas(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	ctx := context.Background()

	rebuild, err := backend.StartRebuild(ctx)
	if err != nil {
		t.Fatalf("StartRebuild: %v", err)
	}
	if err := rebuild.Abort(ctx); err != nil {
		t.Fatalf("Abort: %v", err)
	}
	if exists, err := backend.nameExists(ctx, rebuild.Index()); err != nil || exists {
		t.Fatalf("aborted index exists = %v (%v), want it deleted", exists, err)
	}
	indices, err := backend.aliasIndices(ctx)
	if err != nil {
		t.Fatalf("aliasIndices: %v", err)
	}
	if want := []string{backend.index + initialIndexSuffix}; !slices.Equal(indices, want) {
		t.Fatalf("alias names %v, want %v", indices, want)
	}
}

// An index created under the configured name itself, before that name was an
// alias, gives the name up to the alias in the same step.
func TestRebuildReplacesAnIndexThatHasTheAliasName(t *testing.T) {
	t.Parallel()
	env := testutil.StartOpenSearch(t)
	ctx := context.Background()
	client, err := opensearchapi.NewClient(opensearchapi.Config{Client: opensearch.Config{Addresses: []string{env.URL}}})
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	backend := &Backend{client: client, index: "catalog-test-" + uuid.NewString()}
	t.Cleanup(func() { deleteIndices(backend) })
	if err := backend.createIndex(ctx, backend.index, indexDefinition); err != nil {
		t.Fatalf("create the index under the alias name: %v", err)
	}

	rebuild, err := backend.StartRebuild(ctx)
	if err != nil {
		t.Fatalf("StartRebuild: %v", err)
	}
	if err := rebuild.Swap(ctx); err != nil {
		t.Fatalf("Swap: %v", err)
	}
	indices, err := backend.aliasIndices(ctx)
	if err != nil {
		t.Fatalf("aliasIndices: %v", err)
	}
	if want := []string{rebuild.Index()}; !slices.Equal(indices, want) {
		t.Fatalf("alias names %v, want %v", indices, want)
	}
}

func searchNarrowed(t *testing.T, backend *Backend, req catalogsearch.SeriesRequest) catalogsearch.Page {
	t.Helper()
	page, err := backend.SearchSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("SearchSeries(%q, %s, %+v): %v", req.Query, req.Order.Name, req.Filter, err)
	}
	return page
}

func narrowed(tenantID uuid.UUID, order publishedseries.Order, filter publishedseries.Filter, limit int32, cursor pagination.Cursor) catalogsearch.SeriesRequest {
	return catalogsearch.SeriesRequest{
		Request: catalogsearch.Request{TenantID: tenantID, Surface: testSurface, Query: "seed", Limit: limit, Cursor: cursor},
		Order:   order,
		Filter:  filter,
	}
}

func TestSearchSeriesKeepsOnlyWhatEachFilterKeeps(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())

	alpha := publishedSeries(tenantID, "Seed Alpha", "")
	alpha.GenrePublicIDs = []string{"GENREMYSTERY"}
	alpha.TagSlugs = []string{"found-family"}
	alpha.Status = "ongoing"
	alpha.ScheduleWeekdays = []int32{1, 4}
	alpha.FreeEpisodeSurfaces = []string{testSurface}
	// Bravo is free on the app alone, which the web does not count.
	bravo := publishedSeries(tenantID, "Seed Bravo", "")
	bravo.GenrePublicIDs = []string{"GENREROMANCE"}
	bravo.TagSlugs = []string{"slow-burn"}
	bravo.Status = "completed"
	bravo.FreeEpisodeSurfaces = []string{"app"}
	charlie := publishedSeries(tenantID, "Seed Charlie", "")
	charlie.GenrePublicIDs = []string{"GENREMYSTERY", "GENREROMANCE"}
	charlie.TagSlugs = []string{"found-family", "slow-burn"}
	charlie.Status = "completed"
	charlie.ScheduleWeekdays = []int32{4}
	put(t, backend, alpha, bravo, charlie)

	text := func(value string) sql.NullString { return sql.NullString{String: value, Valid: true} }
	weekday := func(value int16) sql.NullInt16 { return sql.NullInt16{Int16: value, Valid: true} }
	for _, test := range []struct {
		name   string
		filter publishedseries.Filter
		want   []uuid.UUID
	}{
		{name: "none", want: []uuid.UUID{alpha.ID, bravo.ID, charlie.ID}},
		{name: "free on this surface", filter: publishedseries.Filter{HasFreeEpisodes: true}, want: []uuid.UUID{alpha.ID}},
		{name: "a genre", filter: publishedseries.Filter{GenrePublicID: text("GENREMYSTERY")}, want: []uuid.UUID{alpha.ID, charlie.ID}},
		{name: "a tag", filter: publishedseries.Filter{TagSlug: text("slow-burn")}, want: []uuid.UUID{bravo.ID, charlie.ID}},
		{name: "a status", filter: publishedseries.Filter{Status: text("completed")}, want: []uuid.UUID{bravo.ID, charlie.ID}},
		{name: "a weekday", filter: publishedseries.Filter{Weekday: weekday(4)}, want: []uuid.UUID{alpha.ID, charlie.ID}},
		// Sunday is 0, which is a weekday to keep rather than no filter.
		{name: "sunday", filter: publishedseries.Filter{Weekday: weekday(0)}},
		{name: "every filter at once", filter: publishedseries.Filter{GenrePublicID: text("GENREMYSTERY"), TagSlug: text("found-family"), Status: text("ongoing"), Weekday: weekday(1), HasFreeEpisodes: true}, want: []uuid.UUID{alpha.ID}},
		{name: "two filters no series satisfies both", filter: publishedseries.Filter{GenrePublicID: text("GENREROMANCE"), Status: text("ongoing")}},
	} {
		page := searchNarrowed(t, backend, narrowed(tenantID, publishedseries.TitleAsc, test.filter, 10, pagination.Cursor{}))
		if !slices.Equal(page.IDs, test.want) {
			t.Errorf("%s: hits = %v, want %v", test.name, page.IDs, test.want)
		}
	}
}

func TestSearchSeriesSortsByEveryListOrder(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()

	alpha := publishedSeries(tenantID, "Seed Alpha", "")
	alpha.PublishedAt = now.Add(-3 * time.Hour)
	alpha.LatestEpisodeAt = map[string]time.Time{testSurface: now.Add(-10 * time.Minute)}
	bravo := publishedSeries(tenantID, "Seed Bravo", "")
	bravo.PublishedAt = now.Add(-1 * time.Hour)
	bravo.LatestEpisodeAt = map[string]time.Time{testSurface: now.Add(-30 * time.Minute)}
	// Charlie's latest episode differs by surface, and Delta is on the app
	// alone, so each surface sorts by its own instants.
	charlie := publishedSeries(tenantID, "Seed Charlie", "")
	charlie.PublishedAt = now.Add(-2 * time.Hour)
	charlie.Surfaces = []string{"app", testSurface}
	charlie.LatestEpisodeAt = map[string]time.Time{testSurface: now.Add(-5 * time.Minute), "app": now.Add(-100 * time.Minute)}
	delta := publishedSeries(tenantID, "Seed Delta", "")
	delta.Surfaces = []string{"app"}
	delta.LatestEpisodeAt = map[string]time.Time{"app": now.Add(-time.Minute)}
	put(t, backend, alpha, bravo, charlie, delta)

	for _, test := range []struct {
		order publishedseries.Order
		want  []uuid.UUID
	}{
		{order: publishedseries.TitleAsc, want: []uuid.UUID{alpha.ID, bravo.ID, charlie.ID}},
		{order: publishedseries.TitleDesc, want: []uuid.UUID{charlie.ID, bravo.ID, alpha.ID}},
		{order: publishedseries.PublishedAtDesc, want: []uuid.UUID{bravo.ID, charlie.ID, alpha.ID}},
		{order: publishedseries.PublishedAtAsc, want: []uuid.UUID{alpha.ID, charlie.ID, bravo.ID}},
		{order: publishedseries.LatestEpisodeAtDesc, want: []uuid.UUID{charlie.ID, alpha.ID, bravo.ID}},
	} {
		page := searchNarrowed(t, backend, narrowed(tenantID, test.order, publishedseries.Filter{}, 10, pagination.Cursor{}))
		if !slices.Equal(page.IDs, test.want) {
			t.Errorf("%s: hits = %v, want %v", test.order.Name, page.IDs, test.want)
		}
	}

	app := narrowed(tenantID, publishedseries.LatestEpisodeAtDesc, publishedseries.Filter{}, 10, pagination.Cursor{})
	app.Surface = "app"
	assertIDs(t, "seed on app", searchNarrowed(t, backend, app).IDs, delta.ID, charlie.ID)
}

// A sorted search pages forward and back through ties on the sorted value,
// which the id breaks in the order's direction.
func TestPagesThroughASortedSearchInBothDirections(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())
	at := time.Now().Add(-time.Hour).Truncate(time.Millisecond)

	var docs []Document
	for _, title := range []string{"Seed One", "Seed Two", "Seed Three", "Seed Four", "Seed Five"} {
		doc := publishedSeries(tenantID, title, "")
		doc.LatestEpisodeAt = map[string]time.Time{testSurface: at}
		docs = append(docs, doc)
	}
	put(t, backend, docs...)

	order := publishedseries.LatestEpisodeAtDesc
	all := searchNarrowed(t, backend, narrowed(tenantID, order, publishedseries.Filter{}, 10, pagination.Cursor{}))
	// Every instant is the same, so the order is the ids, newest first.
	want := make([]uuid.UUID, 0, len(docs))
	for index := len(docs) - 1; index >= 0; index-- {
		want = append(want, docs[index].ID)
	}
	assertIDs(t, "seed", all.IDs, want...)

	first := searchNarrowed(t, backend, narrowed(tenantID, order, publishedseries.Filter{}, 2, pagination.Cursor{}))
	second := searchNarrowed(t, backend, narrowed(tenantID, order, publishedseries.Filter{}, 2, decodeToken(t, first.NextToken)))
	third := searchNarrowed(t, backend, narrowed(tenantID, order, publishedseries.Filter{}, 2, decodeToken(t, second.NextToken)))
	if third.NextToken != "" {
		t.Fatalf("third page = %+v, want no next token", third)
	}
	assertIDs(t, "seed", slices.Concat(first.IDs, second.IDs, third.IDs), want...)

	back := searchNarrowed(t, backend, narrowed(tenantID, order, publishedseries.Filter{}, 2, decodeToken(t, third.PreviousToken)))
	assertIDs(t, "seed", back.IDs, second.IDs...)
	back = searchNarrowed(t, backend, narrowed(tenantID, order, publishedseries.Filter{}, 2, decodeToken(t, back.PreviousToken)))
	assertIDs(t, "seed", back.IDs, first.IDs...)
	if back.PreviousToken != "" {
		t.Fatalf("page back to the start = %+v, want no previous token", back)
	}

	// The last hit gone, the page after the second is empty and hands back a
	// token that includes the second page's last hit.
	for _, id := range third.IDs {
		if err := backend.Delete(context.Background(), KindSeries, tenantID, id, 0); err != nil {
			t.Fatalf("Delete: %v", err)
		}
	}
	refresh(t, backend)
	empty := searchNarrowed(t, backend, narrowed(tenantID, order, publishedseries.Filter{}, 1, decodeToken(t, second.NextToken)))
	if len(empty.IDs) != 0 {
		t.Fatalf("page past the last hit = %v, want none", empty.IDs)
	}
	recovered := searchNarrowed(t, backend, narrowed(tenantID, order, publishedseries.Filter{}, 1, decodeToken(t, empty.PreviousToken)))
	assertIDs(t, "seed", recovered.IDs, second.IDs[len(second.IDs)-1])
}

// A token names the order and the filters it was issued under, and another
// order or another filter is refused rather than read as a boundary that sits
// elsewhere in that list.
func TestATokenIsBoundToItsOrderAndFilters(t *testing.T) {
	t.Parallel()
	backend := newTestBackend(t)
	tenantID := uuid.Must(uuid.NewV7())

	free := publishedSeries(tenantID, "Seed Alpha", "")
	free.FreeEpisodeSurfaces = []string{testSurface}
	other := publishedSeries(tenantID, "Seed Bravo", "")
	other.FreeEpisodeSurfaces = []string{testSurface}
	put(t, backend, free, other)

	byTitle := searchNarrowed(t, backend, narrowed(tenantID, publishedseries.TitleAsc, publishedseries.Filter{}, 1, pagination.Cursor{}))
	byRelevance := searchNarrowed(t, backend, narrowed(tenantID, publishedseries.Order{}, publishedseries.Filter{}, 1, pagination.Cursor{}))
	onlyFree := publishedseries.Filter{HasFreeEpisodes: true}
	for _, test := range []struct {
		name   string
		token  string
		order  publishedseries.Order
		filter publishedseries.Filter
	}{
		{name: "another order", token: byTitle.NextToken, order: publishedseries.TitleDesc},
		{name: "a filter added", token: byTitle.NextToken, order: publishedseries.TitleAsc, filter: onlyFree},
		{name: "the order dropped", token: byTitle.NextToken},
		{name: "an order added", token: byRelevance.NextToken, order: publishedseries.TitleAsc},
		{name: "a filter added to relevance", token: byRelevance.NextToken, filter: onlyFree},
	} {
		_, err := backend.SearchSeries(context.Background(), narrowed(tenantID, test.order, test.filter, 1, decodeToken(t, test.token)))
		if !errors.Is(err, catalogsearch.ErrTokenForAnotherNarrowing) {
			t.Errorf("%s: error = %v, want %v", test.name, err, catalogsearch.ErrTokenForAnotherNarrowing)
		}
	}

	// The same order and filters accept it.
	next := searchNarrowed(t, backend, narrowed(tenantID, publishedseries.TitleAsc, publishedseries.Filter{}, 1, decodeToken(t, byTitle.NextToken)))
	assertIDs(t, "seed", next.IDs, other.ID)
}
