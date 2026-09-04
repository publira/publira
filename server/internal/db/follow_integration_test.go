package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

type followTargets struct {
	tenantID  uuid.UUID
	userID    uuid.UUID
	otherUser uuid.UUID
	episodeID uuid.UUID
	creatorID uuid.UUID
	seriesID  uuid.UUID
}

func seedFollowTargets(t *testing.T, ctx context.Context, db *sql.DB, suffix string) followTargets {
	t.Helper()
	tenantID := mustInsertTenant(t, ctx, db, "T"+suffix, suffix+".example.com", "admin-"+suffix+".example.com", "Tenant "+suffix)
	userID := mustInsertUser(t, ctx, db, tenantID, "U"+suffix, "user-"+suffix+"@example.com", "User "+suffix)
	otherUser := mustInsertUser(t, ctx, db, tenantID, "O"+suffix, "other-"+suffix+"@example.com", "Other "+suffix)
	episodeID := mustInsertEpisode(t, ctx, db, tenantID, "E"+suffix, "Episode "+suffix)
	creatorID := mustInsertFollowCreator(t, ctx, db, tenantID, "C"+suffix)
	var seriesID uuid.UUID
	if err := db.QueryRowContext(ctx, "SELECT series_id FROM episodes WHERE id = $1", episodeID).Scan(&seriesID); err != nil {
		t.Fatalf("get episode series: %v", err)
	}
	return followTargets{tenantID, userID, otherUser, episodeID, creatorID, seriesID}
}

func mustInsertFollowCreator(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID, publicID string) uuid.UUID {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO creators (id, tenant_id, public_id, name)
		VALUES ($1, $2, $3, $4)
	`, id, tenantID, publicID, "Creator "+publicID)
	if err != nil {
		t.Fatalf("insert creator %s: %v", publicID, err)
	}
	return id
}

func withFollowMember(t *testing.T, pg *testutil.PostgresEnv, tenantID, userID uuid.UUID, fn func(context.Context, *sql.Conn)) {
	t.Helper()
	db := pg.OpenAdminDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("admin conn: %v", err)
	}
	defer func() { _ = conn.Close() }()
	for setting, value := range map[string]string{
		"app.current_tenant_id": tenantID.String(),
		"app.current_user_id":   userID.String(),
	} {
		if _, err := conn.ExecContext(ctx, "SELECT set_config($1, $2, false)", setting, value); err != nil {
			t.Fatalf("set %s: %v", setting, err)
		}
	}
	fn(ctx, conn)
}

func TestFollowsEnforceTenantAndMemberIsolation(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	a := seedFollowTargets(t, ctx, pg.DB, "FOLA0001")
	b := seedFollowTargets(t, ctx, pg.DB, "FOLB0002")
	q := dbmodels.New(pg.DB)

	if _, err := q.CreateEpisodeFollow(ctx, dbmodels.CreateEpisodeFollowParams{TenantID: a.tenantID, UserID: a.userID, EpisodeID: a.episodeID}); err != nil {
		t.Fatalf("create episode follow: %v", err)
	}
	if _, err := q.CreateCreatorFollow(ctx, dbmodels.CreateCreatorFollowParams{TenantID: a.tenantID, UserID: a.userID, CreatorID: a.creatorID}); err != nil {
		t.Fatalf("create creator follow: %v", err)
	}
	if _, err := q.CreateSeriesFollow(ctx, dbmodels.CreateSeriesFollowParams{TenantID: a.tenantID, UserID: a.userID, SeriesID: a.seriesID}); err != nil {
		t.Fatalf("create series follow: %v", err)
	}
	if _, err := q.CreateEpisodeFollow(ctx, dbmodels.CreateEpisodeFollowParams{TenantID: a.tenantID, UserID: a.userID, EpisodeID: a.episodeID}); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("duplicate episode follow error = %v, want sql.ErrNoRows", err)
	}
	if _, err := q.CreateCreatorFollow(ctx, dbmodels.CreateCreatorFollowParams{TenantID: a.tenantID, UserID: a.userID, CreatorID: a.creatorID}); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("duplicate creator follow error = %v, want sql.ErrNoRows", err)
	}
	if _, err := q.CreateSeriesFollow(ctx, dbmodels.CreateSeriesFollowParams{TenantID: a.tenantID, UserID: a.userID, SeriesID: a.seriesID}); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("duplicate series follow error = %v, want sql.ErrNoRows", err)
	}

	for _, tc := range []struct {
		name       string
		statement  string
		arguments  []any
		constraint string
	}{
		{
			name:       "episode from another tenant",
			statement:  "INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)",
			arguments:  []any{a.tenantID, a.userID, b.episodeID},
			constraint: "episode_follows_tenant_episode_id_fkey",
		},
		{
			name:       "creator from another tenant",
			statement:  "INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)",
			arguments:  []any{a.tenantID, a.userID, b.creatorID},
			constraint: "creator_follows_tenant_creator_id_fkey",
		},
		{
			name:       "series from another tenant",
			statement:  "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)",
			arguments:  []any{a.tenantID, a.userID, b.seriesID},
			constraint: "series_follows_tenant_series_id_fkey",
		},
		{
			name:       "member from another tenant",
			statement:  "INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)",
			arguments:  []any{a.tenantID, b.userID, a.episodeID},
			constraint: "episode_follows_tenant_user_id_fkey",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := pg.DB.ExecContext(ctx, tc.statement, tc.arguments...)
			if !isForeignKeyViolation(err) || !strings.Contains(err.Error(), tc.constraint) {
				t.Fatalf("insert error = %v, want %s foreign key violation", err, tc.constraint)
			}
		})
	}

	withFollowMember(t, pg, a.tenantID, a.userID, func(ctx context.Context, conn *sql.Conn) {
		assertFollowCount(t, ctx, conn, "episode_follows", 1)
		assertFollowCount(t, ctx, conn, "creator_follows", 1)
		assertFollowCount(t, ctx, conn, "series_follows", 1)
	})
	withFollowMember(t, pg, a.tenantID, a.otherUser, func(ctx context.Context, conn *sql.Conn) {
		assertFollowCount(t, ctx, conn, "episode_follows", 0)
		assertFollowCount(t, ctx, conn, "creator_follows", 0)
		assertFollowCount(t, ctx, conn, "series_follows", 0)
		result, err := conn.ExecContext(ctx, "DELETE FROM episode_follows WHERE episode_id = $1", a.episodeID)
		if err != nil {
			t.Fatalf("delete another member's follow: %v", err)
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 0 {
			t.Fatalf("delete another member's follow affected = %d, %v; want 0, nil", affected, err)
		}
		_, err = conn.ExecContext(ctx, "INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)", a.tenantID, a.userID, a.episodeID)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Fatalf("create another member's follow error = %v, want SQLSTATE 42501", err)
		}
	})
	withFollowMember(t, pg, b.tenantID, b.userID, func(ctx context.Context, conn *sql.Conn) {
		assertFollowCount(t, ctx, conn, "episode_follows", 0)
		assertFollowCount(t, ctx, conn, "creator_follows", 0)
		assertFollowCount(t, ctx, conn, "series_follows", 0)
	})

	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM users WHERE id = $1", a.userID); err != nil {
		t.Fatalf("delete followed member: %v", err)
	}
	assertSuperuserFollowCount(t, ctx, pg.DB, "episode_follows", 0)
	assertSuperuserFollowCount(t, ctx, pg.DB, "creator_follows", 0)
	assertSuperuserFollowCount(t, ctx, pg.DB, "series_follows", 0)

	targetUser := mustInsertUser(t, ctx, pg.DB, a.tenantID, "TARGFOLA01", "target-follow@example.com", "Target Follow")
	if _, err := q.CreateEpisodeFollow(ctx, dbmodels.CreateEpisodeFollowParams{TenantID: a.tenantID, UserID: targetUser, EpisodeID: a.episodeID}); err != nil {
		t.Fatalf("create episode follow for deletion: %v", err)
	}
	if _, err := q.CreateCreatorFollow(ctx, dbmodels.CreateCreatorFollowParams{TenantID: a.tenantID, UserID: targetUser, CreatorID: a.creatorID}); err != nil {
		t.Fatalf("create creator follow for deletion: %v", err)
	}
	if _, err := q.CreateSeriesFollow(ctx, dbmodels.CreateSeriesFollowParams{TenantID: a.tenantID, UserID: targetUser, SeriesID: a.seriesID}); err != nil {
		t.Fatalf("create series follow for deletion: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM episodes WHERE id = $1", a.episodeID); err != nil {
		t.Fatalf("delete episode: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM creators WHERE id = $1", a.creatorID); err != nil {
		t.Fatalf("delete creator: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM series WHERE id = $1", a.seriesID); err != nil {
		t.Fatalf("delete series: %v", err)
	}
	assertSuperuserFollowCount(t, ctx, pg.DB, "episode_follows", 0)
	assertSuperuserFollowCount(t, ctx, pg.DB, "creator_follows", 0)
	assertSuperuserFollowCount(t, ctx, pg.DB, "series_follows", 0)
}

func TestUserFollowsTimelineAndPublishedPredicates(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	targets := seedFollowTargets(t, ctx, pg.DB, "FOLC0003")
	q := dbmodels.New(pg.DB)
	publishFollowTargets(t, ctx, pg.DB, targets)

	if _, err := q.CreateEpisodeFollow(ctx, dbmodels.CreateEpisodeFollowParams{TenantID: targets.tenantID, UserID: targets.userID, EpisodeID: targets.episodeID}); err != nil {
		t.Fatalf("create episode follow: %v", err)
	}
	if _, err := q.CreateCreatorFollow(ctx, dbmodels.CreateCreatorFollowParams{TenantID: targets.tenantID, UserID: targets.userID, CreatorID: targets.creatorID}); err != nil {
		t.Fatalf("create creator follow: %v", err)
	}
	if _, err := q.CreateSeriesFollow(ctx, dbmodels.CreateSeriesFollowParams{TenantID: targets.tenantID, UserID: targets.userID, SeriesID: targets.seriesID}); err != nil {
		t.Fatalf("create series follow: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, "UPDATE episode_follows SET created_at = NOW() - INTERVAL '2 minutes'"); err != nil {
		t.Fatalf("set episode followed_at: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, "UPDATE series_follows SET created_at = NOW() - INTERVAL '1 minute'"); err != nil {
		t.Fatalf("set series followed_at: %v", err)
	}

	follows, err := q.ListUserFollowsByCreatedAtDesc(ctx, dbmodels.ListUserFollowsByCreatedAtDescParams{TenantID: targets.tenantID, UserID: targets.userID, Limit: 10})
	if err != nil {
		t.Fatalf("list follows: %v", err)
	}
	if len(follows) != 3 || follows[0].TargetType != "creator" || follows[0].TargetID != targets.creatorID || follows[1].TargetType != "series" || follows[1].TargetID != targets.seriesID || follows[2].TargetType != "episode" || follows[2].TargetID != targets.episodeID {
		t.Fatalf("timeline = %#v, want creator then series then episode", follows)
	}
	assertPublishedFollow(t, ctx, q, targets, true, true, true)

	if _, err := pg.DB.ExecContext(ctx, "UPDATE episode_listings SET status = 'draft' WHERE episode_id = $1", targets.episodeID); err != nil {
		t.Fatalf("unpublish episode: %v", err)
	}
	assertPublishedFollow(t, ctx, q, targets, false, true, true)
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE series s
		SET is_published = false
		FROM episodes e
		WHERE e.id = $1 AND s.id = e.series_id
	`, targets.episodeID); err != nil {
		t.Fatalf("unpublish series: %v", err)
	}
	assertPublishedFollow(t, ctx, q, targets, false, false, false)

	if affected, err := q.DeleteEpisodeFollow(ctx, dbmodels.DeleteEpisodeFollowParams{TenantID: targets.tenantID, UserID: targets.userID, EpisodeID: targets.episodeID}); err != nil || affected != 1 {
		t.Fatalf("delete episode follow = %d, %v; want 1, nil", affected, err)
	}
	if affected, err := q.DeleteCreatorFollow(ctx, dbmodels.DeleteCreatorFollowParams{TenantID: targets.tenantID, UserID: targets.userID, CreatorID: targets.creatorID}); err != nil || affected != 1 {
		t.Fatalf("delete creator follow = %d, %v; want 1, nil", affected, err)
	}
	if affected, err := q.DeleteSeriesFollow(ctx, dbmodels.DeleteSeriesFollowParams{TenantID: targets.tenantID, UserID: targets.userID, SeriesID: targets.seriesID}); err != nil || affected != 1 {
		t.Fatalf("delete series follow = %d, %v; want 1, nil", affected, err)
	}
	if affected, err := q.DeleteEpisodeFollow(ctx, dbmodels.DeleteEpisodeFollowParams{TenantID: targets.tenantID, UserID: targets.userID, EpisodeID: targets.episodeID}); err != nil || affected != 0 {
		t.Fatalf("repeat delete episode follow = %d, %v; want 0, nil", affected, err)
	}
}

func publishFollowTargets(t *testing.T, ctx context.Context, db *sql.DB, targets followTargets) {
	t.Helper()
	var seriesID uuid.UUID
	if err := db.QueryRowContext(ctx, "SELECT series_id FROM episodes WHERE id = $1", targets.episodeID).Scan(&seriesID); err != nil {
		t.Fatalf("get episode series: %v", err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE series SET is_published = true, published_at = NOW() - INTERVAL '1 minute' WHERE id = $1", seriesID); err != nil {
		t.Fatalf("publish series: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO episode_listings (episode_id, tenant_id, status, published_at)
		VALUES ($1, $2, 'published', NOW() - INTERVAL '1 minute')
	`, targets.episodeID, targets.tenantID); err != nil {
		t.Fatalf("publish episode: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO series_creators (series_id, creator_id, role, tenant_id)
		VALUES ($1, $2, 'author', $3)
	`, seriesID, targets.creatorID, targets.tenantID); err != nil {
		t.Fatalf("associate creator: %v", err)
	}
}

func assertPublishedFollow(t *testing.T, ctx context.Context, q *dbmodels.Queries, targets followTargets, wantEpisode, wantCreator, wantSeries bool) {
	t.Helper()
	episode, err := q.UserFollowsPublishedEpisode(ctx, dbmodels.UserFollowsPublishedEpisodeParams{TenantID: targets.tenantID, UserID: targets.userID, EpisodeID: targets.episodeID})
	if err != nil || episode != wantEpisode {
		t.Fatalf("published episode follow = %v, %v; want %v, nil", episode, err, wantEpisode)
	}
	creator, err := q.UserFollowsPublishedCreator(ctx, dbmodels.UserFollowsPublishedCreatorParams{TenantID: targets.tenantID, UserID: targets.userID, CreatorID: targets.creatorID})
	if err != nil || creator != wantCreator {
		t.Fatalf("published creator follow = %v, %v; want %v, nil", creator, err, wantCreator)
	}
	series, err := q.UserFollowsPublishedSeries(ctx, dbmodels.UserFollowsPublishedSeriesParams{TenantID: targets.tenantID, UserID: targets.userID, SeriesID: targets.seriesID})
	if err != nil || series != wantSeries {
		t.Fatalf("published series follow = %v, %v; want %v, nil", series, err, wantSeries)
	}
}

func assertFollowCount(t *testing.T, ctx context.Context, conn *sql.Conn, table string, want int) {
	t.Helper()
	var got int
	if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&got); err != nil || got != want {
		t.Fatalf("%s count = %d, %v; want %d, nil", table, got, err, want)
	}
}

func assertSuperuserFollowCount(t *testing.T, ctx context.Context, db *sql.DB, table string, want int) {
	t.Helper()
	var got int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&got); err != nil || got != want {
		t.Fatalf("%s count = %d, %v; want %d, nil", table, got, err, want)
	}
}
