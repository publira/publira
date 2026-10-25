package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// seriesFollowerCount reads the stored tally, answering -1 for a series with no
// row so a missing tally cannot be mistaken for an empty one.
func seriesFollowerCount(t *testing.T, ctx context.Context, db *sql.DB, tenantID, seriesID uuid.UUID) int64 {
	t.Helper()
	var count int64
	if err := db.QueryRowContext(ctx, `
		SELECT COALESCE((
			SELECT count FROM series_follower_counts WHERE tenant_id = $1 AND series_id = $2
		), -1)
	`, tenantID, seriesID).Scan(&count); err != nil {
		t.Fatalf("read the series follower count: %v", err)
	}
	return count
}

// seriesFollowChanges reads a series' recorded changes in the order they were
// made.
func seriesFollowChanges(t *testing.T, ctx context.Context, db *sql.DB, tenantID, seriesID uuid.UUID) []int16 {
	t.Helper()
	rows, err := db.QueryContext(ctx, `
		SELECT change FROM series_follow_changes
		WHERE tenant_id = $1 AND series_id = $2
		ORDER BY changed_at, id
	`, tenantID, seriesID)
	if err != nil {
		t.Fatalf("read the series follow changes: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	changes := []int16{}
	for rows.Next() {
		var change int16
		if err := rows.Scan(&change); err != nil {
			t.Fatalf("scan a series follow change: %v", err)
		}
		changes = append(changes, change)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read the series follow changes: %v", err)
	}
	return changes
}

func assertFollowChanges(t *testing.T, label string, got []int16, want ...int16) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: changes = %v, want %v", label, got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("%s: changes = %v, want %v", label, got, want)
		}
	}
}

// A reader follows and unfollows on their own connection, where the follows of
// every other reader are hidden, and the tally and the changes still move:
// the trigger writes them, not the reader.
func TestSeriesFollowerCountFollowsAFollowAndItsUnfollow(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := seedFollowTargets(t, ctx, pg.DB, "SFCA0001")

	withMemberConn(t, pg, f.tenantID, f.userID, func(ctx context.Context, conn *sql.Conn) {
		q := dbmodels.New(conn)
		params := dbmodels.CreateSeriesFollowParams{TenantID: f.tenantID, UserID: f.userID, SeriesID: f.seriesID}
		if _, err := q.CreateSeriesFollow(ctx, params); err != nil {
			t.Fatalf("follow the series: %v", err)
		}
		// Following again is a conflict that inserts nothing, so the reader is
		// not counted twice.
		if _, err := q.CreateSeriesFollow(ctx, params); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("follow the series again: error = %v, want the conflict to insert nothing", err)
		}
	})
	withMemberConn(t, pg, f.tenantID, f.otherUser, func(ctx context.Context, conn *sql.Conn) {
		if _, err := dbmodels.New(conn).CreateSeriesFollow(ctx, dbmodels.CreateSeriesFollowParams{
			TenantID: f.tenantID, UserID: f.otherUser, SeriesID: f.seriesID,
		}); err != nil {
			t.Fatalf("follow the series as another reader: %v", err)
		}
	})
	if got := seriesFollowerCount(t, ctx, pg.DB, f.tenantID, f.seriesID); got != 2 {
		t.Fatalf("follower count = %d, want 2", got)
	}

	withMemberConn(t, pg, f.tenantID, f.userID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := dbmodels.New(conn).DeleteSeriesFollow(ctx, dbmodels.DeleteSeriesFollowParams{
			TenantID: f.tenantID, UserID: f.userID, SeriesID: f.seriesID,
		}); err != nil {
			t.Fatalf("unfollow the series: %v", err)
		}
	})
	if got := seriesFollowerCount(t, ctx, pg.DB, f.tenantID, f.seriesID); got != 1 {
		t.Fatalf("follower count after an unfollow = %d, want 1", got)
	}
	assertFollowChanges(t, "after an unfollow", seriesFollowChanges(t, ctx, pg.DB, f.tenantID, f.seriesID), 1, 1, -1)
}

// A departing account takes its follows with it in a cascade no handler runs,
// and the series loses the reader all the same.
func TestSeriesFollowerCountFallsWhenAFollowerLeaves(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := seedFollowTargets(t, ctx, pg.DB, "SFCB0001")
	for _, userID := range []uuid.UUID{f.userID, f.otherUser} {
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)
		`, f.tenantID, userID, f.seriesID); err != nil {
			t.Fatalf("follow the series: %v", err)
		}
	}

	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM users WHERE id = $1", f.userID); err != nil {
		t.Fatalf("delete the leaving reader: %v", err)
	}
	if got := seriesFollowerCount(t, ctx, pg.DB, f.tenantID, f.seriesID); got != 1 {
		t.Fatalf("follower count after the reader left = %d, want 1", got)
	}
	assertFollowChanges(t, "after the reader left", seriesFollowChanges(t, ctx, pg.DB, f.tenantID, f.seriesID), 1, 1, -1)
}

// A deleted series takes its follows, its tally, and its changes with it. The
// follows go by a cascade that runs once the series row is gone, and the
// change it would record could name no series, so it records none rather than
// failing the delete.
func TestDeletingAFollowedSeriesTakesItsFollowerCountsWithIt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := seedFollowTargets(t, ctx, pg.DB, "SFCC0001")
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)
	`, f.tenantID, f.userID, f.seriesID); err != nil {
		t.Fatalf("follow the series: %v", err)
	}

	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM episodes WHERE series_id = $1", f.seriesID); err != nil {
		t.Fatalf("delete the episodes of the series: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM series WHERE id = $1", f.seriesID); err != nil {
		t.Fatalf("delete the followed series: %v", err)
	}
	if got := seriesFollowerCount(t, ctx, pg.DB, f.tenantID, f.seriesID); got != -1 {
		t.Fatalf("follower count of a deleted series = %d, want no row", got)
	}
	assertFollowChanges(t, "after the series was deleted", seriesFollowChanges(t, ctx, pg.DB, f.tenantID, f.seriesID))
}

// The tally and the changes are derived, so an API connection may read them and
// may not write them: the console's follower line would otherwise be one any
// request could draw without a follow behind it.
func TestSeriesFollowerCountsAreReadOnlyToTheAPIRoles(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := seedFollowTargets(t, ctx, pg.DB, "SFCD0001")
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)
	`, f.tenantID, f.userID, f.seriesID); err != nil {
		t.Fatalf("follow the series: %v", err)
	}

	withMemberConn(t, pg, f.tenantID, f.otherUser, func(ctx context.Context, conn *sql.Conn) {
		var count int64
		if err := conn.QueryRowContext(ctx,
			"SELECT count FROM series_follower_counts WHERE series_id = $1", f.seriesID).Scan(&count); err != nil {
			t.Fatalf("read the follower tally as another member: %v", err)
		}
		if count != 1 {
			t.Fatalf("follower count = %d, want 1", count)
		}
		for name, statement := range map[string]string{
			"update the tally":  "UPDATE series_follower_counts SET count = 9999 WHERE series_id = $1",
			"delete the tally":  "DELETE FROM series_follower_counts WHERE series_id = $1",
			"insert a tally":    "INSERT INTO series_follower_counts (tenant_id, series_id, count) SELECT $2, $1, 9999",
			"insert a change":   "INSERT INTO series_follow_changes (tenant_id, series_id, change) SELECT $2, $1, 1",
			"delete the change": "DELETE FROM series_follow_changes WHERE series_id = $1",
		} {
			if _, err := conn.ExecContext(ctx, statement, f.seriesID, f.tenantID); err == nil {
				t.Fatalf("%s succeeded, want it refused", name)
			}
		}
	})
}

// The migration versions the backfill test steps between: the last one before
// the follower tallies, and the one that added them.
const (
	beforeSeriesFollowerCountsVersion = 20261025073840
	seriesFollowerCountsVersion       = 20261025092708
)

// The follows standing when the migration runs come out of it counted, each
// recorded as a follow made when it was made, so the console's line starts
// from them rather than from zero.
func TestSeriesFollowerCountsMigrationCountsTheFollowsAlreadyStored(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Behind the migration under test, so the follows seeded below are rows it
	// finds rather than rows its triggers record.
	pg.MigrateTo(t, beforeSeriesFollowerCountsVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := seedFollowTargets(t, ctx, pg.DB, "SFCE0001")
	followedAt := time.Date(2026, time.March, 4, 5, 6, 7, 0, time.UTC)
	for _, userID := range []uuid.UUID{f.userID, f.otherUser} {
		mustExec(t, ctx, pg.DB, `
			INSERT INTO series_follows (tenant_id, user_id, series_id, created_at) VALUES ($1, $2, $3, $4)
		`, f.tenantID, userID, f.seriesID, followedAt)
	}

	pg.MigrateTo(t, seriesFollowerCountsVersion)

	if got := seriesFollowerCount(t, ctx, pg.DB, f.tenantID, f.seriesID); got != 2 {
		t.Fatalf("follower count = %d, want the 2 follows already stored", got)
	}
	var made int
	mustQueryRow(t, ctx, pg.DB, `
		SELECT count(*) FROM series_follow_changes
		WHERE tenant_id = $1 AND series_id = $2 AND change = 1 AND changed_at = $3
	`, &made, f.tenantID, f.seriesID, followedAt)
	if made != 2 {
		t.Fatalf("follows recorded as made when they were made = %d, want 2", made)
	}
}
