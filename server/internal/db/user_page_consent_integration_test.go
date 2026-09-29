package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// A consent row is the record of what a reader agreed to, so the version it
// names cannot be deleted out from under it. Deleting the reader or the whole
// tenant takes the record with it.
func TestUserPageConsentsKeepTheAgreedVersion(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")
	leaving := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "leaving@tenant-a.example.com", "Leaving")
	terms := pg.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	for _, userID := range []any{reader.ID, leaving.ID} {
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO user_page_consents (tenant_id, user_id, page_version_id) VALUES ($1, $2, $3)
		`, tenant.ID, userID, terms.VersionID); err != nil {
			t.Fatalf("record consent: %v", err)
		}
	}

	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM pages WHERE id = $1`, terms.ID); !isForeignKeyViolation(err) {
		t.Fatalf("delete an agreed page error = %v, want foreign_key_violation (23503)", err)
	}

	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, leaving.ID); err != nil {
		t.Fatalf("delete a reader who agreed: %v", err)
	}
	var remaining int
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM user_page_consents`).Scan(&remaining); err != nil {
		t.Fatalf("count consents: %v", err)
	}
	if remaining != 1 {
		t.Fatalf("consents after deleting one reader = %d, want 1", remaining)
	}

	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM tenants WHERE id = $1`, tenant.ID); err != nil {
		t.Fatalf("delete the tenant: %v", err)
	}
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM user_page_consents`).Scan(&remaining); err != nil {
		t.Fatalf("count consents: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("consents after deleting the tenant = %d, want 0", remaining)
	}
}
