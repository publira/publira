package tenanterasure_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformtenants"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/storage/storagetest"
	"github.com/publira/publira/server/internal/tenanterasure"
	"github.com/publira/publira/server/internal/testutil"
)

// keptTenant is the seeded tenant no test here deletes, whose rows have to
// come through every erasure untouched.
const keptTenant = "WhokTNNTAAA1"

// An operator suspends and deletes the development seed's tenant, the one the
// seeds give the most rows, and every scenario tenant is marked beside it, so
// one pass meets every table the seeds fill. Once it has run nothing of them is
// left in any table with a tenant_id column, the bucket holds none of their
// objects, the index and the cache were asked to drop them, and the one tenant
// left alone still has every row it had.
func TestDBRunPendingErasesEveryTenantMarkedForDeletion(t *testing.T) {
	pg := testutil.StartIsolatedPostgres(t)
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	applySeeds(ctx, t, pg.DB)
	var seedDomain string
	if err := pg.DB.QueryRowContext(ctx, `SELECT domain FROM tenants WHERE public_id = 'SeedTNNTAAA1'`).Scan(&seedDomain); err != nil {
		t.Fatalf("read the seed tenant's domain: %v", err)
	}
	operatorID := deleteSeedTenantAsAnOperator(ctx, t, pg)
	markEveryTenantButOne(ctx, t, pg.DB)
	deleted := tenantIDsMarked(ctx, t, pg.DB)
	if len(deleted) < 2 {
		t.Fatalf("marked %d tenants, want the seed tenant and the scenario tenants", len(deleted))
	}
	keptBefore := rowCounts(ctx, t, pg.DB, keptTenantID(ctx, t, pg.DB))

	bucket := storagetest.NewMemory()
	for _, publicID := range append(publicIDsMarked(ctx, t, pg.DB), keptTenant) {
		for _, key := range []string{"tenants/" + publicID + "/series/a.jpg", "data-exports/" + publicID + "/r/b.zip"} {
			if _, err := bucket.Upload(ctx, storage.UploadRequest{ObjectKey: key, Data: []byte("x")}); err != nil {
				t.Fatalf("upload %s: %v", key, err)
			}
		}
	}
	search := &recordingSearch{}
	cache := &recordingCache{}

	summary, err := tenanterasure.RunPending(ctx, tenanterasure.Deps{
		DB:        pg.OpenContentStatsDB(t),
		Images:    bucket,
		Archives:  bucket,
		Search:    search,
		Cache:     cache,
		Logger:    discard(),
		BatchSize: 7,
	})
	if err != nil {
		t.Fatalf("RunPending: %v", err)
	}
	if summary.Erased != len(deleted) || summary.Failed != 0 {
		t.Fatalf("summary = %+v, want %d erased and none failed", summary, len(deleted))
	}

	for table, n := range rowCounts(ctx, t, pg.DB, deleted...) {
		if n != 0 {
			t.Errorf("%s still holds %d rows of the deleted tenants", table, n)
		}
	}
	var tenantsLeft int
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM tenants WHERE id = ANY($1)`, pq.Array(deleted)).Scan(&tenantsLeft); err != nil {
		t.Fatalf("count the deleted tenants: %v", err)
	}
	if tenantsLeft != 0 {
		t.Errorf("%d deleted tenant rows are left", tenantsLeft)
	}
	if _, err := dbmodels.New(pg.OpenPublicDB(t)).GetTenantByDomains(ctx, []string{seedDomain}); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("the seed tenant's domain resolves to %v, want no tenant", err)
	}
	if keptAfter := rowCounts(ctx, t, pg.DB, keptTenantID(ctx, t, pg.DB)); !mapsEqual(keptBefore, keptAfter) {
		t.Errorf("the kept tenant's rows changed:\nbefore %v\nafter  %v", keptBefore, keptAfter)
	}
	if want := []string{"data-exports/" + keptTenant + "/r/b.zip", "tenants/" + keptTenant + "/series/a.jpg"}; !slices.Equal(bucket.Keys(), want) {
		t.Errorf("bucket = %v, want only the kept tenant's objects %v", bucket.Keys(), want)
	}
	if !sameIDs(search.tenants, deleted) {
		t.Errorf("search erased %v, want %v", search.tenants, deleted)
	}
	if !sameIDs(cache.tenants, deleted) {
		t.Errorf("cache erased %v, want %v", cache.tenants, deleted)
	}

	// The deletion of the seed tenant is filed under the operator who asked
	// for it, and every other under the command line, which asked for none:
	// each with what it kept of the tenant, since the row it would be read
	// through is gone.
	var actor uuid.NullUUID
	var role, name, domain, adminDomain string
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT actor_platform_user_id, actor_role, tenant_name, tenant_domain, tenant_admin_domain
		FROM platform_audit_logs
		WHERE action = 'tenant_deleted' AND tenant_public_id = 'SeedTNNTAAA1'
	`).Scan(&actor, &role, &name, &domain, &adminDomain); err != nil {
		t.Fatalf("read the seed tenant's deletion entry: %v", err)
	}
	if !actor.Valid || actor.UUID != operatorID || role != "platform_super_admin" {
		t.Errorf("deletion entry actor = %v %q, want the operator %s who asked", actor, role, operatorID)
	}
	if name != "Seed Tenant" || domain == "" || adminDomain == "" {
		t.Errorf("deletion entry kept name %q, domain %q, console host %q, want all three", name, domain, adminDomain)
	}
	var systemEntries int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(*) FROM platform_audit_logs
		WHERE action = 'tenant_deleted' AND actor_role = $1 AND actor_platform_user_id IS NULL
	`, auditlog.RoleSystem).Scan(&systemEntries); err != nil {
		t.Fatalf("count the command line's deletion entries: %v", err)
	}
	if systemEntries != len(deleted)-1 {
		t.Errorf("%d deletion entries filed under the command line, want %d", systemEntries, len(deleted)-1)
	}

	var notified int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(*) FROM platform_notifications
		WHERE notification_type = $1 AND subject_key = 'tenant:SeedTNNTAAA1' AND platform_user_id = $2
	`, tenanterasure.NotificationTypeTenantDeleted, operatorID).Scan(&notified); err != nil {
		t.Fatalf("count the deletion notifications: %v", err)
	}
	if notified != 1 {
		t.Errorf("the operator was notified %d times of the seed tenant's deletion, want once", notified)
	}
}

// A pass that stops partway — here on a search engine that refuses — leaves
// the tenant marked, with whatever it had erased by then gone, tells the
// operators once however many passes fail, and the next pass finishes the
// erasure from what is left.
func TestDBRunPendingFinishesAnErasureAFailedPassLeftHalfDone(t *testing.T) {
	pg := testutil.StartIsolatedPostgres(t)
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	applySeeds(ctx, t, pg.DB)
	operatorID := deleteSeedTenantAsAnOperator(ctx, t, pg)
	seedID := tenantIDsMarked(ctx, t, pg.DB)

	db := pg.OpenContentStatsDB(t)
	refusing := &recordingSearch{err: errors.New("engine unavailable")}
	for range 2 {
		summary, err := tenanterasure.RunPending(ctx, tenanterasure.Deps{DB: db, Search: refusing, Logger: discard()})
		if err == nil || summary.Failed != 1 {
			t.Fatalf("RunPending with a refusing engine = (%+v, %v), want one failure", summary, err)
		}
	}
	var marked bool
	if err := pg.DB.QueryRowContext(ctx, `SELECT deletion_requested_at IS NOT NULL FROM tenants WHERE public_id = 'SeedTNNTAAA1'`).Scan(&marked); err != nil {
		t.Fatalf("read the seed tenant: %v", err)
	}
	if !marked {
		t.Fatal("the seed tenant is no longer marked after a failed pass")
	}
	for table, n := range rowCounts(ctx, t, pg.DB, seedID...) {
		if n != 0 {
			t.Errorf("%s holds %d rows of the tenant after the failed pass, want them erased before the engine was asked", table, n)
		}
	}
	var failures int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(*) FROM platform_notifications
		WHERE notification_type = $1 AND platform_user_id = $2
	`, tenanterasure.NotificationTypeTenantDeletionFailed, operatorID).Scan(&failures); err != nil {
		t.Fatalf("count the failure notifications: %v", err)
	}
	if failures != 1 {
		t.Errorf("the operator was told of %d failures, want one for the two failed passes", failures)
	}

	summary, err := tenanterasure.RunPending(ctx, tenanterasure.Deps{DB: db, Search: &recordingSearch{}, Logger: discard()})
	if err != nil || summary.Erased != 1 {
		t.Fatalf("RunPending once the engine answers = (%+v, %v), want the tenant erased", summary, err)
	}
	var left int
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM tenants WHERE public_id = 'SeedTNNTAAA1'`).Scan(&left); err != nil {
		t.Fatalf("count the seed tenant: %v", err)
	}
	if left != 0 {
		t.Fatal("the seed tenant row is left after the pass that finished")
	}
}

// Only a tenant an operator asked to delete is erased: a suspended tenant
// stays as it is, and a statement of a kept tenant still refuses a delete.
func TestDBRunPendingLeavesATenantNoOneAskedToDelete(t *testing.T) {
	pg := testutil.StartIsolatedPostgres(t)
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	applySeeds(ctx, t, pg.DB)
	if _, err := pg.DB.ExecContext(ctx, `UPDATE tenants SET status = 'suspended' WHERE public_id = 'RoyaTNNTAAA1'`); err != nil {
		t.Fatalf("suspend the royalty tenant: %v", err)
	}
	royaltyID := tenantID(ctx, t, pg.DB, "RoyaTNNTAAA1")
	before := rowCounts(ctx, t, pg.DB, royaltyID)

	db := pg.OpenContentStatsDB(t)
	summary, err := tenanterasure.RunPending(ctx, tenanterasure.Deps{DB: db, Logger: discard()})
	if err != nil || summary != (tenanterasure.Summary{}) {
		t.Fatalf("RunPending with no tenant marked = (%+v, %v), want nothing done", summary, err)
	}
	if after := rowCounts(ctx, t, pg.DB, royaltyID); !mapsEqual(before, after) {
		t.Errorf("a suspended tenant's rows changed:\nbefore %v\nafter  %v", before, after)
	}
	if before["royalty_statements"] == 0 {
		t.Fatal("the royalty tenant has no statement to check the refusal on")
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM royalty_statements WHERE tenant_id = $1`, royaltyID); err == nil {
		t.Error("a statement of a tenant no one asked to delete was deleted")
	}
	if _, err := db.ExecContext(ctx, `SELECT erase_tenant_audit_logs($1, 10)`, royaltyID); err == nil {
		t.Error("the audit log of a tenant no one asked to delete was erased")
	}
}

// applySeeds loads the development seed and every scenario, as the E2E stack
// does, but for the role definitions and their passwords, which the cluster's
// other databases share and the template has already applied.
func applySeeds(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()
	root := filepath.Join("..", "..", "..", "db", "seeds")
	files := []string{filepath.Join(root, "dev.sql")}
	scenarios, err := filepath.Glob(filepath.Join(root, "scenarios", "*.sql"))
	if err != nil {
		t.Fatalf("list the scenarios: %v", err)
	}
	slices.Sort(scenarios)
	files = append(files, scenarios...)
	for _, file := range files {
		script := testutil.SeedSQL(t, file, map[string]string{"tenant_port": "3080"}, "prod.sql", "dev/000_role_passwords.sql")
		if _, err := db.ExecContext(ctx, script); err != nil {
			t.Fatalf("apply %s: %v", file, err)
		}
	}
}

// deleteSeedTenantAsAnOperator suspends the development seed's tenant and asks
// for its deletion as a Super admin, as the Platform API does, and answers the
// operator.
func deleteSeedTenantAsAnOperator(ctx context.Context, t *testing.T, pg *testutil.PostgresEnv) uuid.UUID {
	t.Helper()
	var operatorID uuid.UUID
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT platform_user_id FROM platform_user_roles WHERE role = 'platform_super_admin' ORDER BY platform_user_id LIMIT 1
	`).Scan(&operatorID); err != nil {
		t.Fatalf("read a super admin: %v", err)
	}
	actor := auditlog.PlatformActor{UserID: operatorID, Role: "platform_super_admin"}
	platform := pg.OpenPlatformDB(t)
	tx, err := platform.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	tenant, err := platformtenants.Find(ctx, dbmodels.New(tx), "SeedTNNTAAA1")
	if err != nil {
		t.Fatalf("find the seed tenant: %v", err)
	}
	if _, err := platformtenants.Suspend(ctx, tx, discard(), actor, tenant.ID); err != nil {
		t.Fatalf("suspend the seed tenant: %v", err)
	}
	if _, err := platformtenants.Delete(ctx, tx, discard(), actor, tenant.ID, tenant.Name); err != nil {
		t.Fatalf("delete the seed tenant: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return operatorID
}

func markEveryTenantButOne(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `
		UPDATE tenants
		SET status = 'suspended', deletion_requested_at = COALESCE(deletion_requested_at, now())
		WHERE public_id <> $1
	`, keptTenant); err != nil {
		t.Fatalf("mark the tenants: %v", err)
	}
}

func tenantIDsMarked(ctx context.Context, t *testing.T, db *sql.DB) []uuid.UUID {
	t.Helper()
	tenants, err := dbmodels.New(db).ListTenantsMarkedForDeletion(ctx)
	if err != nil {
		t.Fatalf("list the marked tenants: %v", err)
	}
	ids := make([]uuid.UUID, len(tenants))
	for i, tenant := range tenants {
		ids[i] = tenant.ID
	}
	return ids
}

func publicIDsMarked(ctx context.Context, t *testing.T, db *sql.DB) []string {
	t.Helper()
	tenants, err := dbmodels.New(db).ListTenantsMarkedForDeletion(ctx)
	if err != nil {
		t.Fatalf("list the marked tenants: %v", err)
	}
	ids := make([]string, len(tenants))
	for i, tenant := range tenants {
		ids[i] = tenant.PublicID
	}
	return ids
}

func keptTenantID(ctx context.Context, t *testing.T, db *sql.DB) uuid.UUID {
	t.Helper()
	return tenantID(ctx, t, db, keptTenant)
}

func tenantID(ctx context.Context, t *testing.T, db *sql.DB, publicID string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := db.QueryRowContext(ctx, `SELECT id FROM tenants WHERE public_id = $1`, publicID).Scan(&id); err != nil {
		t.Fatalf("read tenant %s: %v", publicID, err)
	}
	return id
}

// rowCounts counts, as the superuser and so past every policy, the rows of the
// tenants ids name in each table with a tenant_id column but the platform
// audit log, which keeps the entries of the deletions.
func rowCounts(ctx context.Context, t *testing.T, db *sql.DB, ids ...uuid.UUID) map[string]int64 {
	t.Helper()
	rows, err := db.QueryContext(ctx, `
		SELECT quote_ident(c.relname)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
		WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'platform_audit_logs'
		ORDER BY c.relname
	`)
	if err != nil {
		t.Fatalf("list the tenant tables: %v", err)
	}
	var tables []string
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			t.Fatalf("scan a tenant table: %v", err)
		}
		tables = append(tables, table)
	}
	_ = rows.Close()
	if len(tables) == 0 {
		t.Fatal("found no table with a tenant_id column")
	}
	counts := make(map[string]int64, len(tables))
	for _, table := range tables {
		var n int64
		if err := db.QueryRowContext(ctx, fmt.Sprintf(`SELECT count(*) FROM public.%s WHERE tenant_id = ANY($1)`, table), pq.Array(ids)).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		counts[strings.Trim(table, `"`)] = n
	}
	return counts
}

func mapsEqual(a, b map[string]int64) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func sameIDs(got, want []uuid.UUID) bool {
	a := slices.Clone(got)
	b := slices.Clone(want)
	sort := func(ids []uuid.UUID) {
		slices.SortFunc(ids, func(x, y uuid.UUID) int { return strings.Compare(x.String(), y.String()) })
	}
	sort(a)
	sort(b)
	return slices.Equal(a, b)
}

type recordingSearch struct {
	err     error
	tenants []uuid.UUID
}

func (s *recordingSearch) EraseTenant(_ context.Context, tenantID uuid.UUID) error {
	if s.err != nil {
		return s.err
	}
	s.tenants = append(s.tenants, tenantID)
	return nil
}

type recordingCache struct {
	tenants []uuid.UUID
}

func (c *recordingCache) EraseTenant(_ context.Context, tenant dbmodels.Tenant) (int, error) {
	c.tenants = append(c.tenants, tenant.ID)
	return 0, nil
}

func discard() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
