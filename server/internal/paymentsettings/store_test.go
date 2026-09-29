package paymentsettings

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
)

const (
	testSecretKey      = "sk_test_51LeakThisValueXXXX"
	testWebhookSecret  = "whsec_LeakThisWebhookYYYY"
	testCardSecretKey  = "card_secret_LeakThisZZZZ"
	testPublishableKey = "pk_test_ShownToTheBrowser"
	testShopID         = "shop-0042"
)

func stripeInput(enabled bool) UpdateInput {
	return UpdateInput{
		Provider: stripe.ID,
		Enabled:  enabled,
		Fields: []FieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: secretupdate.Replace, Value: testSecretKey},
			{Name: stripe.FieldWebhookSecret, Mode: secretupdate.Replace, Value: testWebhookSecret},
		},
	}
}

func cardInput(enabled bool) UpdateInput {
	return UpdateInput{
		Provider: cardProviderID,
		Enabled:  enabled,
		Fields: []FieldUpdate{
			{Name: cardSecretKey, Mode: secretupdate.Replace, Value: testCardSecretKey},
			{Name: cardPublishableKey, Mode: secretupdate.Replace, Value: testPublishableKey},
			{Name: cardShopID, Mode: secretupdate.Replace, Value: testShopID},
		},
	}
}

func storedMaps(t *testing.T, queries *memoryPaymentQueries, tenantID uuid.UUID) (map[string]string, map[string]string) {
	t.Helper()
	row, err := queries.GetTenantPaymentConfigByTenantID(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetTenantPaymentConfigByTenantID: %v", err)
	}
	stored, err := decodeStoredFields(row)
	if err != nil {
		t.Fatalf("decodeStoredFields: %v", err)
	}
	return stored.encrypted, stored.hints
}

func mustField(t *testing.T, cfg PublicConfig, name string) FieldState {
	t.Helper()
	field, ok := cfg.Field(name)
	if !ok {
		t.Fatalf("config has no field %q: %+v", name, cfg.Fields)
	}
	return field
}

func TestStoreUpsertEncryptsAndMasks(t *testing.T) {
	queries := newMemoryPaymentQueries()
	audit := &memoryAuditQueries{}
	var logs bytes.Buffer
	store := newTestStore(t, queries, audit, &logs)
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())

	cfg, err := store.Upsert(context.Background(), tenantID, stripeInput(true), AuditMeta{
		ActorUserID: actorID,
		ActorRole:   auth.RoleTenantAdmin,
		TargetID:    "TENANTPUBLIC",
		ClientIP:    "203.0.113.8",
	})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	if cfg.Provider != stripe.ID || !cfg.Enabled || !cfg.Ready {
		t.Fatalf("public config = %+v, want enabled and ready stripe", cfg)
	}
	for _, name := range []string{stripe.FieldSecretKey, stripe.FieldWebhookSecret} {
		field := mustField(t, cfg, name)
		if !field.Configured || field.Hint == "" || field.PublicValue != "" {
			t.Fatalf("field %s = %+v, want configured with a hint and no public value", name, field)
		}
		if containsAny(field.Hint, testSecretKey, testWebhookSecret) {
			t.Fatalf("hint of %s leaked plaintext: %q", name, field.Hint)
		}
	}

	encrypted, _ := storedMaps(t, queries, tenantID)
	for _, name := range []string{stripe.FieldSecretKey, stripe.FieldWebhookSecret} {
		if !secretcrypto.IsEncryptedEnvelope(encrypted[name]) {
			t.Fatalf("stored %s is not an envelope: %q", name, encrypted[name])
		}
		if containsAny(encrypted[name], testSecretKey, testWebhookSecret) {
			t.Fatalf("stored %s contains plaintext", name)
		}
	}

	entries := audit.snapshot()
	if len(entries) != 1 {
		t.Fatalf("audit entries = %d, want 1", len(entries))
	}
	entry := entries[0]
	if entry.Action != ActionUpdated || entry.TargetType.String != TargetType || entry.Outcome != auditlog.OutcomeSuccess {
		t.Fatalf("audit entry = %+v", entry)
	}
	if want := "fields: stripe.secret_key, stripe.webhook_secret"; entry.Reason.String != want {
		t.Fatalf("audit reason = %q, want %q", entry.Reason.String, want)
	}

	if containsAny(logs.String(), testSecretKey, testWebhookSecret) {
		t.Fatalf("logs leaked a secret: %s", logs.String())
	}
}

func TestStoreUpdatesEachFieldOnItsOwn(t *testing.T) {
	queries := newMemoryPaymentQueries()
	audit := &memoryAuditQueries{}
	store := newTestStore(t, queries, audit, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())

	if _, err := store.Upsert(context.Background(), tenantID, cardInput(true), AuditMeta{}); err != nil {
		t.Fatalf("initial Upsert: %v", err)
	}
	before, _ := storedMaps(t, queries, tenantID)

	const rotated = "card_secret_RotatedWWWW"
	cfg, err := store.Upsert(context.Background(), tenantID, UpdateInput{
		Provider: cardProviderID,
		Enabled:  true,
		Fields: []FieldUpdate{
			{Name: cardSecretKey, Mode: secretupdate.Replace, Value: rotated},
			{Name: cardPublishableKey, Mode: secretupdate.Unchanged, Value: "ignored"},
			{Name: cardShopID, Mode: secretupdate.Clear},
		},
	}, AuditMeta{ActorUserID: uuid.Must(uuid.NewV7()), ActorRole: auth.RoleTenantAdmin})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	after, hints := storedMaps(t, queries, tenantID)

	if after[cardSecretKey] == before[cardSecretKey] {
		t.Fatal("replace reused the secret key's ciphertext")
	}
	if hints[cardSecretKey] != MaskSecret(rotated) {
		t.Fatalf("replaced hint = %q, want %q", hints[cardSecretKey], MaskSecret(rotated))
	}
	if after[cardPublishableKey] != before[cardPublishableKey] {
		t.Fatal("unchanged publishable key was rewritten")
	}
	if _, ok := after[cardShopID]; ok {
		t.Fatal("cleared shop id is still stored")
	}
	if _, ok := hints[cardShopID]; ok {
		t.Fatal("cleared shop id still has a hint")
	}
	if field := mustField(t, cfg, cardShopID); field.Configured || field.Hint != "" {
		t.Fatalf("cleared field = %+v, want not configured", field)
	}
	if !cfg.Ready {
		t.Fatal("clearing an optional field made the settings not ready")
	}

	// A field the request leaves out is left as it is.
	if _, err := store.Upsert(context.Background(), tenantID, UpdateInput{Provider: cardProviderID, Enabled: true}, AuditMeta{}); err != nil {
		t.Fatalf("Upsert without fields: %v", err)
	}
	untouched, _ := storedMaps(t, queries, tenantID)
	if untouched[cardSecretKey] != after[cardSecretKey] || untouched[cardPublishableKey] != after[cardPublishableKey] {
		t.Fatal("an update naming no field rewrote a stored one")
	}

	entries := audit.snapshot()
	if want := "fields: card.secret_key, card.shop_id"; len(entries) != 1 || entries[0].Reason.String != want {
		t.Fatalf("audit entries = %+v, want one with reason %q", entries, want)
	}
}

func TestStoreReadsAPublicFieldWithoutTheSecretManager(t *testing.T) {
	queries := newMemoryPaymentQueries()
	store := newTestStore(t, queries, &memoryAuditQueries{}, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())

	if _, err := store.Upsert(context.Background(), tenantID, cardInput(true), AuditMeta{}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	reader := New(queries, nil, testRegistry(), nil, nil)
	cfg, err := reader.GetPublic(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetPublic: %v", err)
	}
	if got := mustField(t, cfg, cardPublishableKey); got.PublicValue != testPublishableKey || got.Hint != testPublishableKey {
		t.Fatalf("public field = %+v, want its value", got)
	}
	secret := mustField(t, cfg, cardSecretKey)
	if secret.PublicValue != "" || containsAny(secret.Hint, testCardSecretKey) {
		t.Fatalf("secret field = %+v, want a masked hint and no public value", secret)
	}
	if got := mustField(t, cfg, cardShopID); got.Hint != testShopID || got.PublicValue != "" {
		t.Fatalf("non-secret field = %+v, want its value as the hint only", got)
	}
	if !cfg.Ready {
		t.Fatal("config read without the secret manager is not ready")
	}
}

func TestStoreGetPublicMissingRow(t *testing.T) {
	store := newTestStore(t, newMemoryPaymentQueries(), &memoryAuditQueries{}, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())

	cfg, err := store.GetPublic(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetPublic: %v", err)
	}
	if cfg.Provider != "" || cfg.Enabled || cfg.Ready || len(cfg.Fields) != 0 {
		t.Fatalf("missing row config = %+v, want empty", cfg)
	}
	if cfg.TenantID != tenantID {
		t.Fatalf("tenant id = %s, want %s", cfg.TenantID, tenantID)
	}
}

func TestStoreRejectsEnableWithoutRequiredFields(t *testing.T) {
	store := newTestStore(t, newMemoryPaymentQueries(), &memoryAuditQueries{}, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())

	_, err := store.Upsert(context.Background(), tenantID, UpdateInput{
		Provider: cardProviderID,
		Enabled:  true,
		Fields: []FieldUpdate{
			{Name: cardSecretKey, Mode: secretupdate.Replace, Value: testCardSecretKey},
		},
	}, AuditMeta{})
	if !errors.Is(err, ErrFieldsRequired) {
		t.Fatalf("Upsert error = %v, want ErrFieldsRequired", err)
	}
	if !strings.Contains(err.Error(), cardPublishableKey) {
		t.Fatalf("error %q does not name the missing field", err)
	}
}

func TestStoreRejectsWhatTheProviderDoesNotDeclare(t *testing.T) {
	store := newTestStore(t, newMemoryPaymentQueries(), &memoryAuditQueries{}, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())

	tests := []struct {
		name  string
		input UpdateInput
		want  error
	}{
		{name: "unregistered provider", input: UpdateInput{Provider: "paypal"}, want: ErrInvalidProvider},
		{name: "no provider", input: UpdateInput{}, want: ErrInvalidProvider},
		{name: "undeclared field", input: UpdateInput{Provider: stripe.ID, Fields: []FieldUpdate{
			{Name: cardPublishableKey, Mode: secretupdate.Replace, Value: testPublishableKey},
		}}, want: ErrUnknownField},
		{name: "field updated twice", input: UpdateInput{Provider: stripe.ID, Fields: []FieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: secretupdate.Replace, Value: testSecretKey},
			{Name: stripe.FieldSecretKey, Mode: secretupdate.Clear},
		}}, want: ErrDuplicateField},
		{name: "replace without a value", input: UpdateInput{Provider: stripe.ID, Fields: []FieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: secretupdate.Replace, Value: "  "},
		}}, want: ErrSecretRequired},
		{name: "unknown mode", input: UpdateInput{Provider: stripe.ID, Fields: []FieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: 99},
		}}, want: secretupdate.ErrInvalidMode},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := store.Upsert(context.Background(), tenantID, tt.input, AuditMeta{}); !errors.Is(err, tt.want) {
				t.Fatalf("Upsert error = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestStoreSwitchingProviderClearsThePreviousFields(t *testing.T) {
	queries := newMemoryPaymentQueries()
	audit := &memoryAuditQueries{}
	store := newTestStore(t, queries, audit, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())
	meta := AuditMeta{ActorUserID: uuid.Must(uuid.NewV7()), ActorRole: auth.RoleTenantAdmin}

	if _, err := store.Upsert(context.Background(), tenantID, stripeInput(true), meta); err != nil {
		t.Fatalf("Upsert stripe: %v", err)
	}

	if _, err := store.Upsert(context.Background(), tenantID, UpdateInput{Provider: cardProviderID, Enabled: true}, meta); !errors.Is(err, ErrFieldsRequired) {
		t.Fatalf("enabling the new provider without its fields: error = %v, want ErrFieldsRequired", err)
	}

	switched, err := store.Upsert(context.Background(), tenantID, UpdateInput{Provider: cardProviderID}, meta)
	if err != nil {
		t.Fatalf("Upsert card: %v", err)
	}
	if switched.Provider != cardProviderID || switched.Ready {
		t.Fatalf("switched config = %+v, want card and not ready", switched)
	}
	for _, field := range switched.Fields {
		if field.Configured {
			t.Fatalf("field %s is configured right after the switch", field.Name)
		}
	}
	encrypted, hints := storedMaps(t, queries, tenantID)
	if len(encrypted) != 0 || len(hints) != 0 {
		t.Fatalf("stored fields after the switch = %v / %v, want none", encrypted, hints)
	}
	if _, _, err := store.LoadEnabledSecrets(context.Background(), tenantID); !errors.Is(err, ErrNotEnabled) {
		t.Fatalf("LoadEnabledSecrets after the switch: error = %v, want ErrNotEnabled", err)
	}

	ready, err := store.Upsert(context.Background(), tenantID, cardInput(true), meta)
	if err != nil {
		t.Fatalf("Upsert card fields: %v", err)
	}
	if !ready.Ready {
		t.Fatal("storing the new provider's required fields did not make it ready")
	}

	entries := audit.snapshot()
	if want := "fields: stripe.secret_key, stripe.webhook_secret"; len(entries) != 3 || entries[1].Reason.String != want {
		t.Fatalf("audit entries = %+v, want the switch to name the cleared fields %q", entries, want)
	}
}

func TestStoreLoadEnabledSecretsDecrypts(t *testing.T) {
	store := newTestStore(t, newMemoryPaymentQueries(), &memoryAuditQueries{}, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())

	if _, err := store.Upsert(context.Background(), tenantID, cardInput(true), AuditMeta{}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	cfg, credentials, err := store.LoadEnabledSecrets(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("LoadEnabledSecrets: %v", err)
	}
	if credentials[cardSecretKey] != testCardSecretKey || credentials[cardPublishableKey] != testPublishableKey || credentials[cardShopID] != testShopID {
		t.Fatal("decrypted credentials do not match what was stored")
	}
	if cfg.Provider != cardProviderID || !cfg.Ready {
		t.Fatalf("loaded config = %+v, want ready card", cfg)
	}
	if containsAny(mustField(t, cfg, cardSecretKey).Hint, testCardSecretKey) {
		t.Fatal("public config from LoadEnabledSecrets leaked plaintext")
	}
}

// putRow stores an enabled row holding only the fields named in values, as a
// row saved before a provider declared another required field would be.
func putRow(t *testing.T, queries *memoryPaymentQueries, tenantID uuid.UUID, provider string, values map[string]string) {
	t.Helper()
	mgr := testEncryptor(t)
	encrypted := map[string]string{}
	hints := map[string]string{}
	for name, value := range values {
		envelope, err := mgr.EncryptString(value)
		if err != nil {
			t.Fatalf("EncryptString: %v", err)
		}
		encrypted[name] = envelope
		hints[name] = MaskSecret(value)
	}
	encryptedJSON, err := json.Marshal(encrypted)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	hintsJSON, err := json.Marshal(hints)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if _, err := queries.UpsertTenantPaymentConfig(context.Background(), dbmodels.UpsertTenantPaymentConfigParams{
		TenantID:             tenantID,
		Provider:             provider,
		Enabled:              true,
		CredentialsEncrypted: encryptedJSON,
		CredentialHints:      hintsJSON,
	}); err != nil {
		t.Fatalf("UpsertTenantPaymentConfig: %v", err)
	}
}

func TestStoreLoadEnabledSecretsMissingRequiredFieldIsUnavailable(t *testing.T) {
	queries := newMemoryPaymentQueries()
	var logs bytes.Buffer
	store := newTestStore(t, queries, &memoryAuditQueries{}, &logs)
	tenantID := uuid.Must(uuid.NewV7())
	putRow(t, queries, tenantID, cardProviderID, map[string]string{cardSecretKey: testCardSecretKey})

	_, credentials, err := store.LoadEnabledSecrets(context.Background(), tenantID)
	if !errors.Is(err, ErrSecretMissing) || !IsUnavailable(err) {
		t.Fatalf("error = %v, want an unavailable ErrSecretMissing", err)
	}
	if credentials != nil {
		t.Fatal("failed load returned credentials")
	}
	if containsAny(logs.String(), testCardSecretKey) {
		t.Fatalf("logs leaked a secret: %s", logs.String())
	}

	cfg, err := store.GetPublic(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetPublic: %v", err)
	}
	if cfg.Ready {
		t.Fatal("settings missing a required field are ready")
	}
}

func TestStoreLoadEnabledSecretsUnregisteredProviderIsUnavailable(t *testing.T) {
	queries := newMemoryPaymentQueries()
	store := newTestStore(t, queries, &memoryAuditQueries{}, &bytes.Buffer{})
	tenantID := uuid.Must(uuid.NewV7())
	putRow(t, queries, tenantID, "retired", map[string]string{"api_key": "retired_key_0001"})

	if _, _, err := store.LoadEnabledSecrets(context.Background(), tenantID); !errors.Is(err, ErrProviderUnavailable) || !IsUnavailable(err) {
		t.Fatalf("error = %v, want an unavailable ErrProviderUnavailable", err)
	}
	cfg, err := store.GetPublic(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetPublic: %v", err)
	}
	if cfg.Provider != "retired" || cfg.Ready || len(cfg.Fields) != 0 {
		t.Fatalf("config = %+v, want the stored id with no fields and not ready", cfg)
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

	if _, err := store.Upsert(context.Background(), tenantA, stripeInput(true), AuditMeta{}); err != nil {
		t.Fatalf("upsert A: %v", err)
	}

	cfgB, err := store.GetPublic(context.Background(), tenantB)
	if err != nil {
		t.Fatalf("GetPublic B: %v", err)
	}
	if cfgB.Provider != "" || cfgB.Enabled || len(cfgB.Fields) != 0 {
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

	if _, err := store.Upsert(context.Background(), tenantID, stripeInput(true), AuditMeta{}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	encrypted, _ := storedMaps(t, queries, tenantID)

	other, err := secretcrypto.NewManager(map[string][]byte{
		"k2": bytes.Repeat([]byte{9}, 32),
	}, "k2")
	if err != nil {
		t.Fatalf("other manager: %v", err)
	}
	store.encryptor = other

	_, credentials, err := store.LoadEnabledSecrets(context.Background(), tenantID)
	if !errors.Is(err, ErrDecryptFailed) {
		t.Fatalf("error = %v, want ErrDecryptFailed", err)
	}
	if credentials != nil {
		t.Fatal("failed load returned credentials")
	}
	if containsAny(err.Error(), testSecretKey, testWebhookSecret, encrypted[stripe.FieldSecretKey]) {
		t.Fatalf("error leaked secret material: %v", err)
	}
	if containsAny(logs.String(), testSecretKey, testWebhookSecret) {
		t.Fatalf("logs leaked a secret: %s", logs.String())
	}
}
