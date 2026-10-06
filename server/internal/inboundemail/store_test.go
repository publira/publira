package inboundemail

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/inboundprovider/providers"
	"github.com/publira/publira/server/internal/inboundprovider/resend"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
)

func testEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{5}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

type memoryQueries struct {
	mu       sync.Mutex
	byTenant map[uuid.UUID]dbmodels.TenantInboundEmailConfig
}

func newMemoryQueries() *memoryQueries {
	return &memoryQueries{byTenant: map[uuid.UUID]dbmodels.TenantInboundEmailConfig{}}
}

func (m *memoryQueries) GetTenantInboundEmailConfigByTenantID(_ context.Context, tenantID uuid.UUID) (dbmodels.TenantInboundEmailConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.byTenant[tenantID]
	if !ok {
		return dbmodels.TenantInboundEmailConfig{}, sql.ErrNoRows
	}
	return row, nil
}

func (m *memoryQueries) GetEnabledTenantInboundEmailConfigByTenantID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantInboundEmailConfig, error) {
	row, err := m.GetTenantInboundEmailConfigByTenantID(ctx, tenantID)
	if err == nil && !row.Enabled {
		return dbmodels.TenantInboundEmailConfig{}, sql.ErrNoRows
	}
	return row, err
}

func (m *memoryQueries) UpsertTenantInboundEmailConfig(_ context.Context, arg dbmodels.UpsertTenantInboundEmailConfigParams) (dbmodels.TenantInboundEmailConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row := dbmodels.TenantInboundEmailConfig{
		TenantID:             arg.TenantID,
		Provider:             arg.Provider,
		Enabled:              arg.Enabled,
		Domain:               arg.Domain,
		CredentialsEncrypted: arg.CredentialsEncrypted,
		CredentialHints:      arg.CredentialHints,
	}
	m.byTenant[arg.TenantID] = row
	return row, nil
}

func newStore(t *testing.T) (*Store, *memoryQueries) {
	t.Helper()
	queries := newMemoryQueries()
	return New(queries, testEncryptor(t), providers.Registry(), nil, nil), queries
}

func replace(name, value string) FieldUpdate {
	return FieldUpdate{Name: name, Mode: secretupdate.Replace, Value: value}
}

func TestStoreUpsertEncryptsMasksAndIsReady(t *testing.T) {
	store, queries := newStore(t)
	tenantID := uuid.New()
	cfg, err := store.Upsert(t.Context(), tenantID, UpdateInput{
		Provider: resend.ID,
		Enabled:  true,
		Domain:   " Reply.Example.COM. ",
		Fields: []FieldUpdate{
			replace(resend.FieldAPIKey, "re_LiveSecretKey1234"),
			replace(resend.FieldWebhookSecret, "whsec_abcdefgh5678"),
		},
	}, AuditMeta{})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if !cfg.Ready || cfg.Domain != "reply.example.com" {
		t.Fatalf("config = %+v, want ready on reply.example.com", cfg)
	}
	if field, _ := cfg.Field(resend.FieldAPIKey); !field.Configured || field.Hint != "re_••••••••1234" {
		t.Fatalf("api_key = %+v", field)
	}
	row := queries.byTenant[tenantID]
	if bytes.Contains(row.CredentialsEncrypted, []byte("re_LiveSecretKey1234")) || bytes.Contains(row.CredentialHints, []byte("re_LiveSecretKey1234")) {
		t.Fatalf("the stored row holds a secret in plaintext")
	}

	loaded, credentials, err := store.LoadEnabledSecrets(t.Context(), tenantID)
	if err != nil {
		t.Fatalf("LoadEnabledSecrets: %v", err)
	}
	if credentials[resend.FieldAPIKey] != "re_LiveSecretKey1234" || credentials[resend.FieldWebhookSecret] != "whsec_abcdefgh5678" || !loaded.Ready {
		t.Fatalf("LoadEnabledSecrets = %+v, %v", loaded, credentials)
	}
}

func TestStoreRefusesToEnableWhatCannotReceiveMail(t *testing.T) {
	store, _ := newStore(t)
	token := []FieldUpdate{replace(sendgrid.FieldWebhookToken, "token")}
	cases := map[string]struct {
		input UpdateInput
		want  error
	}{
		"no domain":            {UpdateInput{Provider: sendgrid.ID, Enabled: true, Fields: token}, ErrDomainRequired},
		"no token":             {UpdateInput{Provider: sendgrid.ID, Enabled: true, Domain: "reply.example.com"}, ErrFieldsRequired},
		"an unknown provider":  {UpdateInput{Provider: "mailgun", Domain: "reply.example.com"}, ErrInvalidProvider},
		"an undeclared field":  {UpdateInput{Provider: sendgrid.ID, Fields: []FieldUpdate{replace("api_key", "x")}}, ErrUnknownField},
		"a field given twice":  {UpdateInput{Provider: sendgrid.ID, Fields: append(token, token...)}, ErrDuplicateField},
		"a blank replacement":  {UpdateInput{Provider: sendgrid.ID, Fields: []FieldUpdate{replace(sendgrid.FieldWebhookToken, " ")}}, ErrSecretRequired},
		"a domain with a path": {UpdateInput{Provider: sendgrid.ID, Domain: "reply.example.com/inbound"}, ErrInvalidDomain},
		"a single label":       {UpdateInput{Provider: sendgrid.ID, Domain: "localhost"}, ErrInvalidDomain},
		"an address":           {UpdateInput{Provider: sendgrid.ID, Domain: "contact@reply.example.com"}, ErrInvalidDomain},
		"a label too long":     {UpdateInput{Provider: sendgrid.ID, Domain: strings.Repeat("a", 64) + ".example.com"}, ErrInvalidDomain},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := store.Upsert(t.Context(), uuid.New(), tc.input, AuditMeta{}); !errors.Is(err, tc.want) {
				t.Fatalf("Upsert error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestStoreKeepsADisabledDraft(t *testing.T) {
	store, _ := newStore(t)
	tenantID := uuid.New()
	cfg, err := store.Upsert(t.Context(), tenantID, UpdateInput{Provider: sendgrid.ID}, AuditMeta{})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if cfg.Ready || cfg.Enabled || cfg.Domain != "" {
		t.Fatalf("config = %+v, want a disabled draft", cfg)
	}
	if _, _, err := store.LoadEnabledSecrets(t.Context(), tenantID); !IsUnavailable(err) {
		t.Fatalf("LoadEnabledSecrets error = %v, want unavailable", err)
	}
}

func TestStoreSwitchingProviderClearsThePreviousFields(t *testing.T) {
	store, _ := newStore(t)
	tenantID := uuid.New()
	if _, err := store.Upsert(t.Context(), tenantID, UpdateInput{
		Provider: sendgrid.ID,
		Enabled:  true,
		Domain:   "reply.example.com",
		Fields:   []FieldUpdate{replace(sendgrid.FieldWebhookToken, "token")},
	}, AuditMeta{}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	cfg, err := store.Upsert(t.Context(), tenantID, UpdateInput{Provider: resend.ID, Domain: "reply.example.com"}, AuditMeta{})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	for _, field := range cfg.Fields {
		if field.Configured {
			t.Fatalf("field %s is still stored after the provider changed", field.Name)
		}
	}
}

func TestStoreGetPublicOfATenantWithNoRow(t *testing.T) {
	store, _ := newStore(t)
	tenantID := uuid.New()
	cfg, err := store.GetPublic(t.Context(), tenantID)
	if err != nil {
		t.Fatalf("GetPublic: %v", err)
	}
	if cfg.TenantID != tenantID || cfg.Provider != "" || cfg.Ready {
		t.Fatalf("GetPublic = %+v", cfg)
	}
}

func TestReplyAddressRoundTrips(t *testing.T) {
	cfg := PublicConfig{Domain: "reply.example.com"}
	address := cfg.ReplyAddress("7Hn3QzW9kPfa")
	if address != "contact+7Hn3QzW9kPfa@reply.example.com" {
		t.Fatalf("ReplyAddress = %q", address)
	}
	for in, want := range map[string]string{
		address:                                   "7Hn3QzW9kPfa",
		"Contact+7Hn3QzW9kPfa@REPLY.example.com":  "7Hn3QzW9kPfa",
		"contact+7Hn3QzW9kPfa@other.example.com":  "",
		"support+7Hn3QzW9kPfa@reply.example.com":  "",
		"contact+@reply.example.com":              "",
		"contact+7Hn3-QzW9@reply.example.com":     "",
		"contact+7Hn3QzW9kPfa0@reply.example.com": "",
		"contact@reply.example.com":               "",
	} {
		got, ok := cfg.MessagePublicID(in)
		if got != want || ok != (want != "") {
			t.Errorf("MessagePublicID(%q) = (%q, %v), want %q", in, got, ok, want)
		}
	}
}

// The longest domain accepted is the longest whose per-message address still
// fits in a 254-byte mailbox.
func TestNormalizeDomainKeepsTheReplyAddressInAMailbox(t *testing.T) {
	longest := strings.Repeat("a", 63) + "." + strings.Repeat("b", 63) + "." + strings.Repeat("c", 63) + "." + strings.Repeat("d", 41)
	if len(longest) != 233 {
		t.Fatalf("the fixture is %d characters, want 233", len(longest))
	}
	domain, err := NormalizeDomain(longest)
	if err != nil {
		t.Fatalf("NormalizeDomain(233 characters): %v", err)
	}
	if address := (PublicConfig{Domain: domain}).ReplyAddress("ABCDEFGHJKLM"); len(address) != 254 {
		t.Fatalf("the reply address is %d bytes, want 254", len(address))
	}
	if _, err := NormalizeDomain(longest + "d"); !errors.Is(err, ErrInvalidDomain) {
		t.Fatalf("NormalizeDomain(234 characters) error = %v, want ErrInvalidDomain", err)
	}
}

func TestNormalizeDomainTakesAnInternationalizedName(t *testing.T) {
	// The handling of a non-ASCII name is what is under test.
	got, err := NormalizeDomain("返信.example.jp")
	if err != nil || got != "xn--vuqx27m.example.jp" {
		t.Fatalf("NormalizeDomain = (%q, %v)", got, err)
	}
}
