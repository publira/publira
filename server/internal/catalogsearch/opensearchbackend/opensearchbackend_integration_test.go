package opensearchbackend

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v4/opensearchapi"

	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/pagination"
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
	t.Cleanup(func() {
		_, _ = backend.client.Indices.Delete(context.Background(), opensearchapi.IndicesDeleteReq{Indices: []string{backend.index}})
	})
	return backend
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
	if _, err := backend.client.Indices.Refresh(context.Background(), &opensearchapi.IndicesRefreshReq{Index: []string{backend.index}}); err != nil {
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
	page, err := backend.SearchSeries(context.Background(), catalogsearch.Request{
		TenantID: tenantID,
		Surface:  testSurface,
		Query:    query,
		Limit:    limit,
		Cursor:   cursor,
	})
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

	if err := backend.Delete(context.Background(), KindSeries, tenantID, visible.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	// A row that has no document is already gone.
	if err := backend.Delete(context.Background(), KindSeries, tenantID, visible.ID); err != nil {
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

	if _, err := backend.SearchSeries(context.Background(), catalogsearch.Request{
		TenantID: tenantID, Surface: testSurface, Query: "garden", Limit: 2, Cursor: decodeToken(t, first.NextToken),
	}); !errors.Is(err, catalogsearch.ErrTokenForAnotherQuery) {
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

	if err := backend.Delete(context.Background(), KindSeries, tenantID, removed.ID); err != nil {
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
	if err := backend.Delete(context.Background(), KindSeries, tenantID, kept.ID); err != nil {
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
