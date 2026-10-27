package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// previousReleaseDeleteUnreferencedTenantImages is DeleteUnreferencedTenantImages
// as v0.5.0 ships it, which knows the theme's slots and no brand mark. Its
// worker runs it for as long as an upgrade leaves that worker running, and
// again after one is rolled back.
const previousReleaseDeleteUnreferencedTenantImages = `
DELETE FROM tenant_images ti
WHERE ti.created_at < $1
    AND NOT EXISTS (
        SELECT 1 FROM tenant_themes t
        WHERE t.icon_image_id = ti.id
            OR t.logo_image_id = ti.id
            OR t.sign_in_image_id = ti.id
    )`

// The previous release's sweep deletes the images nothing in the theme points
// at and leaves a brand mark's, before `db roles` has granted the maintenance
// role the new table as well as after.
func TestPreviousReleaseSweepLeavesBrandMarkImages(t *testing.T) {
	pg := testutil.StartIsolatedPostgres(t)
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")
	seedImage := func() uuid.UUID {
		t.Helper()
		id := uuid.Must(uuid.NewV7())
		if _, err := pg.DB.ExecContext(ctx, "INSERT INTO tenant_images (id, tenant_id) VALUES ($1, $2)", id, tenant.ID); err != nil {
			t.Fatalf("seed tenant image: %v", err)
		}
		return id
	}
	markImageID := seedImage()
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_brand_marks (tenant_id, kind, image_id, terms_url, terms_accepted_at)
		VALUES ($1, 'app_store_badge', $2, 'https://example.com/guidelines', NOW())
	`, tenant.ID, markImageID); err != nil {
		t.Fatalf("seed brand mark: %v", err)
	}

	sweep := func(name string, conn *sql.DB) {
		t.Helper()
		orphanID := seedImage()
		if _, err := conn.ExecContext(ctx, previousReleaseDeleteUnreferencedTenantImages, time.Now().Add(time.Hour)); err != nil {
			t.Fatalf("%s: previous release's sweep: %v", name, err)
		}
		if tenantImageExists(t, ctx, pg.DB, orphanID) {
			t.Fatalf("%s: the image nothing points at survived the sweep", name)
		}
		if !tenantImageExists(t, ctx, pg.DB, markImageID) {
			t.Fatalf("%s: the sweep deleted the image the brand mark shows", name)
		}
	}

	contentStats := pg.OpenContentStatsDB(t)
	sweep("granted", contentStats)

	if _, err := pg.DB.ExecContext(ctx, "REVOKE ALL ON tenant_brand_marks FROM publira_content_stats"); err != nil {
		t.Fatalf("revoke the grant db roles makes: %v", err)
	}
	sweep("before db roles", contentStats)
}

// The console deletes a mark's row before its image, and a tenant's deletion
// reaches both through foreign keys, so the policy stops neither.
func TestBrandMarkImagePolicyLetsTheConsoleAndTenantDeletionThrough(t *testing.T) {
	pg := testutil.StartIsolatedPostgres(t)
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")
	seedMark := func(kind string) uuid.UUID {
		t.Helper()
		id := uuid.Must(uuid.NewV7())
		if _, err := pg.DB.ExecContext(ctx, "INSERT INTO tenant_images (id, tenant_id) VALUES ($1, $2)", id, tenant.ID); err != nil {
			t.Fatalf("seed tenant image: %v", err)
		}
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO tenant_brand_marks (tenant_id, kind, image_id, terms_url, terms_accepted_at)
			VALUES ($1, $2, $3, 'https://example.com/guidelines', NOW())
		`, tenant.ID, kind, id); err != nil {
			t.Fatalf("seed brand mark: %v", err)
		}
		return id
	}
	deletedImageID := seedMark("x_share")
	keptImageID := seedMark("line_share")

	admin := pg.OpenAdminDB(t)
	conn, err := admin.Conn(ctx)
	if err != nil {
		t.Fatalf("open admin connection: %v", err)
	}
	defer conn.Close() //nolint:errcheck
	if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenant.ID.String()); err != nil {
		t.Fatalf("scope the connection to the tenant: %v", err)
	}
	if _, err := conn.ExecContext(ctx, "DELETE FROM tenant_images WHERE id = $1", keptImageID); err != nil {
		t.Fatalf("delete a shown image as publira_admin: %v", err)
	}
	if !tenantImageExists(t, ctx, pg.DB, keptImageID) {
		t.Fatal("publira_admin deleted the image a brand mark still shows")
	}
	if _, err := conn.ExecContext(ctx, "DELETE FROM tenant_brand_marks WHERE tenant_id = $1 AND kind = 'x_share'", tenant.ID); err != nil {
		t.Fatalf("delete the brand mark as publira_admin: %v", err)
	}
	if _, err := conn.ExecContext(ctx, "DELETE FROM tenant_images WHERE id = $1", deletedImageID); err != nil {
		t.Fatalf("delete the mark's image as publira_admin: %v", err)
	}
	if tenantImageExists(t, ctx, pg.DB, deletedImageID) {
		t.Fatal("the image of a deleted brand mark survived the console's delete")
	}

	if _, err := pg.OpenPlatformDB(t).ExecContext(ctx, "DELETE FROM tenants WHERE id = $1", tenant.ID); err != nil {
		t.Fatalf("delete the tenant as publira_platform: %v", err)
	}
	if tenantImageExists(t, ctx, pg.DB, keptImageID) {
		t.Fatal("the tenant's deletion left a brand mark's image behind")
	}
}

func tenantImageExists(t *testing.T, ctx context.Context, db *sql.DB, id uuid.UUID) bool {
	t.Helper()
	var exists bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM tenant_images WHERE id = $1)", id).Scan(&exists); err != nil {
		t.Fatalf("read tenant image %s: %v", id, err)
	}
	return exists
}
