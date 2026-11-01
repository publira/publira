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

// creatorFollowerCount reads the stored tally, answering -1 for a creator with
// no row so a missing tally cannot be mistaken for an empty one.
func creatorFollowerCount(t *testing.T, ctx context.Context, db *sql.DB, tenantID, creatorID uuid.UUID) int64 {
	t.Helper()
	var count int64
	if err := db.QueryRowContext(ctx, `
		SELECT COALESCE((
			SELECT count FROM creator_follower_counts WHERE tenant_id = $1 AND creator_id = $2
		), -1)
	`, tenantID, creatorID).Scan(&count); err != nil {
		t.Fatalf("read the creator follower count: %v", err)
	}
	return count
}

// A reader follows and unfollows on their own connection, where the follows of
// every other reader are hidden, and the tally still moves: the trigger writes
// it, not the reader.
func TestCreatorFollowerCountFollowsAFollowAndItsUnfollow(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := seedFollowTargets(t, ctx, pg.DB, "CFCA0001")

	withMemberConn(t, pg, f.tenantID, f.userID, func(ctx context.Context, conn *sql.Conn) {
		q := dbmodels.New(conn)
		params := dbmodels.CreateCreatorFollowParams{TenantID: f.tenantID, UserID: f.userID, CreatorID: f.creatorID}
		if _, err := q.CreateCreatorFollow(ctx, params); err != nil {
			t.Fatalf("follow the creator: %v", err)
		}
		// Following again is a conflict that inserts nothing, so the reader is
		// not counted twice.
		if _, err := q.CreateCreatorFollow(ctx, params); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("follow the creator again: error = %v, want the conflict to insert nothing", err)
		}
	})
	withMemberConn(t, pg, f.tenantID, f.otherUser, func(ctx context.Context, conn *sql.Conn) {
		if _, err := dbmodels.New(conn).CreateCreatorFollow(ctx, dbmodels.CreateCreatorFollowParams{
			TenantID: f.tenantID, UserID: f.otherUser, CreatorID: f.creatorID,
		}); err != nil {
			t.Fatalf("follow the creator as another reader: %v", err)
		}
	})
	if got := creatorFollowerCount(t, ctx, pg.DB, f.tenantID, f.creatorID); got != 2 {
		t.Fatalf("follower count = %d, want 2", got)
	}

	withMemberConn(t, pg, f.tenantID, f.userID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := dbmodels.New(conn).DeleteCreatorFollow(ctx, dbmodels.DeleteCreatorFollowParams{
			TenantID: f.tenantID, UserID: f.userID, CreatorID: f.creatorID,
		}); err != nil {
			t.Fatalf("unfollow the creator: %v", err)
		}
	})
	if got := creatorFollowerCount(t, ctx, pg.DB, f.tenantID, f.creatorID); got != 1 {
		t.Fatalf("follower count after an unfollow = %d, want 1", got)
	}
}

// A departing account takes its follows with it in a cascade no handler runs,
// and the creator loses the reader all the same.
func TestCreatorFollowerCountFallsWhenAFollowerLeaves(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := seedFollowTargets(t, ctx, pg.DB, "CFCB0001")
	for _, userID := range []uuid.UUID{f.userID, f.otherUser} {
		mustExec(t, ctx, pg.DB, `
			INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)
		`, f.tenantID, userID, f.creatorID)
	}

	mustExec(t, ctx, pg.DB, "DELETE FROM users WHERE id = $1", f.userID)
	if got := creatorFollowerCount(t, ctx, pg.DB, f.tenantID, f.creatorID); got != 1 {
		t.Fatalf("follower count after the reader left = %d, want 1", got)
	}
}

// A deleted creator takes its follows and its tally with it, and the follows
// going in the cascade do not fail the delete.
func TestDeletingAFollowedCreatorTakesItsFollowerCountWithIt(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := seedFollowTargets(t, ctx, pg.DB, "CFCC0001")
	mustExec(t, ctx, pg.DB, `
		INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)
	`, f.tenantID, f.userID, f.creatorID)

	mustExec(t, ctx, pg.DB, "DELETE FROM creators WHERE id = $1", f.creatorID)
	if got := creatorFollowerCount(t, ctx, pg.DB, f.tenantID, f.creatorID); got != -1 {
		t.Fatalf("follower count of a deleted creator = %d, want no row", got)
	}
}

// The tally is derived, so an API connection may read it and may not write it:
// an Author page would otherwise show a number any request could set.
func TestCreatorFollowerCountsAreReadOnlyToTheAPIRoles(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := seedFollowTargets(t, ctx, pg.DB, "CFCD0001")
	mustExec(t, ctx, pg.DB, `
		INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)
	`, f.tenantID, f.userID, f.creatorID)

	for role, db := range map[string]*sql.DB{"publira_public": pg.OpenPublicDB(t), "publira_admin": pg.OpenAdminDB(t)} {
		conn := scopedConn(t, ctx, db, f.tenantID, f.otherUser)
		var count int64
		if err := conn.QueryRowContext(ctx,
			"SELECT count FROM creator_follower_counts WHERE creator_id = $1", f.creatorID).Scan(&count); err != nil {
			t.Fatalf("read the follower tally as %s: %v", role, err)
		}
		if count != 1 {
			t.Fatalf("follower count read as %s = %d, want 1", role, count)
		}
		for name, statement := range map[string]string{
			"update the tally": "UPDATE creator_follower_counts SET count = 9999 WHERE creator_id = $1",
			"delete the tally": "DELETE FROM creator_follower_counts WHERE creator_id = $1",
			"insert a tally":   "INSERT INTO creator_follower_counts (tenant_id, creator_id, count) SELECT $2, $1, 9999",
		} {
			if _, err := conn.ExecContext(ctx, statement, f.creatorID, f.tenantID); err == nil {
				t.Fatalf("%s as %s succeeded, want it refused", name, role)
			}
		}
	}
}

// The migration versions the backfill test steps between: the last one before
// the creator follower tally, and the one that added it.
const (
	beforeCreatorFollowerCountsVersion = 20261101013737
	creatorFollowerCountsVersion       = 20261101042510
)

// The follows standing when the migration runs come out of it counted, so an
// Author page starts from them rather than from zero.
func TestCreatorFollowerCountsMigrationCountsTheFollowsAlreadyStored(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	// Behind the migration under test, so the follows seeded below are rows it
	// finds rather than rows its triggers record.
	pg.MigrateTo(t, beforeCreatorFollowerCountsVersion)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := seedFollowTargets(t, ctx, pg.DB, "CFCE0001")
	for _, userID := range []uuid.UUID{f.userID, f.otherUser} {
		mustExec(t, ctx, pg.DB, `
			INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)
		`, f.tenantID, userID, f.creatorID)
	}

	pg.MigrateTo(t, creatorFollowerCountsVersion)

	if got := creatorFollowerCount(t, ctx, pg.DB, f.tenantID, f.creatorID); got != 2 {
		t.Fatalf("follower count = %d, want the 2 follows already stored", got)
	}
}
