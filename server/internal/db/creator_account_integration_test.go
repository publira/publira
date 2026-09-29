package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// A link names a creator and an account of one tenant, once per pair, and goes
// with either side when that side is deleted.
func TestCreatorAccountsStayInsideOneTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	other := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Pen Name"})
	secondCreator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Other Pen Name"})
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")
	outsider := pg.SeedEndUser(t, other.ID, "ENDUSERB0001", "reader@tenant-b.example.com", "Outsider")

	link := func(tenantID, creatorID, userID any) error {
		_, err := pg.DB.ExecContext(ctx, `
			INSERT INTO creator_accounts (tenant_id, creator_id, user_id) VALUES ($1, $2, $3)
		`, tenantID, creatorID, userID)
		return err
	}
	count := func() int {
		t.Helper()
		var n int
		if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM creator_accounts`).Scan(&n); err != nil {
			t.Fatalf("count creator accounts: %v", err)
		}
		return n
	}

	if err := link(tenant.ID, creator.ID, outsider.ID); !isForeignKeyViolation(err) {
		t.Fatalf("link an account of another tenant error = %v, want foreign_key_violation (23503)", err)
	}
	if err := link(other.ID, creator.ID, outsider.ID); !isForeignKeyViolation(err) {
		t.Fatalf("link a creator of another tenant error = %v, want foreign_key_violation (23503)", err)
	}

	if err := link(tenant.ID, creator.ID, reader.ID); err != nil {
		t.Fatalf("link: %v", err)
	}
	if err := link(tenant.ID, creator.ID, reader.ID); !isUniqueViolation(err) {
		t.Fatalf("link the same pair twice error = %v, want unique_violation (23505)", err)
	}
	if err := link(tenant.ID, secondCreator.ID, reader.ID); err != nil {
		t.Fatalf("link the account to a second creator: %v", err)
	}
	if got := count(); got != 2 {
		t.Fatalf("links = %d, want 2", got)
	}

	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM creators WHERE id = $1`, secondCreator.ID); err != nil {
		t.Fatalf("delete a linked creator: %v", err)
	}
	if got := count(); got != 1 {
		t.Fatalf("links after deleting a creator = %d, want 1", got)
	}
	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, reader.ID); err != nil {
		t.Fatalf("delete a linked account: %v", err)
	}
	if got := count(); got != 0 {
		t.Fatalf("links after deleting the account = %d, want 0", got)
	}
}
