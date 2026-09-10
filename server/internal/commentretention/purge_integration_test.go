package commentretention

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// commentSeed is one tenant with an episode and a reader to hang comments off.
type commentSeed struct {
	tenantID  uuid.UUID
	episodeID uuid.UUID
	userID    uuid.UUID
}

func TestPurgerRunDeletesOnlyExpiredWithdrawnComments(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	cutoff := time.Date(2026, time.September, 8, 12, 0, 0, 0, time.UTC)
	first := seedCommentTenant(t, pg, "CMTA", "comment-purge.example.com", "Comment Purge Tenant")
	second := seedCommentTenant(t, pg, "CMTB", "other-comment-purge.example.com", "Other Comment Purge Tenant")

	// Three withdrawn comments past the window, across two tenants.
	expired := []uuid.UUID{
		insertWithdrawnComment(t, pg.DB, first, "CMTEXPIRED01", cutoff.AddDate(0, 0, -2)),
		insertWithdrawnComment(t, pg.DB, first, "CMTEXPIRED02", cutoff.Add(-time.Second)),
		insertWithdrawnComment(t, pg.DB, second, "CMTEXPIRED03", cutoff.AddDate(0, 0, -30)),
	}
	// One withdrawn exactly at the cutoff (the window is exclusive), one still
	// inside it, and the two removals the purge must never touch: a comment
	// staff hid long ago is the record of a moderation decision.
	retained := []uuid.UUID{
		insertWithdrawnComment(t, pg.DB, first, "CMTATCUTOFF1", cutoff),
		insertWithdrawnComment(t, pg.DB, second, "CMTRECENT001", cutoff.Add(time.Hour)),
		insertHiddenComment(t, pg.DB, first, "CMTHIDDEN001", cutoff.AddDate(0, 0, -365)),
		insertPublishedComment(t, pg.DB, second, "CMTPUBLISHED", cutoff.AddDate(0, 0, -365)),
	}
	// A report on a comment that expires goes with it; one on a comment that
	// survives stays.
	expiredReport := insertReport(t, pg.DB, first, expired[0])
	retainedReport := insertReport(t, pg.DB, first, retained[0])

	purger := NewPurger(pg.OpenPlatformDB(t))

	// A dry run reports the candidates of every tenant and deletes nothing.
	dry, err := purger.Run(context.Background(), PurgeOptions{Cutoff: cutoff, DryRun: true})
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if want := (PurgeResult{TenantCount: 2, RowCount: 3, DryRun: true}); dry != want {
		t.Fatalf("dry run result = %+v, want %+v", dry, want)
	}
	if got := countComments(t, pg.DB); got != 7 {
		t.Fatalf("comments after dry run = %d, want 7", got)
	}

	// ChunkSize below the first tenant's candidate count forces its loop to
	// iterate: two chunks there, one for the tenant with a single candidate.
	result, err := purger.Run(context.Background(), PurgeOptions{Cutoff: cutoff, ChunkSize: 2})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := (PurgeResult{TenantCount: 2, RowCount: 3, ChunkCount: 3}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	for _, id := range expired {
		if commentExists(t, pg.DB, id) {
			t.Fatalf("expired comment %s survived the purge", id)
		}
	}
	for _, id := range retained {
		if !commentExists(t, pg.DB, id) {
			t.Fatalf("retained comment %s was purged", id)
		}
	}
	if reportExists(t, pg.DB, expiredReport) {
		t.Fatal("the report on a purged comment survived it")
	}
	if !reportExists(t, pg.DB, retainedReport) {
		t.Fatal("the report on a retained comment was deleted")
	}

	// Re-running deletes nothing but still probes each tenant once.
	again, err := purger.Run(context.Background(), PurgeOptions{Cutoff: cutoff, ChunkSize: 2})
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if want := (PurgeResult{TenantCount: 2, ChunkCount: 2}); again != want {
		t.Fatalf("second result = %+v, want %+v", again, want)
	}
}

func TestPurgerRunRejectsTenantScopedRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SeedTenant(t, "CMTPURGERLS1", "rls-comment-purge.example.com", "RLS Comment Purge")

	_, err := NewPurger(pg.OpenAdminDB(t)).Run(context.Background(), PurgeOptions{Cutoff: time.Now().UTC()})
	if err == nil || !strings.Contains(err.Error(), "BYPASSRLS") {
		t.Fatalf("Run error = %v, want BYPASSRLS requirement", err)
	}
}

// seedCommentTenant builds one tenant's public ids from prefix, which keeps the
// two tenants of a run apart in every table that spans them.
func seedCommentTenant(t *testing.T, pg *testutil.PostgresEnv, prefix, domain, name string) commentSeed {
	t.Helper()
	tenant := pg.SeedTenant(t, prefix+"TENANT01", domain, name)
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  prefix + "SERIES01",
		Title:     name + " Series",
		Published: true,
	})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EPISOD01",
		Title:    name + " Episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	user := pg.SeedEndUser(t, tenant.ID, prefix+"READER01", "reader@"+domain, name+" Reader")
	return commentSeed{tenantID: tenant.ID, episodeID: episode.ID, userID: user.ID}
}

func insertWithdrawnComment(t *testing.T, db *sql.DB, seed commentSeed, publicID string, withdrawnAt time.Time) uuid.UUID {
	t.Helper()
	return insertComment(t, db, seed, publicID, `
		INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, status, created_at, updated_at, published_at, withdrawn_at)
		VALUES ($1, $2, $3, $4, $5, 'A comment.', 'withdrawn', $6, $6, $6, $6)
	`, withdrawnAt)
}

func insertHiddenComment(t *testing.T, db *sql.DB, seed commentSeed, publicID string, hiddenAt time.Time) uuid.UUID {
	t.Helper()
	return insertComment(t, db, seed, publicID, `
		INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, status, created_at, updated_at, published_at, hidden_at, hidden_reason)
		VALUES ($1, $2, $3, $4, $5, 'A comment.', 'hidden', $6, $6, $6, $6, 'staff')
	`, hiddenAt)
}

func insertPublishedComment(t *testing.T, db *sql.DB, seed commentSeed, publicID string, publishedAt time.Time) uuid.UUID {
	t.Helper()
	return insertComment(t, db, seed, publicID, `
		INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, status, created_at, updated_at, published_at)
		VALUES ($1, $2, $3, $4, $5, 'A comment.', 'published', $6, $6, $6)
	`, publishedAt)
}

func insertComment(t *testing.T, db *sql.DB, seed commentSeed, publicID, statement string, at time.Time) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	id := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, statement, id, seed.tenantID, publicID, seed.episodeID, seed.userID, at); err != nil {
		t.Fatalf("insert comment %s: %v", publicID, err)
	}
	return id
}

func insertReport(t *testing.T, db *sql.DB, seed commentSeed, commentID uuid.UUID) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	id := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO episode_comment_reports (id, tenant_id, comment_id, reporter_user_id, reason)
		VALUES ($1, $2, $3, $4, 'spam')
	`, id, seed.tenantID, commentID, seed.userID); err != nil {
		t.Fatalf("insert report on comment %s: %v", commentID, err)
	}
	return id
}

func countComments(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int64
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM episode_comments").Scan(&count); err != nil {
		t.Fatalf("count comments: %v", err)
	}
	return count
}

func commentExists(t *testing.T, db *sql.DB, id uuid.UUID) bool {
	t.Helper()
	return rowExists(t, db, "SELECT EXISTS (SELECT 1 FROM episode_comments WHERE id = $1)", id)
}

func reportExists(t *testing.T, db *sql.DB, id uuid.UUID) bool {
	t.Helper()
	return rowExists(t, db, "SELECT EXISTS (SELECT 1 FROM episode_comment_reports WHERE id = $1)", id)
}

func rowExists(t *testing.T, db *sql.DB, query string, id uuid.UUID) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var exists bool
	if err := db.QueryRowContext(ctx, query, id).Scan(&exists); err != nil {
		t.Fatalf("look up row %s: %v", id, err)
	}
	return exists
}
