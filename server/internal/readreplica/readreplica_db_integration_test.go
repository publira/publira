package readreplica_test

import (
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/readreplica"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBAcquire(t *testing.T) {
	pg := testutil.StartReplicatedPostgres(t)
	tenant := pg.SeedTenant(t, "REPLICA1", "replica.example.com", "Replica")

	primary := pg.OpenPublicDB(t)
	replica := pg.OpenStandbyPublicDB(t)
	if err := readreplica.CheckLogin(t.Context(), primary, replica); err != nil {
		t.Fatalf("CheckLogin: %v", err)
	}
	pools := readreplica.Pools{Primary: primary, Replica: replica}

	t.Run("a replica that has caught up answers, bound to the tenant", func(t *testing.T) {
		conn, release := acquireOnReplica(t, pg, pools, tenant.ID)
		defer release()
		if !inRecovery(t, conn) {
			t.Fatal("the connection is not on the standby")
		}
		if got := currentTenant(t, conn); got != tenant.ID.String() {
			t.Fatalf("app.current_tenant_id = %q, want %q", got, tenant.ID)
		}
	})

	t.Run("a replica behind the primary leaves the request to the primary, which has the write", func(t *testing.T) {
		pg.PauseReplay(t)
		const renamed = "Replica renamed"
		if _, err := pg.DB.ExecContext(t.Context(), "UPDATE tenants SET name = $1 WHERE id = $2", renamed, tenant.ID); err != nil {
			t.Fatalf("rename tenant: %v", err)
		}

		started := time.Now()
		conn, release, onReplica, err := pools.Acquire(t.Context(), tenant.ID)
		if err != nil {
			t.Fatalf("Acquire: %v", err)
		}
		defer release()
		if onReplica {
			t.Fatal("onReplica = true while the replica has not replayed the write")
		}
		if elapsed := time.Since(started); elapsed < readreplica.CatchUpWait {
			t.Fatalf("Acquire gave up after %s, before CatchUpWait (%s)", elapsed, readreplica.CatchUpWait)
		}
		if inRecovery(t, conn) {
			t.Fatal("the connection is on the standby")
		}
		var name string
		if err := conn.QueryRowContext(t.Context(), "SELECT name FROM tenants WHERE id = $1", tenant.ID).Scan(&name); err != nil {
			t.Fatalf("read tenant: %v", err)
		}
		if name != renamed {
			t.Fatalf("name = %q, want %q", name, renamed)
		}
	})

	t.Run("a replica answers again once it has replayed the write", func(t *testing.T) {
		pg.ResumeReplay(t)
		_, release := acquireOnReplica(t, pg, pools, tenant.ID)
		release()
	})

	t.Run("a server that is not a standby is not answered on", func(t *testing.T) {
		notStandby := readreplica.Pools{Primary: primary, Replica: pg.OpenPublicDB(t)}
		started := time.Now()
		_, release, onReplica, err := notStandby.Acquire(t.Context(), tenant.ID)
		if err != nil {
			t.Fatalf("Acquire: %v", err)
		}
		release()
		if onReplica {
			t.Fatal("onReplica = true on a server that is not in recovery")
		}
		if elapsed := time.Since(started); elapsed >= readreplica.CatchUpWait {
			t.Fatalf("Acquire waited %s for a server that will never replay anything", elapsed)
		}
	})

	t.Run("no replica keeps every read on the primary", func(t *testing.T) {
		primaryOnly := readreplica.Pools{Primary: primary}
		conn, release, onReplica, err := primaryOnly.Acquire(t.Context(), tenant.ID)
		if err != nil {
			t.Fatalf("Acquire: %v", err)
		}
		defer release()
		if onReplica || inRecovery(t, conn) {
			t.Fatal("a request without a replica was answered on the standby")
		}
	})

	t.Run("a replica signed in as another login is refused", func(t *testing.T) {
		admin, err := sql.Open("pgx", strings.Replace(pg.StandbyPublicURL, "publira_public:publicpass", "publira_admin:adminpass", 1))
		if err != nil {
			t.Fatalf("open: %v", err)
		}
		t.Cleanup(func() { _ = admin.Close() })
		err = readreplica.CheckLogin(t.Context(), primary, admin)
		if err == nil || !strings.Contains(err.Error(), "publira_admin") {
			t.Fatalf("CheckLogin err = %v, want a refusal naming publira_admin", err)
		}
	})
}

// acquireOnReplica acquires until the replica answers, waiting for it to
// replay everything before each attempt. It may still fall behind between the
// wait and the acquire for longer than CatchUpWait on a busy machine, which is
// the primary answering correctly rather than a failure, so the test fails only
// when the replica never answers.
func acquireOnReplica(t *testing.T, pg *testutil.ReplicatedPostgres, pools readreplica.Pools, tenantID uuid.UUID) (*sql.Conn, func()) {
	t.Helper()
	for range 20 {
		pg.WaitForReplay(t)
		conn, release, onReplica, err := pools.Acquire(t.Context(), tenantID)
		if err != nil {
			t.Fatalf("Acquire: %v", err)
		}
		if onReplica {
			return conn, release
		}
		release()
	}
	t.Fatal("the replica never answered after replaying everything")
	return nil, nil
}

func inRecovery(t *testing.T, conn *sql.Conn) bool {
	t.Helper()
	var recovering bool
	if err := conn.QueryRowContext(t.Context(), "SELECT pg_is_in_recovery()").Scan(&recovering); err != nil {
		t.Fatalf("pg_is_in_recovery: %v", err)
	}
	return recovering
}

func currentTenant(t *testing.T, conn *sql.Conn) string {
	t.Helper()
	var id string
	if err := conn.QueryRowContext(t.Context(), "SELECT current_setting('app.current_tenant_id', true)").Scan(&id); err != nil {
		t.Fatalf("current_setting: %v", err)
	}
	if _, err := uuid.Parse(id); err != nil {
		t.Fatalf("app.current_tenant_id %q is not a UUID: %v", id, err)
	}
	return id
}
