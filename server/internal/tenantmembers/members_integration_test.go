package tenantmembers

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/testutil"
)

// Two administrators demoting each other at the same moment would each see the
// other one left. The second has to wait for the first and then be refused.
func TestUpdateRoleKeepsAnAdminWhenTwoAdminsDemoteEachOther(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	first := pg.SeedTenantAdmin(t, tenant.ID, "TAFIRST", "first@tenant-a.example.com", "First")
	second := pg.SeedTenantAdmin(t, tenant.ID, "TASECOND", "second@tenant-a.example.com", "Second")

	firstTx, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer firstTx.Rollback() //nolint:errcheck
	if _, err := UpdateRole(ctx, firstTx, UpdateRoleParams{
		TenantID: tenant.ID, UserPublicID: second.PublicID, Role: auth.RoleTenantEditor, KeepAnAdmin: true,
	}); err != nil {
		t.Fatalf("first admin demotes the second: %v", err)
	}

	secondResult := make(chan error, 1)
	go func() {
		tx, err := pg.DB.BeginTx(ctx, nil)
		if err != nil {
			secondResult <- err
			return
		}
		defer tx.Rollback() //nolint:errcheck
		_, err = UpdateRole(ctx, tx, UpdateRoleParams{
			TenantID: tenant.ID, UserPublicID: first.PublicID, Role: auth.RoleTenantEditor, KeepAnAdmin: true,
		})
		if err == nil {
			err = tx.Commit()
		}
		secondResult <- err
	}()

	waitForAdvisoryLockWaiter(t, pg)
	if err := firstTx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	select {
	case err := <-secondResult:
		if !errors.Is(err, ErrLastAdmin) {
			t.Fatalf("second admin demotes the first: err = %v, want ErrLastAdmin", err)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("the second demotion never finished")
	}
}

func waitForAdvisoryLockWaiter(t *testing.T, pg *testutil.PostgresEnv) {
	t.Helper()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var waiting int
		if err := pg.DB.QueryRowContext(context.Background(),
			"SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
		).Scan(&waiting); err != nil {
			t.Fatalf("read pg_locks: %v", err)
		}
		if waiting > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the second demotion never waited for the administrator lock")
}
