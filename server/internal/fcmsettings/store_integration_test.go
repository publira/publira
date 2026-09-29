package fcmsettings_test

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fcmsettings"
	"github.com/publira/publira/server/internal/push"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	insufficientPrivilege = "42501"
	checkViolation        = "23514"
)

func integrationEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return mgr
}

// withAdminTenant runs fn on a publira_admin connection scoped to tenantID,
// which is how the admin API reaches the table.
func withAdminTenant(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, fn func(ctx context.Context, conn *sql.Conn)) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pg.OpenAdminDB(t).Conn(ctx)
	if err != nil {
		t.Fatalf("admin conn: %v", err)
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenantID.String()); err != nil {
		t.Fatalf("set app.current_tenant_id: %v", err)
	}
	fn(ctx, conn)
}

func sqlState(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

type builtClient struct {
	projectID string
	keyJSON   string
}

func (c *builtClient) Send(context.Context, push.Message) error { return nil }

// Each tenant administrator saves their own tenant's key through the admin
// role; the worker's role then sends each tenant's push with that tenant's key,
// and stops once one of them removes it.
func TestTenantsSaveAndSendWithTheirOwnCredentials(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenantA := pg.SeedTenant(t, "FCMTNT00000A", "fcm-a.example.com", "FCM Tenant A")
	tenantB := pg.SeedTenant(t, "FCMTNT00000B", "fcm-b.example.com", "FCM Tenant B")
	actorA := pg.SeedTenantAdmin(t, tenantA.ID, "FCMADMA00001", "fcm-a@example.com", "FCM Admin A")
	actorB := pg.SeedTenantAdmin(t, tenantB.ID, "FCMADMB00001", "fcm-b@example.com", "FCM Admin B")
	encryptor := integrationEncryptor(t)

	keys := map[uuid.UUID]string{}
	for _, tenant := range []struct {
		id        uuid.UUID
		publicID  string
		projectID string
		actor     uuid.UUID
	}{
		{id: tenantA.ID, publicID: tenantA.PublicID, projectID: "fcm-tenant-a", actor: actorA.ID},
		{id: tenantB.ID, publicID: tenantB.PublicID, projectID: "fcm-tenant-b", actor: actorB.ID},
	} {
		keyJSON := testutil.ServiceAccountJSON(t, tenant.projectID, "push@"+tenant.projectID+".iam.gserviceaccount.com")
		keys[tenant.id] = keyJSON
		withAdminTenant(t, pg, tenant.id, func(ctx context.Context, conn *sql.Conn) {
			store := fcmsettings.New(dbmodels.New(conn), encryptor, auditlog.New(dbmodels.New(conn), nil))
			if _, err := store.Save(ctx, tenant.id, tenant.projectID, keyJSON, fcmsettings.AuditMeta{
				ActorUserID: tenant.actor,
				ActorRole:   auth.RoleTenantAdmin,
				TargetID:    tenant.publicID,
			}); err != nil {
				t.Fatalf("Save: %v", err)
			}
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Neither the row nor the audit trail holds the key in the clear.
	rows, err := pg.DB.QueryContext(ctx, `
		SELECT f.service_account_json_encrypted, a.action, a.target_type, coalesce(a.reason, '')
		FROM tenant_fcm_config f
		JOIN audit_logs a ON a.tenant_id = f.tenant_id
	`)
	if err != nil {
		t.Fatalf("read the stored rows: %v", err)
	}
	seen := 0
	for rows.Next() {
		var sealed, action, targetType, reason string
		if err := rows.Scan(&sealed, &action, &targetType, &reason); err != nil {
			t.Fatalf("scan: %v", err)
		}
		seen++
		if !secretcrypto.IsEncryptedEnvelope(sealed) || strings.Contains(sealed+reason, "PRIVATE KEY") {
			t.Fatalf("stored key = %q, reason = %q, want an envelope and no key", sealed, reason)
		}
		if action != fcmsettings.ActionSaved || targetType != fcmsettings.TargetType {
			t.Fatalf("audit = (%q, %q)", action, targetType)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	_ = rows.Close()
	if seen != 2 {
		t.Fatalf("stored rows with their audit entry = %d, want 2", seen)
	}

	var built []*builtClient
	senders := fcmsettings.NewSenders(dbmodels.New(pg.OpenOutboxDB(t)), encryptor,
		func(_ context.Context, cfg push.Config) (fcmsettings.Sender, error) {
			client := &builtClient{projectID: cfg.ProjectID, keyJSON: string(cfg.CredentialsJSON)}
			built = append(built, client)
			return client, nil
		}, 0, nil)
	for _, tenantID := range []uuid.UUID{tenantA.ID, tenantB.ID} {
		if err := senders.Send(ctx, tenantID, push.Message{Token: "token"}); err != nil {
			t.Fatalf("Send for %s: %v", tenantID, err)
		}
	}
	if len(built) != 2 || built[0].keyJSON != keys[tenantA.ID] || built[1].keyJSON != keys[tenantB.ID] {
		t.Fatal("the tenants were not sent with their own keys")
	}
	if built[0].projectID != "fcm-tenant-a" || built[1].projectID != "fcm-tenant-b" {
		t.Fatalf("projects = (%q, %q)", built[0].projectID, built[1].projectID)
	}

	withAdminTenant(t, pg, tenantA.ID, func(ctx context.Context, conn *sql.Conn) {
		store := fcmsettings.New(dbmodels.New(conn), encryptor, nil)
		if err := store.Delete(ctx, tenantA.ID, fcmsettings.AuditMeta{}); err != nil {
			t.Fatalf("Delete: %v", err)
		}
	})
	if err := senders.Send(ctx, tenantA.ID, push.Message{Token: "token"}); !errors.Is(err, fcmsettings.ErrNotConfigured) {
		t.Fatalf("Send after removal = %v, want ErrNotConfigured", err)
	}
	if err := senders.Send(ctx, tenantB.ID, push.Message{Token: "token"}); err != nil {
		t.Fatalf("Send for the other tenant after removal: %v", err)
	}
}

// Row-level security keeps one tenant's administrator from reading, replacing
// or removing another tenant's key.
func TestAdminRoleReachesOnlyItsOwnTenantsCredentials(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenantA := pg.SeedTenant(t, "FCMTNT00000A", "fcm-a.example.com", "FCM Tenant A")
	tenantB := pg.SeedTenant(t, "FCMTNT00000B", "fcm-b.example.com", "FCM Tenant B")
	encryptor := integrationEncryptor(t)
	keyB := testutil.ServiceAccountJSON(t, "fcm-tenant-b", "push@fcm-tenant-b.iam.gserviceaccount.com")
	if _, err := fcmsettings.New(dbmodels.New(pg.DB), encryptor, nil).Save(context.Background(), tenantB.ID, "fcm-tenant-b", keyB, fcmsettings.AuditMeta{}); err != nil {
		t.Fatalf("seed tenant B: %v", err)
	}

	withAdminTenant(t, pg, tenantA.ID, func(ctx context.Context, conn *sql.Conn) {
		store := fcmsettings.New(dbmodels.New(conn), encryptor, nil)
		settings, err := store.Get(ctx, tenantB.ID)
		if err != nil {
			t.Fatalf("Get other tenant: %v", err)
		}
		if settings.Configured {
			t.Fatalf("tenant A saw tenant B's credentials: %+v", settings)
		}
		keyA := testutil.ServiceAccountJSON(t, "fcm-tenant-a", "push@fcm-tenant-a.iam.gserviceaccount.com")
		if _, err := store.Save(ctx, tenantB.ID, "fcm-tenant-a", keyA, fcmsettings.AuditMeta{}); sqlState(err) != insufficientPrivilege {
			t.Fatalf("Save for other tenant = %v, want SQLSTATE %s", err, insufficientPrivilege)
		}
		if err := store.Delete(ctx, tenantB.ID, fcmsettings.AuditMeta{}); err != nil {
			t.Fatalf("Delete other tenant: %v", err)
		}
	})

	var projectID string
	if err := pg.DB.QueryRow("SELECT project_id FROM tenant_fcm_config WHERE tenant_id = $1", tenantB.ID).Scan(&projectID); err != nil {
		t.Fatalf("tenant B's credentials after tenant A's attempts: %v", err)
	}
	if projectID != "fcm-tenant-b" {
		t.Fatalf("tenant B's project = %q", projectID)
	}
}

// Only the tenant console and the worker have a use for the table, and the
// worker only reads it.
func TestOnlyTheAdminAndWorkerRolesReachTheCredentials(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for role, conn := range map[string]*sql.DB{
		"publira_public":        pg.OpenPublicDB(t),
		"publira_platform":      pg.OpenPlatformDB(t),
		"publira_content_stats": pg.OpenContentStatsDB(t),
		"publira_ticker":        pg.OpenTickerDB(t),
	} {
		if _, err := conn.ExecContext(ctx, "SELECT count(*) FROM tenant_fcm_config"); sqlState(err) != insufficientPrivilege {
			t.Fatalf("read as %s = %v, want SQLSTATE %s", role, err, insufficientPrivilege)
		}
	}

	outbox := pg.OpenOutboxDB(t)
	var count int
	if err := outbox.QueryRowContext(ctx, "SELECT count(*) FROM tenant_fcm_config").Scan(&count); err != nil {
		t.Fatalf("read as publira_outbox: %v", err)
	}
	for _, statement := range []string{
		"INSERT INTO tenant_fcm_config DEFAULT VALUES",
		"UPDATE tenant_fcm_config SET project_id = project_id",
		"DELETE FROM tenant_fcm_config",
	} {
		if _, err := outbox.ExecContext(ctx, statement); sqlState(err) != insufficientPrivilege {
			t.Fatalf("%q as publira_outbox = %v, want SQLSTATE %s", statement, err, insufficientPrivilege)
		}
	}
}

func TestDatabaseRefusesAPlaintextKey(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "FCMTNT00000P", "fcm-plain.example.com", "FCM Tenant Plain")
	keyJSON := testutil.ServiceAccountJSON(t, "fcm-plain", "push@fcm-plain.iam.gserviceaccount.com")
	_, err := pg.DB.Exec(`
		INSERT INTO tenant_fcm_config (tenant_id, project_id, client_email, service_account_json_encrypted)
		VALUES ($1, 'fcm-plain', 'push@fcm-plain.iam.gserviceaccount.com', $2)
	`, tenant.ID, keyJSON)
	if sqlState(err) != checkViolation {
		t.Fatalf("plaintext insert = %v, want SQLSTATE %s", err, checkViolation)
	}
}
