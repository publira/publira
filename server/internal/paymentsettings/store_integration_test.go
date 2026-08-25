package paymentsettings_test

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	integrationSecretKey     = "sk_test_51IntegrationPlaintext"
	integrationWebhookSecret = "whsec_IntegrationWebhookPlain"
	insufficientPrivilege    = "42501"
)

func TestStorePersistsEncryptedSecretsAndAudit(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "PAYTNT000001", "pay-a.example.com", "Pay Tenant A")
	actor := pg.SeedTenantAdmin(t, tenant.ID, "PAYADM000001", "pay-admin@example.com", "Pay Admin")

	var logs bytes.Buffer
	store := newIntegrationStore(t, pg.DB, &logs)
	cfg, err := store.Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Enabled:                 true,
		SecretKey:               integrationSecretKey,
		SecretKeyUpdateMode:     paymentsettings.SecretUpdateModeReplace,
		WebhookSecret:           integrationWebhookSecret,
		WebhookSecretUpdateMode: paymentsettings.SecretUpdateModeReplace,
	}, paymentsettings.AuditMeta{
		ActorUserID: actor.ID,
		ActorRole:   auth.RoleTenantAdmin,
		TargetID:    tenant.PublicID,
		ClientIP:    "198.51.100.10",
	})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if !cfg.Ready {
		t.Fatalf("config not ready: %+v", cfg)
	}

	var secretEncrypted, webhookEncrypted, secretHint, webhookHint string
	var enabled bool
	err = pg.DB.QueryRowContext(ctx, `
		SELECT enabled, secret_key_encrypted, webhook_secret_encrypted, secret_key_hint, webhook_secret_hint
		FROM tenant_payment_config
		WHERE tenant_id = $1
	`, tenant.ID).Scan(&enabled, &secretEncrypted, &webhookEncrypted, &secretHint, &webhookHint)
	if err != nil {
		t.Fatalf("select stored row: %v", err)
	}
	if !enabled {
		t.Fatal("stored row enabled = false")
	}
	if !secretcrypto.IsEncryptedEnvelope(secretEncrypted) || !secretcrypto.IsEncryptedEnvelope(webhookEncrypted) {
		t.Fatalf("stored secrets are not envelopes: key=%q webhook=%q", secretEncrypted, webhookEncrypted)
	}
	if containsPlaintext(secretEncrypted, webhookEncrypted, secretHint, webhookHint) {
		t.Fatal("database row contains plaintext secrets")
	}

	var action, targetType, targetID, outcome, reason string
	err = pg.DB.QueryRowContext(ctx, `
		SELECT action, target_type, target_id, outcome, coalesce(reason, '')
		FROM audit_logs
		WHERE tenant_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, tenant.ID).Scan(&action, &targetType, &targetID, &outcome, &reason)
	if err != nil {
		t.Fatalf("select audit log: %v", err)
	}
	if action != paymentsettings.ActionUpdated {
		t.Fatalf("audit action = %q, want %q", action, paymentsettings.ActionUpdated)
	}
	if targetType != paymentsettings.TargetType {
		t.Fatalf("audit target_type = %q, want %q", targetType, paymentsettings.TargetType)
	}
	if outcome != auditlog.OutcomeSuccess {
		t.Fatalf("audit outcome = %q, want success", outcome)
	}
	if containsPlaintext(reason, targetID, logs.String()) {
		t.Fatal("audit or logs contain plaintext secrets")
	}

	_, secrets, err := store.LoadEnabledSecrets(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("LoadEnabledSecrets: %v", err)
	}
	if secrets.SecretKey != integrationSecretKey || secrets.WebhookSecret != integrationWebhookSecret {
		t.Fatalf("decrypted secrets do not match input")
	}
}

func TestStoreRLSHidesOtherTenantPaymentConfig(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantA := pg.SeedTenant(t, "PAYTNT00000A", "pay-a.example.com", "Pay Tenant A")
	tenantB := pg.SeedTenant(t, "PAYTNT00000B", "pay-b.example.com", "Pay Tenant B")
	actorA := pg.SeedTenantAdmin(t, tenantA.ID, "PAYADMA00001", "pay-a@example.com", "Pay Admin A")
	actorB := pg.SeedTenantAdmin(t, tenantB.ID, "PAYADMB00001", "pay-b@example.com", "Pay Admin B")

	superStore := newIntegrationStore(t, pg.DB, &bytes.Buffer{})
	if _, err := superStore.Upsert(ctx, tenantB.ID, paymentsettings.UpdateInput{
		Enabled:                 true,
		SecretKey:               integrationSecretKey,
		SecretKeyUpdateMode:     paymentsettings.SecretUpdateModeReplace,
		WebhookSecret:           integrationWebhookSecret,
		WebhookSecretUpdateMode: paymentsettings.SecretUpdateModeReplace,
	}, paymentsettings.AuditMeta{
		ActorUserID: actorB.ID,
		ActorRole:   auth.RoleTenantAdmin,
		TargetID:    tenantB.PublicID,
	}); err != nil {
		t.Fatalf("seed tenant B config: %v", err)
	}

	withAdminTenant(t, pg, tenantA.ID, func(ctx context.Context, conn *sql.Conn) {
		store := newIntegrationStore(t, conn, &bytes.Buffer{})
		own, err := store.Upsert(ctx, tenantA.ID, paymentsettings.UpdateInput{
			Enabled:                 true,
			SecretKey:               "sk_test_51TenantAOwnKeyXXXX",
			SecretKeyUpdateMode:     paymentsettings.SecretUpdateModeReplace,
			WebhookSecret:           "whsec_TenantAOwnWebhookYYYY",
			WebhookSecretUpdateMode: paymentsettings.SecretUpdateModeReplace,
		}, paymentsettings.AuditMeta{
			ActorUserID: actorA.ID,
			ActorRole:   auth.RoleTenantAdmin,
			TargetID:    tenantA.PublicID,
		})
		if err != nil {
			t.Fatalf("upsert own tenant config: %v", err)
		}
		if !own.Ready {
			t.Fatalf("own config not ready: %+v", own)
		}

		cfg, err := store.GetPublic(ctx, tenantB.ID)
		if err != nil {
			t.Fatalf("GetPublic other tenant: %v", err)
		}
		if cfg.Enabled || cfg.SecretKeyConfigured {
			t.Fatalf("tenant A saw tenant B config: %+v", cfg)
		}

		_, _, err = store.LoadEnabledSecrets(ctx, tenantB.ID)
		if !errors.Is(err, paymentsettings.ErrNotEnabled) {
			t.Fatalf("LoadEnabledSecrets other tenant error = %v, want ErrNotEnabled", err)
		}

		_, err = store.Upsert(ctx, tenantB.ID, paymentsettings.UpdateInput{
			Enabled:                 true,
			SecretKey:               "sk_test_51PlantedByTenantA",
			SecretKeyUpdateMode:     paymentsettings.SecretUpdateModeReplace,
			WebhookSecret:           "whsec_PlantedByTenantAXXXX",
			WebhookSecretUpdateMode: paymentsettings.SecretUpdateModeReplace,
		}, paymentsettings.AuditMeta{
			ActorUserID: actorA.ID,
			ActorRole:   auth.RoleTenantAdmin,
			TargetID:    tenantB.PublicID,
		})
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilege {
			t.Fatalf("upsert other tenant error = %v, want SQLSTATE %s", err, insufficientPrivilege)
		}
	})

	var enabled bool
	var secretEncrypted string
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT enabled, secret_key_encrypted
		FROM tenant_payment_config
		WHERE tenant_id = $1
	`, tenantB.ID).Scan(&enabled, &secretEncrypted); err != nil {
		t.Fatalf("reload tenant B: %v", err)
	}
	if !enabled {
		t.Fatal("tenant B config was disabled by tenant A")
	}
	if strings.Contains(secretEncrypted, "PlantedByTenantA") {
		t.Fatal("tenant A wrote plaintext into tenant B")
	}

	adminDB := pg.OpenAdminDB(t)
	var visible int
	if err := adminDB.QueryRowContext(ctx, "SELECT count(*) FROM tenant_payment_config").Scan(&visible); err != nil {
		t.Fatalf("count without tenant setting: %v", err)
	}
	if visible != 0 {
		t.Fatalf("rows visible without tenant setting = %d, want 0", visible)
	}
}

func TestStoreRejectsPlaintextAtDatabase(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "PAYTNT00000P", "pay-plain.example.com", "Pay Tenant Plain")
	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_payment_config (
			tenant_id, provider, enabled, secret_key_encrypted, webhook_secret_encrypted
		) VALUES ($1, 'stripe', false, $2, $3)
	`, tenant.ID, integrationSecretKey, integrationWebhookSecret)
	if !isCheckViolation(err) {
		t.Fatalf("plaintext insert error = %v, want check_violation", err)
	}
}

func newIntegrationStore(t *testing.T, db dbmodels.DBTX, logs *bytes.Buffer) *paymentsettings.Store {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{
		"k1": bytes.Repeat([]byte{7}, 32),
	}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(logs, nil))
	queries := dbmodels.New(db)
	return paymentsettings.New(queries, mgr, auditlog.New(queries, logger), logger)
}

func withAdminTenant(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, fn func(ctx context.Context, conn *sql.Conn)) {
	t.Helper()
	db := pg.OpenAdminDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("admin conn: %v", err)
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenantID.String()); err != nil {
		t.Fatalf("set app.current_tenant_id: %v", err)
	}
	fn(ctx, conn)
}

func isCheckViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23514"
	}
	return err != nil && strings.Contains(err.Error(), "violates check constraint")
}

func containsPlaintext(parts ...string) bool {
	for _, part := range parts {
		if strings.Contains(part, integrationSecretKey) || strings.Contains(part, integrationWebhookSecret) {
			return true
		}
	}
	return false
}
