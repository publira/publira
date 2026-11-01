package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/testutil"
)

// raiseExceptionCode is the SQLSTATE of a plain RAISE EXCEPTION, which is what
// a trigger function's guard raises.
const raiseExceptionCode = "P0001"

// securityDefinerFunctions reads every SECURITY DEFINER function in public out
// of the catalog, so a function a later migration adds is held to the same
// rules without a list here to update. triggersOnly narrows it to the trigger
// functions.
func securityDefinerFunctions(t *testing.T, ctx context.Context, db *sql.DB, triggersOnly bool) []string {
	t.Helper()
	rows, err := db.QueryContext(ctx, `
		SELECT p.oid::regprocedure::text
		FROM pg_proc p
			JOIN pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname = 'public'
			AND p.prosecdef
			AND (NOT $1 OR p.prorettype = 'trigger'::regtype)
		ORDER BY 1
	`, triggersOnly)
	if err != nil {
		t.Fatalf("list the SECURITY DEFINER functions: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var functions []string
	for rows.Next() {
		var function string
		if err := rows.Scan(&function); err != nil {
			t.Fatalf("scan a SECURITY DEFINER function: %v", err)
		}
		functions = append(functions, function)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list the SECURITY DEFINER functions: %v", err)
	}
	if len(functions) == 0 {
		t.Fatal("found no SECURITY DEFINER function, want the catalog query to find the ones the migrations create")
	}
	return functions
}

// A SECURITY DEFINER function runs as the schema's owner, so each one keeps a
// temporary table from standing in for the tables it touches, and is closed to
// a role it was not granted to.
func TestSecurityDefinerFunctionsPinTheirSearchPathAndRefusePublic(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for _, function := range securityDefinerFunctions(t, ctx, pg.DB, false) {
		var searchPath sql.NullString
		var publicExecutes bool
		mustQueryRow(t, ctx, pg.DB, `
			SELECT (
				SELECT substr(setting, length('search_path=') + 1)
				FROM unnest(p.proconfig) setting
				WHERE setting LIKE 'search_path=%'
			)
			FROM pg_proc p
			WHERE p.oid = $1::regprocedure
		`, &searchPath, function)
		mustQueryRow(t, ctx, pg.DB, `SELECT has_function_privilege('public', $1::regprocedure, 'EXECUTE')`, &publicExecutes, function)

		if searchPath.String != "pg_catalog, public, pg_temp" {
			t.Errorf("%s: search_path = %q, want pg_catalog, public, pg_temp", function, searchPath.String)
		}
		if publicExecutes {
			t.Errorf("%s: PUBLIC may execute it, want EXECUTE revoked from PUBLIC in the baseline seed", function)
		}
	}
}

// A role that could attach one of these trigger functions to a table of its
// own would fire it as the owner on rows it made up.
func TestNoAppRoleCanAttachASecurityDefinerTriggerFunction(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	functions := securityDefinerFunctions(t, ctx, pg.DB, true)
	for _, role := range []struct {
		name string
		open func(*testing.T) *sql.DB
	}{
		{name: "publira_platform", open: pg.OpenPlatformDB},
		{name: "publira_admin", open: pg.OpenAdminDB},
		{name: "publira_public", open: pg.OpenPublicDB},
		{name: "publira_content_stats", open: pg.OpenContentStatsDB},
		{name: "publira_outbox", open: pg.OpenOutboxDB},
		{name: "publira_ticker", open: pg.OpenTickerDB},
	} {
		t.Run(role.name, func(t *testing.T) {
			conn, err := role.open(t).Conn(ctx)
			if err != nil {
				t.Fatalf("open %s connection: %v", role.name, err)
			}
			defer conn.Close() //nolint:errcheck
			if _, err := conn.ExecContext(ctx, "CREATE TEMP TABLE forged (x int)"); err != nil {
				t.Fatalf("create a temporary table as %s: %v", role.name, err)
			}
			for _, function := range functions {
				_, err := conn.ExecContext(ctx, "CREATE TRIGGER forge AFTER INSERT ON forged FOR EACH ROW EXECUTE FUNCTION "+function)
				var pgErr *pgconn.PgError
				if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilegeCode {
					t.Errorf("attach %s as %s: error = %v, want SQLSTATE %s", function, role.name, err, insufficientPrivilegeCode)
				}
			}
		})
	}
}

// A role that can execute a trigger function, such as the owner, still cannot
// make it run for a table other than the one its trigger is on.
func TestSecurityDefinerTriggerFunctionsRefuseAnotherTable(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, err := pg.DB.Conn(ctx)
	if err != nil {
		t.Fatalf("open owner connection: %v", err)
	}
	defer conn.Close() //nolint:errcheck
	for _, function := range securityDefinerFunctions(t, ctx, pg.DB, true) {
		for _, statement := range []string{
			"CREATE TEMP TABLE forged (x int)",
			"CREATE TRIGGER forge AFTER INSERT ON forged FOR EACH ROW EXECUTE FUNCTION " + function,
		} {
			if _, err := conn.ExecContext(ctx, statement); err != nil {
				t.Fatalf("%q as the owner: %v", statement, err)
			}
		}
		_, err := conn.ExecContext(ctx, "INSERT INTO forged VALUES (1)")
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != raiseExceptionCode {
			t.Errorf("fire %s for a temporary table: error = %v, want its guard to raise SQLSTATE %s", function, err, raiseExceptionCode)
		}
		if _, err := conn.ExecContext(ctx, "DROP TABLE forged"); err != nil {
			t.Fatalf("drop the temporary table: %v", err)
		}
	}
}

// scopedConn opens a connection scoped to a tenant and, when userID is set, to
// one of its members, the way a request is.
func scopedConn(t *testing.T, ctx context.Context, db *sql.DB, tenantID, userID uuid.UUID) *sql.Conn {
	t.Helper()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("open connection: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	settings := map[string]string{"app.current_tenant_id": tenantID.String()}
	if userID != uuid.Nil {
		settings["app.current_user_id"] = userID.String()
	}
	for setting, value := range settings {
		if _, err := conn.ExecContext(ctx, "SELECT set_config($1, $2, false)", setting, value); err != nil {
			t.Fatalf("set %s: %v", setting, err)
		}
	}
	return conn
}

// shadow creates, on conn's own session, a temporary table shaped like each
// named table, which a body that left pg_temp first would resolve to.
func shadow(t *testing.T, ctx context.Context, conn *sql.Conn, tables ...string) {
	t.Helper()
	for _, table := range tables {
		if _, err := conn.ExecContext(ctx, "CREATE TEMP TABLE "+table+" (LIKE public."+table+" INCLUDING ALL)"); err != nil {
			t.Fatalf("create a temporary %s: %v", table, err)
		}
	}
}

// assertShadowsUntouched fails when a temporary table shadow created took a row.
func assertShadowsUntouched(t *testing.T, ctx context.Context, conn *sql.Conn, tables ...string) {
	t.Helper()
	for _, table := range tables {
		var rows int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM pg_temp."+table).Scan(&rows); err != nil {
			t.Fatalf("read the temporary %s: %v", table, err)
		}
		if rows != 0 {
			t.Errorf("the temporary %s took %d rows, want the write to reach public.%s", table, rows, table)
		}
	}
}

// Every role may create temporary tables, and one named like a table a
// SECURITY DEFINER function touches must not take its place: the write would
// miss the real table, and the temporary table's own triggers would run as the
// owner.
func TestATemporaryTableDoesNotStandInForWhatASecurityDefinerFunctionTouches(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "SDFTENANT001", "definer.example.com", "admin-definer.example.com", "Definer")
	readerID := mustInsertUser(t, ctx, pg.DB, tenantID, "SDFREADER001", "reader@definer.example.com", "Reader")
	episodeID := mustInsertEpisode(t, ctx, pg.DB, tenantID, "ESDFEPISODE1", "Episode")
	var seriesID uuid.UUID
	mustQueryRow(t, ctx, pg.DB, "SELECT series_id FROM episodes WHERE id = $1", &seriesID, episodeID)

	t.Run("rating tallies", func(t *testing.T) {
		tallies := []string{"episode_rating_counts", "series_rating_counts"}
		conn := scopedConn(t, ctx, pg.OpenPublicDB(t), tenantID, readerID)
		shadow(t, ctx, conn, tallies...)
		if _, err := conn.ExecContext(ctx, `
			INSERT INTO public.episode_ratings (tenant_id, user_id, episode_id, score)
			VALUES ($1, $2, $3, 5)
		`, tenantID, readerID, episodeID); err != nil {
			t.Fatalf("rate an episode as publira_public: %v", err)
		}
		assertShadowsUntouched(t, ctx, conn, tallies...)
		if got := ratingCount(t, ctx, pg.DB, tenantID, episodeID); got != 1 {
			t.Errorf("episode rating count = %d, want 1", got)
		}
		if got := seriesRatingCount(t, ctx, pg.DB, tenantID, seriesID); got != 1 {
			t.Errorf("series rating count = %d, want 1", got)
		}
	})

	t.Run("follower tally and its changes", func(t *testing.T) {
		tables := []string{"series_follower_counts", "series_follow_changes", "series"}
		conn := scopedConn(t, ctx, pg.OpenPublicDB(t), tenantID, readerID)
		shadow(t, ctx, conn, tables...)
		if _, err := conn.ExecContext(ctx, `
			INSERT INTO public.series_follows (tenant_id, user_id, series_id)
			VALUES ($1, $2, $3)
		`, tenantID, readerID, seriesID); err != nil {
			t.Fatalf("follow a series as publira_public: %v", err)
		}
		if _, err := conn.ExecContext(ctx, `
			DELETE FROM public.series_follows
			WHERE tenant_id = $1 AND user_id = $2 AND series_id = $3
		`, tenantID, readerID, seriesID); err != nil {
			t.Fatalf("unfollow a series as publira_public: %v", err)
		}
		assertShadowsUntouched(t, ctx, conn, tables...)
		if got := seriesFollowerCount(t, ctx, pg.DB, tenantID, seriesID); got != 0 {
			t.Errorf("series follower count = %d, want 0", got)
		}
		assertFollowChanges(t, "series follow changes", seriesFollowChanges(t, ctx, pg.DB, tenantID, seriesID), 1, -1)
	})

	t.Run("creator follower tally", func(t *testing.T) {
		creatorID := mustInsertFollowCreator(t, ctx, pg.DB, tenantID, "SDFCREATOR01")
		tables := []string{"creator_follower_counts"}
		conn := scopedConn(t, ctx, pg.OpenPublicDB(t), tenantID, readerID)
		shadow(t, ctx, conn, tables...)
		if _, err := conn.ExecContext(ctx, `
			INSERT INTO public.creator_follows (tenant_id, user_id, creator_id)
			VALUES ($1, $2, $3)
		`, tenantID, readerID, creatorID); err != nil {
			t.Fatalf("follow a creator as publira_public: %v", err)
		}
		assertShadowsUntouched(t, ctx, conn, tables...)
		if got := creatorFollowerCount(t, ctx, pg.DB, tenantID, creatorID); got != 1 {
			t.Errorf("creator follower count = %d, want 1", got)
		}
	})

	// Runs last: it deletes the episode the other cases rate.
	t.Run("ratings of a deleted episode", func(t *testing.T) {
		conn := scopedConn(t, ctx, pg.OpenAdminDB(t), tenantID, uuid.Nil)
		shadow(t, ctx, conn, "episode_ratings")
		if _, err := conn.ExecContext(ctx, "DELETE FROM public.episodes WHERE id = $1", episodeID); err != nil {
			t.Fatalf("delete an episode as publira_admin: %v", err)
		}
		// Had the ratings gone by the foreign key's cascade instead, the
		// episode would be gone before the series tally looked it up, and the
		// reader would still be counted.
		if got := seriesRatingCount(t, ctx, pg.DB, tenantID, seriesID); got != 0 {
			t.Errorf("series rating count after the episode was deleted = %d, want 0", got)
		}
	})

	t.Run("brand mark image policy", func(t *testing.T) {
		imageID := uuid.Must(uuid.NewV7())
		mustExec(t, ctx, pg.DB, "INSERT INTO tenant_images (id, tenant_id) VALUES ($1, $2)", imageID, tenantID)
		mustExec(t, ctx, pg.DB, `
			INSERT INTO tenant_brand_marks (tenant_id, kind, image_id, terms_url, terms_accepted_at)
			VALUES ($1, 'x_share', $2, 'https://example.com/guidelines', NOW())
		`, tenantID, imageID)

		conn := scopedConn(t, ctx, pg.OpenAdminDB(t), tenantID, uuid.Nil)
		shadow(t, ctx, conn, "tenant_brand_marks")
		if _, err := conn.ExecContext(ctx, "DELETE FROM public.tenant_images WHERE id = $1", imageID); err != nil {
			t.Fatalf("delete a shown image as publira_admin: %v", err)
		}
		if !tenantImageExists(t, ctx, pg.DB, imageID) {
			t.Error("an empty temporary tenant_brand_marks let the image a brand mark shows be deleted")
		}
	})
}
