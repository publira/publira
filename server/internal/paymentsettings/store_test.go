package paymentsettings

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/secretcrypto"
)

const (
	testSecretKey     = "sk_test_51LeakThisValueXXXX"
	testWebhookSecret = "whsec_LeakThisWebhookYYYY"
)

func TestStoreUpsertEncryptsAndMasks(t *testing.T) {
	queries := newMemoryPaymentQueries()
	audit := &memoryAuditQueries{}
	var logs bytes.Buffer
	store := newTestStore(t, queries, audit, &logs)
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())

	cfg, err := store.Upsert(context.Background(), tenantID, UpdateInput{
		Enabled:                 true,
		SecretKey:               testSecretKey,
		SecretKeyUpdateMode:     SecretUpdateModeReplace,
		WebhookSecret:           testWebhookSecret,
		WebhookSecretUpdateMode: SecretUpdateModeReplace,
	}, AuditMeta{
		ActorUserID: actorID,
		ActorRole:   auth.RoleTenantAdmin,
		TargetID:    "TENANTPUBLIC",
		ClientIP:    "203.0.113.8",
	})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	if !cfg.Enabled || !cfg.Ready {
		t.Fatalf("public config enabled=%v ready=%v, want both true", cfg.Enabled, cfg.Ready)
	}
	if !cfg.SecretKeyConfigured || !cfg.WebhookSecretConfigured {
		t.Fatal("public config missing configured flags")
	}
	if cfg.SecretKeyHint == "" || cfg.WebhookSecretHint == "" {
		t.Fatal("public config missing hints")
	}
	if containsAny(cfg.SecretKeyHint, testSecretKey) || containsAny(cfg.WebhookSecretHint, testWebhookSecret) {
		t.Fatalf("hints leaked plaintext: %+v", cfg)
	}

	row, err := queries.GetTenantPaymentConfigByTenantID(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetTenantPaymentConfigByTenantID: %v", err)
	}
	if !secretcrypto.IsEncryptedEnvelope(row.SecretKeyEncrypted.String) {
		t.Fatalf("secret_key_encrypted is not an envelope: %q", row.SecretKeyEncrypted.String)
	}
	if !secretcrypto.IsEncryptedEnvelope(row.WebhookSecretEncrypted.String) {
		t.Fatalf("webhook_secret_encrypted is not an envelope: %q", row.WebhookSecretEncrypted.String)
	}
	if containsAny(row.SecretKeyEncrypted.String, testSecretKey, testWebhookSecret) {
		t.Fatal("stored ciphertext contains plaintext")
	}

	entries := audit.snapshot()
	if len(entries) != 1 {
		t.Fatalf("audit entries = %d, want 1", len(entries))
	}
	entry := entries[0]
	if entry.Action != ActionUpdated {
		t.Fatalf("audit action = %q, want %q", entry.Action, ActionUpdated)
	}
	if entry.TargetType.String != TargetType {
		t.Fatalf("audit target_type = %q, want %q", entry.TargetType.String, TargetType)
	}
	if entry.Outcome != auditlog.OutcomeSuccess {
		t.Fatalf("audit outcome = %q, want success", entry.Outcome)
	}
	if containsAny(entry.Reason.String, testSecretKey, testWebhookSecret) {
		t.Fatalf("audit reason leaked a secret: %q", entry.Reason.String)
	}

	if containsAny(logs.String(), testSecretKey, testWebhookSecret) {
		t.Fatalf("logs leaked a secret: %s", logs.String())
	}
}

func TestStoreGetPublicDoesNotDecrypt(t *testing.T) {
	queries := newMemoryPaymentQueries()
	audit := &memoryAuditQueries{}
	var logs bytes.Buffer
	store := newTestStore(t, queries, audit, &logs)
	tenantID := uuid.Must(uuid.NewV7())

	_, err := store.Upsert(context.Background(), tenantID, UpdateInput{
		Enabled:                 true,
		SecretKey:               testSecretKey,
		SecretKeyUpdateMode:     SecretUpdateModeReplace,
		WebhookSecret:           testWebhookSecret,
		WebhookSecretUpdateMode: SecretUpdateModeReplace,
	}, AuditMeta{})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	cfg, err := store.GetPublic(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetPublic: %v", err)
	}
	dump := strings.Join([]string{
		cfg.Provider,
		cfg.SecretKeyHint,
		cfg.WebhookSecretHint,
		logs.String(),
	}, "\n")
	if containsAny(dump, testSecretKey, testWebhookSecret) {
		t.Fatalf("GetPublic leaked a secret: %s", dump)
	}
	if cfg.SecretKeyHint == testSecretKey {
		t.Fatal("GetPublic returned plaintext as hint")
	}
}

func TestStoreGetPublicMissingRow(t *testing.T) {
	store := newTestStore(t, newMemoryPaymentQueries(), &memoryAuditQueries{}, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())

	cfg, err := store.GetPublic(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetPublic: %v", err)
	}
	if cfg.Enabled || cfg.Ready || cfg.SecretKeyConfigured {
		t.Fatalf("missing row config = %+v, want disabled empty", cfg)
	}
	if cfg.Provider != ProviderStripe {
		t.Fatalf("provider = %q, want stripe", cfg.Provider)
	}
	if cfg.TenantID != tenantID {
		t.Fatalf("tenant id = %s, want %s", cfg.TenantID, tenantID)
	}
}

func TestStoreRejectsEnableWithoutSecrets(t *testing.T) {
	store := newTestStore(t, newMemoryPaymentQueries(), &memoryAuditQueries{}, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())

	_, err := store.Upsert(context.Background(), tenantID, UpdateInput{Enabled: true}, AuditMeta{
		ActorUserID: uuid.Must(uuid.NewV7()),
		ActorRole:   auth.RoleTenantAdmin,
	})
	if !errors.Is(err, ErrSecretsRequired) {
		t.Fatalf("Upsert error = %v, want ErrSecretsRequired", err)
	}
}

func TestStoreRotateAndClearSecrets(t *testing.T) {
	queries := newMemoryPaymentQueries()
	store := newTestStore(t, queries, &memoryAuditQueries{}, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())

	_, err := store.Upsert(context.Background(), tenantID, UpdateInput{
		Enabled:                 true,
		SecretKey:               testSecretKey,
		SecretKeyUpdateMode:     SecretUpdateModeReplace,
		WebhookSecret:           testWebhookSecret,
		WebhookSecretUpdateMode: SecretUpdateModeReplace,
	}, AuditMeta{})
	if err != nil {
		t.Fatalf("initial Upsert: %v", err)
	}
	before, err := queries.GetTenantPaymentConfigByTenantID(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("load before rotate: %v", err)
	}

	const rotated = "sk_test_51RotatedValueZZZZ"
	cfg, err := store.Upsert(context.Background(), tenantID, UpdateInput{
		Enabled:                 true,
		SecretKey:               rotated,
		SecretKeyUpdateMode:     SecretUpdateModeReplace,
		WebhookSecretUpdateMode: SecretUpdateModeUnchanged,
	}, AuditMeta{})
	if err != nil {
		t.Fatalf("rotate Upsert: %v", err)
	}
	after, err := queries.GetTenantPaymentConfigByTenantID(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("load after rotate: %v", err)
	}
	if after.SecretKeyEncrypted.String == before.SecretKeyEncrypted.String {
		t.Fatal("rotation reused secret key ciphertext")
	}
	if after.WebhookSecretEncrypted.String != before.WebhookSecretEncrypted.String {
		t.Fatal("unchanged webhook secret was rewritten")
	}
	if containsAny(cfg.SecretKeyHint, rotated, testSecretKey) {
		t.Fatalf("rotated hint leaked plaintext: %q", cfg.SecretKeyHint)
	}

	disabled, err := store.Upsert(context.Background(), tenantID, UpdateInput{
		Enabled:                 false,
		SecretKeyUpdateMode:     SecretUpdateModeClear,
		WebhookSecretUpdateMode: SecretUpdateModeClear,
	}, AuditMeta{})
	if err != nil {
		t.Fatalf("clear Upsert: %v", err)
	}
	if disabled.Enabled || disabled.SecretKeyConfigured || disabled.WebhookSecretConfigured || disabled.Ready {
		t.Fatalf("cleared config = %+v, want empty disabled", disabled)
	}

	_, _, err = store.LoadEnabledSecrets(context.Background(), tenantID)
	if !errors.Is(err, ErrNotEnabled) {
		t.Fatalf("LoadEnabledSecrets after clear error = %v, want ErrNotEnabled", err)
	}
}

func TestStoreLoadEnabledSecretsDecrypts(t *testing.T) {
	store := newTestStore(t, newMemoryPaymentQueries(), &memoryAuditQueries{}, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())

	_, err := store.Upsert(context.Background(), tenantID, UpdateInput{
		Enabled:                 true,
		SecretKey:               testSecretKey,
		SecretKeyUpdateMode:     SecretUpdateModeReplace,
		WebhookSecret:           testWebhookSecret,
		WebhookSecretUpdateMode: SecretUpdateModeReplace,
	}, AuditMeta{})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	cfg, secrets, err := store.LoadEnabledSecrets(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("LoadEnabledSecrets: %v", err)
	}
	if secrets.SecretKey != testSecretKey || secrets.WebhookSecret != testWebhookSecret {
		t.Fatalf("decrypted secrets = %+v", secrets)
	}
	if !cfg.Ready {
		t.Fatal("loaded config is not ready")
	}
	if containsAny(cfg.SecretKeyHint, testSecretKey) {
		t.Fatal("public config from LoadEnabledSecrets leaked plaintext")
	}
}

func TestStoreLoadEnabledSecretsMissing(t *testing.T) {
	store := newTestStore(t, newMemoryPaymentQueries(), &memoryAuditQueries{}, &bytes.Buffer{})
	_, _, err := store.LoadEnabledSecrets(context.Background(), uuid.Must(uuid.NewV7()))
	if !errors.Is(err, ErrNotEnabled) {
		t.Fatalf("error = %v, want ErrNotEnabled", err)
	}
}

func TestStoreTenantIsolationOnQueries(t *testing.T) {
	queries := newMemoryPaymentQueries()
	store := newTestStore(t, queries, &memoryAuditQueries{}, &bytes.Buffer{})
	tenantA := uuid.Must(uuid.NewV7())
	tenantB := uuid.Must(uuid.NewV7())

	_, err := store.Upsert(context.Background(), tenantA, UpdateInput{
		Enabled:                 true,
		SecretKey:               testSecretKey,
		SecretKeyUpdateMode:     SecretUpdateModeReplace,
		WebhookSecret:           testWebhookSecret,
		WebhookSecretUpdateMode: SecretUpdateModeReplace,
	}, AuditMeta{})
	if err != nil {
		t.Fatalf("upsert A: %v", err)
	}

	cfgB, err := store.GetPublic(context.Background(), tenantB)
	if err != nil {
		t.Fatalf("GetPublic B: %v", err)
	}
	if cfgB.SecretKeyConfigured || cfgB.Enabled {
		t.Fatalf("tenant B saw tenant A config: %+v", cfgB)
	}

	_, _, err = store.LoadEnabledSecrets(context.Background(), tenantB)
	if !errors.Is(err, ErrNotEnabled) {
		t.Fatalf("LoadEnabledSecrets B error = %v, want ErrNotEnabled", err)
	}
}

func TestStoreDecryptFailureDoesNotLeakCiphertextOrPlaintext(t *testing.T) {
	queries := newMemoryPaymentQueries()
	var logs bytes.Buffer
	store := newTestStore(t, queries, &memoryAuditQueries{}, &logs)
	tenantID := uuid.Must(uuid.NewV7())

	_, err := store.Upsert(context.Background(), tenantID, UpdateInput{
		Enabled:                 true,
		SecretKey:               testSecretKey,
		SecretKeyUpdateMode:     SecretUpdateModeReplace,
		WebhookSecret:           testWebhookSecret,
		WebhookSecretUpdateMode: SecretUpdateModeReplace,
	}, AuditMeta{})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	row, err := queries.GetTenantPaymentConfigByTenantID(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("load row: %v", err)
	}
	other, err := secretcrypto.NewManager(map[string][]byte{
		"k2": bytes.Repeat([]byte{9}, 32),
	}, "k2")
	if err != nil {
		t.Fatalf("other manager: %v", err)
	}
	store.encryptor = other

	_, secrets, err := store.LoadEnabledSecrets(context.Background(), tenantID)
	if !errors.Is(err, ErrDecryptFailed) {
		t.Fatalf("error = %v, want ErrDecryptFailed", err)
	}
	if secrets.SecretKey != "" || secrets.WebhookSecret != "" {
		t.Fatalf("failed load returned secrets: %+v", secrets)
	}
	if containsAny(err.Error(), testSecretKey, testWebhookSecret, row.SecretKeyEncrypted.String) {
		t.Fatalf("error leaked secret material: %v", err)
	}
	if containsAny(logs.String(), testSecretKey, testWebhookSecret) {
		t.Fatalf("logs leaked a secret: %s", logs.String())
	}
}
