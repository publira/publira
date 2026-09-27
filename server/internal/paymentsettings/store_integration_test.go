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
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
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
	cfg, err := store.Upsert(ctx, tenant.ID, stripeUpdate(integrationSecretKey, integrationWebhookSecret), paymentsettings.AuditMeta{
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
		SELECT enabled,
			credentials_encrypted ->> 'secret_key',
			credentials_encrypted ->> 'webhook_secret',
			credential_hints ->> 'secret_key',
			credential_hints ->> 'webhook_secret'
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

	if want := "fields: stripe.secret_key, stripe.webhook_secret"; reason != want {
		t.Fatalf("audit reason = %q, want %q", reason, want)
	}

	_, credentials, err := store.LoadEnabledSecrets(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("LoadEnabledSecrets: %v", err)
	}
	if credentials[stripe.FieldSecretKey] != integrationSecretKey || credentials[stripe.FieldWebhookSecret] != integrationWebhookSecret {
		t.Fatalf("decrypted credentials do not match input")
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
	if _, err := superStore.Upsert(ctx, tenantB.ID, stripeUpdate(integrationSecretKey, integrationWebhookSecret), paymentsettings.AuditMeta{
		ActorUserID: actorB.ID,
		ActorRole:   auth.RoleTenantAdmin,
		TargetID:    tenantB.PublicID,
	}); err != nil {
		t.Fatalf("seed tenant B config: %v", err)
	}

	withAdminTenant(t, pg, tenantA.ID, func(ctx context.Context, conn *sql.Conn) {
		store := newIntegrationStore(t, conn, &bytes.Buffer{})
		own, err := store.Upsert(ctx, tenantA.ID, stripeUpdate("sk_test_51TenantAOwnKeyXXXX", "whsec_TenantAOwnWebhookYYYY"), paymentsettings.AuditMeta{
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
		if cfg.Enabled || len(cfg.Fields) != 0 {
			t.Fatalf("tenant A saw tenant B config: %+v", cfg)
		}

		_, _, err = store.LoadEnabledSecrets(ctx, tenantB.ID)
		if !errors.Is(err, paymentsettings.ErrNotEnabled) {
			t.Fatalf("LoadEnabledSecrets other tenant error = %v, want ErrNotEnabled", err)
		}

		_, err = store.Upsert(ctx, tenantB.ID, stripeUpdate("sk_test_51PlantedByTenantA", "whsec_PlantedByTenantAXXXX"), paymentsettings.AuditMeta{
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
		SELECT enabled, credentials_encrypted ->> 'secret_key'
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
	for name, credentials := range map[string]string{
		"plaintext value":  `{"secret_key": "` + integrationSecretKey + `"}`,
		"non-string value": `{"secret_key": 42}`,
		"array":            `["enc:v1:k1:abc"]`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := pg.DB.ExecContext(ctx, `
				INSERT INTO tenant_payment_config (tenant_id, provider, enabled, credentials_encrypted)
				VALUES ($1, 'stripe', false, $2)
			`, tenant.ID, credentials)
			if !isCheckViolation(err) {
				t.Fatalf("insert error = %v, want check_violation", err)
			}
		})
	}
}

// The migration versions the credential map test steps between: the last one
// before the fields moved into a map, and the one that moved them.
const (
	beforeCredentialFieldsVersion = 20260927014651
	credentialFieldsVersion       = 20260927143544
)

// A tenant that saved its Stripe secret key and webhook secret before the
// settings held a map of fields keeps both, under the field names Stripe
// declares, and stays ready to take payments.
func TestCredentialFieldsMigrationKeepsStripeSettingsReady(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.MigrateTo(t, beforeCredentialFieldsVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	mgr := integrationEncryptor(t)
	ready := pg.SeedTenant(t, "PAYMIG000001", "pay-ready.example.com", "Pay Ready")
	disabled := pg.SeedTenant(t, "PAYMIG000002", "pay-disabled.example.com", "Pay Disabled")
	secretEncrypted, err := mgr.EncryptString(integrationSecretKey)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	webhookEncrypted, err := mgr.EncryptString(integrationWebhookSecret)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_payment_config (
			tenant_id, provider, enabled,
			secret_key_encrypted, webhook_secret_encrypted, secret_key_hint, webhook_secret_hint
		) VALUES ($1, 'stripe', true, $2, $3, $4, $5)
	`, ready.ID, secretEncrypted, webhookEncrypted,
		paymentsettings.MaskSecret(integrationSecretKey), paymentsettings.MaskSecret(integrationWebhookSecret)); err != nil {
		t.Fatalf("insert ready settings: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_payment_config (tenant_id, provider, enabled, secret_key_encrypted, secret_key_hint)
		VALUES ($1, 'stripe', false, $2, $3)
	`, disabled.ID, secretEncrypted, paymentsettings.MaskSecret(integrationSecretKey)); err != nil {
		t.Fatalf("insert disabled settings: %v", err)
	}

	pg.MigrateTo(t, credentialFieldsVersion)

	store := newIntegrationStore(t, pg.DB, &bytes.Buffer{})
	cfg, credentials, err := store.LoadEnabledSecrets(ctx, ready.ID)
	if err != nil {
		t.Fatalf("LoadEnabledSecrets: %v", err)
	}
	if !cfg.Ready || cfg.Provider != stripe.ID {
		t.Fatalf("migrated config = %+v, want ready stripe", cfg)
	}
	if credentials[stripe.FieldSecretKey] != integrationSecretKey || credentials[stripe.FieldWebhookSecret] != integrationWebhookSecret {
		t.Fatal("migrated credentials do not decrypt to what was stored")
	}
	for name, want := range map[string]string{
		stripe.FieldSecretKey:     paymentsettings.MaskSecret(integrationSecretKey),
		stripe.FieldWebhookSecret: paymentsettings.MaskSecret(integrationWebhookSecret),
	} {
		field, ok := cfg.Field(name)
		if !ok || !field.Configured || field.Hint != want {
			t.Fatalf("migrated field %s = %+v, want configured with hint %q", name, field, want)
		}
	}

	partial, err := store.GetPublic(ctx, disabled.ID)
	if err != nil {
		t.Fatalf("GetPublic: %v", err)
	}
	if partial.Ready || partial.Enabled {
		t.Fatalf("migrated disabled config = %+v, want not ready", partial)
	}
	if field, _ := partial.Field(stripe.FieldWebhookSecret); field.Configured {
		t.Fatal("a secret that was never stored is configured after the migration")
	}
	if field, _ := partial.Field(stripe.FieldSecretKey); !field.Configured {
		t.Fatal("the stored secret key did not survive the migration")
	}
}

// Rolling the migration back leaves every row the old Stripe-only constraints
// accept: Stripe's secrets back in their columns, and a row they cannot hold
// disabled rather than failing the rollback.
func TestCredentialFieldsMigrationDownKeepsWhatTheOldColumnsCanHold(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	stripeTenant := pg.SeedTenant(t, "PAYDWN000001", "pay-down-a.example.com", "Pay Down A")
	otherTenant := pg.SeedTenant(t, "PAYDWN000002", "pay-down-b.example.com", "Pay Down B")
	partialTenant := pg.SeedTenant(t, "PAYDWN000003", "pay-down-c.example.com", "Pay Down C")
	insert := func(tenantID uuid.UUID, provider, credentials, hints string) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO tenant_payment_config (tenant_id, provider, enabled, credentials_encrypted, credential_hints)
			VALUES ($1, $2, true, $3, $4)
		`, tenantID, provider, credentials, hints); err != nil {
			t.Fatalf("insert %s settings: %v", provider, err)
		}
	}
	insert(stripeTenant.ID, stripe.ID,
		`{"secret_key": "enc:v1:k1:a", "webhook_secret": "enc:v1:k1:b"}`,
		`{"secret_key": "sk_test_••••aaaa", "webhook_secret": "whsec_••••bbbb"}`)
	insert(otherTenant.ID, "card", `{"secret_key": "enc:v1:k1:c"}`, `{"secret_key": "••••cccc"}`)
	insert(partialTenant.ID, stripe.ID, `{"secret_key": "enc:v1:k1:d"}`, `{"secret_key": "sk_test_••••dddd"}`)

	pg.MigrateTo(t, beforeCredentialFieldsVersion)

	type oldRow struct {
		provider string
		enabled  bool
		secret   sql.NullString
		webhook  sql.NullString
	}
	read := func(tenantID uuid.UUID) oldRow {
		t.Helper()
		var row oldRow
		if err := pg.DB.QueryRowContext(ctx, `
			SELECT provider, enabled, secret_key_encrypted, webhook_secret_encrypted
			FROM tenant_payment_config
			WHERE tenant_id = $1
		`, tenantID).Scan(&row.provider, &row.enabled, &row.secret, &row.webhook); err != nil {
			t.Fatalf("read rolled back settings: %v", err)
		}
		return row
	}
	if got, want := read(stripeTenant.ID), (oldRow{stripe.ID, true, sql.NullString{String: "enc:v1:k1:a", Valid: true}, sql.NullString{String: "enc:v1:k1:b", Valid: true}}); got != want {
		t.Fatalf("rolled back Stripe row = %+v, want %+v", got, want)
	}
	if got, want := read(otherTenant.ID), (oldRow{provider: stripe.ID}); got != want {
		t.Fatalf("rolled back row of another provider = %+v, want %+v", got, want)
	}
	if got, want := read(partialTenant.ID), (oldRow{stripe.ID, false, sql.NullString{String: "enc:v1:k1:d", Valid: true}, sql.NullString{}}); got != want {
		t.Fatalf("rolled back Stripe row missing a secret = %+v, want %+v", got, want)
	}
}

func stripeUpdate(secretKey, webhookSecret string) paymentsettings.UpdateInput {
	return paymentsettings.UpdateInput{
		Provider: stripe.ID,
		Enabled:  true,
		Fields: []paymentsettings.FieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: secretupdate.Replace, Value: secretKey},
			{Name: stripe.FieldWebhookSecret, Mode: secretupdate.Replace, Value: webhookSecret},
		},
	}
}

func integrationEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{
		"k1": bytes.Repeat([]byte{7}, 32),
	}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

func newIntegrationStore(t *testing.T, db dbmodels.DBTX, logs *bytes.Buffer) *paymentsettings.Store {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(logs, nil))
	queries := dbmodels.New(db)
	return paymentsettings.New(queries, integrationEncryptor(t), providers.Registry(), auditlog.New(queries, logger), logger)
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
