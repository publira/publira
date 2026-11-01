package imageserver

import (
	"context"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ageverification"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/testutil"
)

// freeEpisodeTokenQuery is the query string a page of a free body, and a page
// a preview opens, carries: the per-episode token no reader is named in.
func freeEpisodeTokenQuery(t *testing.T, tenantID, episodeID uuid.UUID) string {
	t.Helper()

	token, _, err := testutil.TokenManager().IssueFreeEpisodeMediaToken(tenantID.String(), episodeID.String(), time.Now())
	if err != nil {
		t.Fatalf("IssueFreeEpisodeMediaToken: %v", err)
	}
	return "?" + auth.MediaTokenQueryParam + "=" + url.QueryEscape(token)
}

func TestDBEpisodeImageServesThePagesAPreviewOpens(t *testing.T) {
	env := newPreviewDBEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:         "EPISODEPAY01",
		Title:            "Paid",
		Status:           testutil.EpisodeStatusPublished,
		Price:            500,
		PreviewPageCount: 3,
	})
	// Seeded out of reading order, so the open pages are found by
	// display_order rather than by which row came first.
	fourth := env.seedPage(t, episode.ID, 4)
	opening := []uuid.UUID{env.seedPage(t, episode.ID, 1), env.seedPage(t, episode.ID, 2), env.seedPage(t, episode.ID, 3)}
	query := freeEpisodeTokenQuery(t, env.tenant.ID, episode.ID)

	for _, page := range opening {
		rec := env.get(t, "/images/episodes/"+page.String()+query)
		if rec.Code != http.StatusOK {
			t.Fatalf("open page %s: status = %d, body = %q", page, rec.Code, rec.Body.String())
		}
		// The same URL for every reader, so the copy a shared cache keeps is
		// the one every reader would have been sent.
		if got := rec.Header().Get("Cache-Control"); got != publicImageCacheControl {
			t.Fatalf("open page %s: Cache-Control = %q, want %q", page, got, publicImageCacheControl)
		}
	}
	if rec := env.get(t, "/images/episodes/"+fourth.String()+query); rec.Code != http.StatusForbidden {
		t.Fatalf("the page after the preview: status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestDBEpisodeImageRefusesEveryPageOfAnEpisodeWithNoPreview(t *testing.T) {
	env := newPreviewDBEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	page := env.seedPage(t, episode.ID, 1)

	if rec := env.get(t, "/images/episodes/"+page.String()+freeEpisodeTokenQuery(t, env.tenant.ID, episode.ID)); rec.Code != http.StatusForbidden {
		t.Fatalf("first page: status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

// A preview opens nothing of an episode nobody may read yet, the way a free
// body that is not published is not served.
func TestDBEpisodeImageRefusesThePreviewOfADraft(t *testing.T) {
	env := newPreviewDBEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	draft := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:         "EPISODEDRF01",
		Title:            "Draft",
		Price:            500,
		PreviewPageCount: 1,
	})
	page := env.seedPage(t, draft.ID, 1)

	if rec := env.get(t, "/images/episodes/"+page.String()+freeEpisodeTokenQuery(t, env.tenant.ID, draft.ID)); rec.Code != http.StatusForbidden {
		t.Fatalf("open page of a draft: status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

// A page the preview opens is under the tenant's age rule as a free page is:
// refused on the path that names nobody, and served on a reader's own token
// once the account it names clears the rule.
func TestDBEpisodeImageHoldsThePreviewToTheAgeRule(t *testing.T) {
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
		PublicID:         "EPISODEAGE01",
		Title:            "Rated Episode",
		Status:           testutil.EpisodeStatusPublished,
		Price:            500,
		PreviewPageCount: 1,
	})
	page := env.seedPage(t, episode.ID, 1)
	next := env.seedPage(t, episode.ID, 2)

	if rec := env.get(t, "/images/episodes/"+page.String()+freeEpisodeTokenQuery(t, env.tenant.ID, episode.ID)); rec.Code != http.StatusForbidden {
		t.Fatalf("open page on the shared token: status = %d, want %d", rec.Code, http.StatusForbidden)
	}

	readerToken := func(publicID string, birthDate time.Time) string {
		t.Helper()
		user := env.pg.SeedEndUser(t, env.tenant.ID, publicID, publicID+"@tenant-a.example.com", publicID)
		if !birthDate.IsZero() {
			if _, err := env.pg.DB.ExecContext(ctx, "UPDATE users SET birth_date = $2 WHERE id = $1", user.ID, birthDate); err != nil {
				t.Fatalf("set birth_date: %v", err)
			}
		}
		token, _, err := testutil.TokenManager().IssueMediaToken(user.PublicID, env.tenant.ID.String(), episode.ID.String(), user.CredentialsVersion, time.Now())
		if err != nil {
			t.Fatalf("IssueMediaToken: %v", err)
		}
		return "?" + auth.MediaTokenQueryParam + "=" + url.QueryEscape(token)
	}

	adult := readerToken("READERADULT1", time.Now().AddDate(-30, 0, 0))
	if rec := env.get(t, "/images/episodes/"+page.String()+adult); rec.Code != http.StatusOK {
		t.Fatalf("open page on an adult reader's token: status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if rec := env.get(t, "/images/episodes/"+next.String()+adult); rec.Code != http.StatusForbidden {
		t.Fatalf("the page after the preview on an adult reader's token: status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	if rec := env.get(t, "/images/episodes/"+page.String()+readerToken("READERMINOR1", time.Now().AddDate(-15, 0, 0))); rec.Code != http.StatusForbidden {
		t.Fatalf("open page on a minor's token: status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}
