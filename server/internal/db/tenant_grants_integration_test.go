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

// A tenant is created, given its domains, suspended, and deleted from the
// platform console and by the maintenance role, and deleting its row deletes
// everything it holds. The storefront and the tenant console resolve every
// request to its tenant from this table, so they read every row, but the
// tenant console writes only its own tenant's time zone and languages and the
// storefront only locks its own tenant's row.
func TestTenantsAreReadOnlyToTheTenantScopedRoles(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	own := pg.SeedTenant(t, "tenantown01", "own.example.com", "Own")
	other := pg.SeedTenant(t, "tenantoth01", "other.example.com", "Other")

	for role, conn := range map[string]*sql.DB{
		"publira_public": pg.OpenPublicDB(t),
		"publira_admin":  pg.OpenAdminDB(t),
	} {
		t.Run(role, func(t *testing.T) {
			var count int
			if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM tenants").Scan(&count); err != nil {
				t.Fatalf("read tenants as %s with no tenant set: %v", role, err)
			}
			if count != 2 {
				t.Fatalf("tenants visible to %s with no tenant set = %d, want 2", role, count)
			}
			assertRefused(t, ctx, conn, role,
				"INSERT INTO tenants (id, public_id, domain, name, default_locale, supported_locales) VALUES (gen_random_uuid(), 'tenantnew01', 'new.example.com', 'New', 'en', ARRAY['en'])")
			assertRefused(t, ctx, conn, role, "UPDATE tenants SET status = 'suspended'")
			assertRefused(t, ctx, conn, role, "UPDATE tenants SET domain = 'taken.example.com'")
			assertRefused(t, ctx, conn, role, "UPDATE tenants SET deletion_requested_at = now()")
			assertRefused(t, ctx, conn, role, "DELETE FROM tenants")
		})
	}

	t.Run("publira_admin writes only its own tenant's settings", func(t *testing.T) {
		admin := pg.OpenAdminDB(t)
		for _, target := range []uuid.UUID{own.ID, other.ID} {
			got := rowsAffectedAsTenant(t, ctx, admin, own.ID,
				"UPDATE tenants SET timezone = 'UTC', default_locale = 'en', supported_locales = ARRAY['en'] WHERE id = $1", target)
			want := int64(0)
			if target == own.ID {
				want = 1
			}
			if got != want {
				t.Fatalf("settings rows written for tenant %s from tenant %s = %d, want %d", target, own.ID, got, want)
			}
		}
		if got := rowsAffected(t, ctx, admin, "UPDATE tenants SET timezone = 'UTC'"); got != 0 {
			t.Fatalf("settings rows written with no tenant set = %d, want 0", got)
		}
	})

	t.Run("publira_public locks only its own tenant and writes nothing", func(t *testing.T) {
		public := pg.OpenPublicDB(t)
		assertRefused(t, ctx, public, "publira_public", "UPDATE tenants SET timezone = 'UTC'")
		for _, target := range []uuid.UUID{own.ID, other.ID} {
			got := rowsAffectedAsTenant(t, ctx, public, own.ID, "SELECT id FROM tenants WHERE id = $1 FOR SHARE", target)
			want := int64(0)
			if target == own.ID {
				want = 1
			}
			if got != want {
				t.Fatalf("rows of tenant %s locked from tenant %s = %d, want %d", target, own.ID, got, want)
			}
		}

		tx, err := public.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback() //nolint:errcheck
		if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", own.ID.String()); err != nil {
			t.Fatal(err)
		}
		_, err = tx.ExecContext(ctx, "UPDATE tenants SET id = $1 WHERE id = $2", other.ID, own.ID)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilegeCode {
			t.Fatalf("moving its own tenant's id as publira_public error = %v, want SQLSTATE %s", err, insufficientPrivilegeCode)
		}
	})
}

// rowsAffectedAsTenant runs one statement in a transaction set to tenantID and
// answers how many rows it wrote or returned, rolling the transaction back.
func rowsAffectedAsTenant(t *testing.T, ctx context.Context, conn *sql.DB, tenantID uuid.UUID, statement string, args ...any) int64 {
	t.Helper()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID.String()); err != nil {
		t.Fatal(err)
	}
	result, err := tx.ExecContext(ctx, statement, args...)
	if err != nil {
		t.Fatalf("%q as tenant %s: %v", statement, tenantID, err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// rowsAffected runs one statement with no tenant set and answers how many rows
// it wrote.
func rowsAffected(t *testing.T, ctx context.Context, conn *sql.DB, statement string) int64 {
	t.Helper()
	result, err := conn.ExecContext(ctx, statement)
	if err != nil {
		t.Fatalf("%q: %v", statement, err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		t.Fatal(err)
	}
	return n
}
