package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
)

// insufficientPrivilege is the SQLSTATE PostgreSQL raises when a row would break
// a row-level security policy.
const insufficientPrivilege = "42501"

// These tests bypass the handlers and talk to PostgreSQL as publira_admin
// directly. The RPC-level cases prove the handlers filter by tenant; these prove
// the database refuses to hand over another tenant's rows even when a query
// forgets to, which is the guarantee the admin API leans on.

// seedSeriesOwnedBy inserts a series straight into the database (superuser, no
// RLS) so the row exists for a tenant nobody in the test is signed in as.
func seedSeriesOwnedBy(t *testing.T, env *adminDBEnv, tenantID uuid.UUID, publicID, title string) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	seriesID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO series (id, tenant_id, public_id, title)
		VALUES ($1, $2, $3, $4)
	`, seriesID, tenantID, publicID, title); err != nil {
		t.Fatalf("insert series %s: %v", publicID, err)
	}
	return seriesID
}

func TestDBRLSHidesRowsOfAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	mine := seedSeriesOwnedBy(t, env, first.Tenant.ID, "SERIESA0001", "Tenant A Series")
	theirs := seedSeriesOwnedBy(t, env, second.Tenant.ID, "SERIESB0001", "Tenant B Series")

	env.withTenantConn(t, first.Tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM series").Scan(&visible); err != nil {
			t.Fatalf("count series: %v", err)
		}
		if visible != 1 {
			t.Fatalf("visible series = %d, want only the one owned by tenant A", visible)
		}

		var title string
		err := conn.QueryRowContext(ctx, "SELECT title FROM series WHERE id = $1", theirs).Scan(&title)
		if err == nil {
			t.Fatalf("read tenant B series as tenant A: got %q, want no rows", title)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("read tenant B series error = %v, want sql.ErrNoRows", err)
		}

		if err := conn.QueryRowContext(ctx, "SELECT title FROM series WHERE id = $1", mine).Scan(&title); err != nil {
			t.Fatalf("read own series: %v", err)
		}
		if title != "Tenant A Series" {
			t.Fatalf("own series title = %q, want Tenant A Series", title)
		}
	})
}

func TestDBRLSRefusesWritesToAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	theirs := seedSeriesOwnedBy(t, env, second.Tenant.ID, "SERIESB0001", "Tenant B Series")

	env.withTenantConn(t, first.Tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		// An UPDATE / DELETE that forgets its tenant predicate must not silently
		// reach across: the policy hides the row, so nothing matches.
		updated, err := conn.ExecContext(ctx, "UPDATE series SET title = 'Hijacked' WHERE id = $1", theirs)
		if err != nil {
			t.Fatalf("update tenant B series: %v", err)
		}
		if affected, _ := updated.RowsAffected(); affected != 0 {
			t.Fatalf("update affected %d rows, want 0", affected)
		}

		deleted, err := conn.ExecContext(ctx, "DELETE FROM series WHERE id = $1", theirs)
		if err != nil {
			t.Fatalf("delete tenant B series: %v", err)
		}
		if affected, _ := deleted.RowsAffected(); affected != 0 {
			t.Fatalf("delete affected %d rows, want 0", affected)
		}

		// Writing a row stamped with someone else's tenant is rejected outright
		// by the policy's WITH CHECK clause.
		_, err = conn.ExecContext(ctx, `
			INSERT INTO series (id, tenant_id, public_id, title)
			VALUES ($1, $2, $3, $4)
		`, uuid.Must(uuid.NewV7()), second.Tenant.ID, "SERIESB0002", "Planted Series")
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilege {
			t.Fatalf("insert for another tenant error = %v, want SQLSTATE %s", err, insufficientPrivilege)
		}
	})

	if count := env.countRows(t, "SELECT count(*) FROM series WHERE title = $1", "Tenant B Series"); count != 1 {
		t.Fatalf("tenant B series survived = %d, want 1", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series WHERE public_id = $1", "SERIESB0002"); count != 0 {
		t.Fatalf("planted series rows = %d, want 0", count)
	}
}

// TestDBRLSHidesEverythingWithoutTenantSetting pins the fail-closed direction:
// a connection that never set app.current_tenant_id sees nothing, so a code path
// that skips the tenant-scoping interceptor cannot leak data across tenants.
func TestDBRLSHidesEverythingWithoutTenantSetting(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	seedSeriesOwnedBy(t, env, first.Tenant.ID, "SERIESA0001", "Tenant A Series")
	seedSeriesOwnedBy(t, env, second.Tenant.ID, "SERIESB0001", "Tenant B Series")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := env.PG.OpenAdminDB(t)
	var visible int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM series").Scan(&visible); err != nil {
		t.Fatalf("count series: %v", err)
	}
	if visible != 0 {
		t.Fatalf("series visible without a tenant setting = %d, want 0", visible)
	}
}

// TestDBRLSAppliesToHandlerConnections is the same guarantee seen from the RPC
// side: a series only the database knows about shows up for its owner and for
// nobody else, without the test having created it through the API.
func TestDBRLSAppliesToHandlerConnections(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	seedSeriesOwnedBy(t, env, second.Tenant.ID, "SERIESB0001", "Tenant B Series")
	client := env.seriesClient()

	theirs, err := client.ListSeries(context.Background(), newAdminDBRequest(second, &publiraadminv1.ListSeriesRequest{
		Tenant: second.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListSeries for tenant B: %v", err)
	}
	if len(theirs.Msg.Series) != 1 {
		t.Fatalf("tenant B series count = %d, want 1", len(theirs.Msg.Series))
	}

	mine, err := client.ListSeries(context.Background(), newAdminDBRequest(first, &publiraadminv1.ListSeriesRequest{
		Tenant: first.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListSeries for tenant A: %v", err)
	}
	if len(mine.Msg.Series) != 0 {
		t.Fatalf("tenant A series count = %d, want 0", len(mine.Msg.Series))
	}
}
