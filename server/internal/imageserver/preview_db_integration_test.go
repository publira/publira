package imageserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ageverification"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/testutil"
)

// previewDBEnv is the image routes answering from a real database as the
// storefront's own login, so the row-level security and the opening-page rule
// in the queries take part rather than a stub's reading of them.
type previewDBEnv struct {
	pg     *testutil.PostgresEnv
	srv    *Server
	store  *countingStore
	tenant testutil.Tenant
}

func newPreviewDBEnv(t *testing.T) *previewDBEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	publicDB := pg.OpenPublicDB(t)
	site := SiteDB{Pool: publicDB, Tenants: NewDBTenantScopedFactory(publicDB, nil)}
	store := &countingStore{objects: map[string]storedObject{}}
	srv := newTestServerWithSites(t, dbmodels.New(publicDB), site, site, store, testutil.TokenManager())
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	return &previewDBEnv{pg: pg, srv: srv, store: store, tenant: tenant}
}

// seedPage seeds one page of the episode and stores its bytes under the key
// the seed names its rendition with.
func (e *previewDBEnv) seedPage(t *testing.T, episodeID uuid.UUID, displayOrder int32) uuid.UUID {
	t.Helper()

	imageID := e.pg.SeedEpisodeImage(t, e.tenant.ID, episodeID, displayOrder)
	e.store.mu.Lock()
	e.store.objects["episodes/"+episodeID.String()+"/"+imageID.String()] = storedObject{data: pageJPEG(t), contentType: "image/jpeg"}
	e.store.mu.Unlock()
	return imageID
}

func (e *previewDBEnv) get(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Host = e.tenant.Domain
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, req)
	return rec
}

func TestDBEpisodePreviewServesTheOpeningPagesOfALockedEpisode(t *testing.T) {
	env := newPreviewDBEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	// Seeded out of reading order, so the opening pages are found by
	// display_order rather than by which row came first.
	third := env.seedPage(t, episode.ID, 3)
	first := env.seedPage(t, episode.ID, 1)
	second := env.seedPage(t, episode.ID, 2)

	for _, imageID := range []uuid.UUID{first, second} {
		if rec := env.get(t, "/images/episodes/"+imageID.String()+"/preview"); rec.Code != http.StatusOK {
			t.Fatalf("preview of opening page %s: status = %d, body = %q", imageID, rec.Code, rec.Body.String())
		} else if got := rec.Header().Get("Content-Type"); got != imageproc.EpisodePreviewContentType {
			t.Fatalf("preview of opening page %s: Content-Type = %q", imageID, got)
		}
		// The full-size page stays refused to a reader who has bought nothing.
		if rec := env.get(t, "/images/episodes/"+imageID.String()); rec.Code != http.StatusForbidden {
			t.Fatalf("full-size page %s: status = %d, want %d", imageID, rec.Code, http.StatusForbidden)
		}
	}

	if rec := env.get(t, "/images/episodes/"+third.String()+"/preview"); rec.Code != http.StatusNotFound {
		t.Fatalf("preview of the third page: status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

// The tenant's age rule withholds the full-size page from a reader the
// anonymous path cannot vouch for, and leaves the preview to anyone.
func TestDBEpisodePreviewIgnoresTheTenantAgeRule(t *testing.T) {
	env := newPreviewDBEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, age_verification)
		VALUES ($1, $2)
		ON CONFLICT (tenant_id) DO UPDATE SET age_verification = EXCLUDED.age_verification
	`, env.tenant.ID, ageverification.R18); err != nil {
		t.Fatalf("set age_verification: %v", err)
	}
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Rated Series",
		Published: true,
		AgeRating: ageverification.RatingR18,
	})
	episode := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEAGE01",
		Title:    "Rated Episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	page := env.seedPage(t, episode.ID, 1)

	if rec := env.get(t, "/images/episodes/"+page.String()); rec.Code != http.StatusForbidden {
		t.Fatalf("full-size page: status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	if rec := env.get(t, "/images/episodes/"+page.String()+"/preview"); rec.Code != http.StatusOK {
		t.Fatalf("preview: status = %d, body = %q", rec.Code, rec.Body.String())
	}
}

func TestDBEpisodePreviewRefusesAnEpisodeNobodyMaySeeYet(t *testing.T) {
	env := newPreviewDBEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	draft := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEDRF01", Title: "Draft", Price: 500})
	page := env.seedPage(t, draft.ID, 1)

	if rec := env.get(t, "/images/episodes/"+page.String()+"/preview"); rec.Code != http.StatusForbidden {
		t.Fatalf("preview of a draft: status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	if env.store.getCount() != 0 {
		t.Fatalf("object store reads = %d, want none for a refused page", env.store.getCount())
	}
}

// Each page is stored at several widths, and the preview is rendered from the
// smallest: the rendition comes out the same size from any of them, and the
// smallest is the cheapest to decode.
func TestDBEpisodePreviewIsRenderedFromTheSmallestStoredRendition(t *testing.T) {
	env := newPreviewDBEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	episode := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	// The seed's own 1200 px rendition is left out of the store, so a preview
	// read from it would not be found.
	imageID := env.pg.SeedEpisodeImage(t, env.tenant.ID, episode.ID, 1)
	smallKey := "episodes/" + episode.ID.String() + "/" + imageID.String() + "-w480"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.pg.DB.ExecContext(ctx, `
		INSERT INTO episode_image_variants (
			id, tenant_id, episode_image_id, label, storage_provider, object_key,
			content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, $3, 'w480', 'local', $4, 'image/jpeg', 512, 480, 720)
	`, uuid.Must(uuid.NewV7()), env.tenant.ID, imageID, smallKey); err != nil {
		t.Fatalf("insert the 480 px rendition: %v", err)
	}
	env.store.mu.Lock()
	env.store.objects[smallKey] = storedObject{data: pageJPEG(t), contentType: "image/jpeg"}
	env.store.mu.Unlock()

	if rec := env.get(t, "/images/episodes/"+imageID.String()+"/preview"); rec.Code != http.StatusOK {
		t.Fatalf("preview: status = %d, body = %q", rec.Code, rec.Body.String())
	}
}
