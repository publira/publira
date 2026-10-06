package inboundemail

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
)

// Querier is the persistence surface Store uses. Handlers should not call
// these queries directly: they return ciphertext.
type Querier interface {
	GetTenantInboundEmailConfigByTenantID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantInboundEmailConfig, error)
	GetEnabledTenantInboundEmailConfigByTenantID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantInboundEmailConfig, error)
	UpsertTenantInboundEmailConfig(ctx context.Context, arg dbmodels.UpsertTenantInboundEmailConfigParams) (dbmodels.TenantInboundEmailConfig, error)
}

// FieldUpdate changes one credential field.
type FieldUpdate struct {
	Name string
	Mode secretupdate.Mode
	// Value is read only when Mode is [secretupdate.Replace].
	Value string
}

type UpdateInput struct {
	Provider string
	Enabled  bool
	// Domain is written as it is given, normalised; an empty one clears it.
	Domain string
	// Fields the input leaves out are left as they are, unless the provider
	// changes, which clears every field stored for the previous one.
	Fields []FieldUpdate
}

type AuditMeta struct {
	ActorUserID uuid.UUID
	ActorRole   string
	ClientIP    string
	TargetID    string
}

type Store struct {
	queries   Querier
	encryptor SecretManager
	providers *inboundprovider.Registry
	recorder  auditlog.Recorder
	logger    *slog.Logger
}

// New answers a Store that validates settings against the providers in
// registry. The encryptor and the recorder may be nil for a caller that only
// reads [Store.GetPublic].
func New(queries Querier, encryptor SecretManager, registry *inboundprovider.Registry, recorder auditlog.Recorder, logger *slog.Logger) *Store {
	if logger == nil {
		logger = slog.Default()
	}
	return &Store{
		queries:   queries,
		encryptor: encryptor,
		providers: registry,
		recorder:  recorder,
		logger:    logger,
	}
}

// storedFields are a row's two maps, keyed by field name.
type storedFields struct {
	encrypted map[string]string
	hints     map[string]string
}

// GetPublic returns the non-secret configuration for tenantID. A missing row
// is an empty disabled config with no provider, not an error.
func (s *Store) GetPublic(ctx context.Context, tenantID uuid.UUID) (PublicConfig, error) {
	row, err := s.queries.GetTenantInboundEmailConfigByTenantID(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return PublicConfig{TenantID: tenantID}, nil
	}
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to load tenant inbound email settings",
			"tenant_id", tenantID,
			"error", err,
		)
		return PublicConfig{}, err
	}
	stored, err := decodeStoredFields(row)
	if err != nil {
		return PublicConfig{}, err
	}
	return s.publicConfig(row, stored), nil
}

// Upsert encrypts replaced fields, persists the row, and records a tenant
// audit event naming what it touched. The returned view never includes
// ciphertext or a secret value.
func (s *Store) Upsert(ctx context.Context, tenantID uuid.UUID, input UpdateInput, audit AuditMeta) (PublicConfig, error) {
	provider, ok := s.providers.Lookup(strings.TrimSpace(input.Provider))
	if !ok {
		return PublicConfig{}, ErrInvalidProvider
	}
	declaration := provider.Declaration()
	domain, err := NormalizeDomain(input.Domain)
	if err != nil {
		return PublicConfig{}, err
	}

	existing, err := s.queries.GetTenantInboundEmailConfigByTenantID(ctx, tenantID)
	found := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		s.logger.ErrorContext(ctx, "failed to load tenant inbound email settings",
			"tenant_id", tenantID,
			"error", err,
		)
		return PublicConfig{}, err
	}
	stored := storedFields{encrypted: map[string]string{}, hints: map[string]string{}}
	var touched []string
	if found && existing.Provider == declaration.ID {
		if stored, err = decodeStoredFields(existing); err != nil {
			return PublicConfig{}, err
		}
	} else if found {
		previous, err := decodeStoredFields(existing)
		if err != nil {
			return PublicConfig{}, err
		}
		for _, name := range slices.Sorted(maps.Keys(previous.encrypted)) {
			touched = append(touched, existing.Provider+"."+name)
		}
	}
	if !found || existing.Domain.String != domain {
		touched = append(touched, "domain")
	}

	seen := make(map[string]bool, len(input.Fields))
	for _, update := range input.Fields {
		field, ok := declaration.Field(update.Name)
		if !ok {
			return PublicConfig{}, fmt.Errorf("%w: %q", ErrUnknownField, update.Name)
		}
		if seen[field.Name] {
			return PublicConfig{}, fmt.Errorf("%w: %q", ErrDuplicateField, field.Name)
		}
		seen[field.Name] = true
		mode, err := secretupdate.Resolve(update.Mode, update.Value, ErrSecretRequired)
		if err != nil {
			return PublicConfig{}, fmt.Errorf("%s: %w", field.Name, err)
		}
		switch mode {
		case secretupdate.Replace:
			value := strings.TrimSpace(update.Value)
			encrypted, err := encryptValue(value, s.encryptor)
			if err != nil {
				return PublicConfig{}, err
			}
			stored.encrypted[field.Name] = encrypted
			stored.hints[field.Name] = hintFor(field, value)
			touched = append(touched, declaration.ID+"."+field.Name)
		case secretupdate.Clear:
			delete(stored.encrypted, field.Name)
			delete(stored.hints, field.Name)
			touched = append(touched, declaration.ID+"."+field.Name)
		}
	}

	if input.Enabled {
		if domain == "" {
			return PublicConfig{}, ErrDomainRequired
		}
		if missing := missingRequired(declaration, stored); len(missing) > 0 {
			return PublicConfig{}, fmt.Errorf("%w: %s", ErrFieldsRequired, strings.Join(missing, ", "))
		}
	}

	encrypted, err := json.Marshal(stored.encrypted)
	if err != nil {
		return PublicConfig{}, err
	}
	hints, err := json.Marshal(stored.hints)
	if err != nil {
		return PublicConfig{}, err
	}
	row, err := s.queries.UpsertTenantInboundEmailConfig(ctx, dbmodels.UpsertTenantInboundEmailConfigParams{
		TenantID:             tenantID,
		Provider:             declaration.ID,
		Enabled:              input.Enabled,
		Domain:               sql.NullString{String: domain, Valid: domain != ""},
		CredentialsEncrypted: encrypted,
		CredentialHints:      hints,
	})
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to persist tenant inbound email settings",
			"tenant_id", tenantID,
			"error", err,
		)
		return PublicConfig{}, err
	}

	s.recordUpdate(ctx, tenantID, audit, touchedReason(touched))
	return s.publicConfig(row, stored), nil
}

// LoadEnabledSecrets decrypts the tenant's enabled credentials, keyed by the
// field names the stored provider declares. This is the only method that
// returns plaintext. Missing, disabled, incomplete, or undecryptable
// configuration yields a sentinel error with no secret material.
func (s *Store) LoadEnabledSecrets(ctx context.Context, tenantID uuid.UUID) (PublicConfig, inboundprovider.Credentials, error) {
	row, err := s.queries.GetEnabledTenantInboundEmailConfigByTenantID(ctx, tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PublicConfig{}, nil, ErrNotEnabled
		}
		s.logger.ErrorContext(ctx, "failed to load enabled tenant inbound email settings",
			"tenant_id", tenantID,
			"error", err,
		)
		return PublicConfig{}, nil, err
	}
	provider, ok := s.providers.Lookup(row.Provider)
	if !ok {
		return PublicConfig{}, nil, ErrProviderUnavailable
	}
	if !row.Domain.Valid || row.Domain.String == "" {
		return PublicConfig{}, nil, ErrDomainRequired
	}
	stored, err := decodeStoredFields(row)
	if err != nil {
		return PublicConfig{}, nil, err
	}

	credentials := inboundprovider.Credentials{}
	for _, field := range provider.Declaration().Fields {
		encrypted, ok := stored.encrypted[field.Name]
		if !ok {
			if field.Required {
				return PublicConfig{}, nil, ErrSecretMissing
			}
			continue
		}
		value, err := decryptEnvelope(encrypted, s.encryptor)
		if err != nil {
			s.logger.ErrorContext(ctx, "failed to decrypt tenant inbound email credential",
				"tenant_id", tenantID,
				"provider", row.Provider,
				"field", field.Name,
				"error", err,
			)
			return PublicConfig{}, nil, err
		}
		credentials[field.Name] = value
	}
	return s.publicConfig(row, stored), credentials, nil
}

func (s *Store) recordUpdate(ctx context.Context, tenantID uuid.UUID, audit AuditMeta, reason string) {
	if s.recorder == nil || audit.ActorUserID == uuid.Nil {
		return
	}
	targetID := strings.TrimSpace(audit.TargetID)
	if targetID == "" {
		targetID = tenantID.String()
	}
	s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenantID,
		ActorUserID: audit.ActorUserID,
		ActorRole:   audit.ActorRole,
		Action:      ActionUpdated,
		TargetType:  TargetType,
		TargetID:    targetID,
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      reason,
		ClientIP:    audit.ClientIP,
	})
}

// touchedReason names what an update replaced or cleared — the domain, and
// the fields as provider.field — and never a value.
func touchedReason(touched []string) string {
	if len(touched) == 0 {
		return ""
	}
	return "fields: " + strings.Join(touched, ", ")
}

// publicConfig describes row by the fields its provider declares. A provider
// this build does not register has no fields and is never ready.
func (s *Store) publicConfig(row dbmodels.TenantInboundEmailConfig, stored storedFields) PublicConfig {
	config := PublicConfig{
		TenantID:  row.TenantID,
		Provider:  row.Provider,
		Enabled:   row.Enabled,
		Domain:    row.Domain.String,
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
	provider, ok := s.providers.Lookup(row.Provider)
	if !ok {
		return config
	}
	declaration := provider.Declaration()
	for _, field := range declaration.Fields {
		_, configured := stored.encrypted[field.Name]
		state := FieldState{Name: field.Name, Configured: configured}
		if configured {
			state.Hint = stored.hints[field.Name]
		}
		config.Fields = append(config.Fields, state)
	}
	config.Ready = row.Enabled && config.Domain != "" && len(missingRequired(declaration, stored)) == 0
	return config
}

// missingRequired names the required fields of declaration that stored does
// not hold.
func missingRequired(declaration inboundprovider.Declaration, stored storedFields) []string {
	return declaration.Missing(inboundprovider.Credentials(stored.encrypted))
}

// hintFor answers what the console shows for a stored value of field.
func hintFor(field inboundprovider.Field, value string) string {
	if field.Secret {
		return paymentsettings.MaskSecret(value)
	}
	return value
}

func decodeStoredFields(row dbmodels.TenantInboundEmailConfig) (storedFields, error) {
	stored := storedFields{encrypted: map[string]string{}, hints: map[string]string{}}
	if len(row.CredentialsEncrypted) > 0 {
		if err := json.Unmarshal(row.CredentialsEncrypted, &stored.encrypted); err != nil {
			return storedFields{}, fmt.Errorf("decode stored inbound email credentials: %w", err)
		}
	}
	if len(row.CredentialHints) > 0 {
		if err := json.Unmarshal(row.CredentialHints, &stored.hints); err != nil {
			return storedFields{}, fmt.Errorf("decode stored inbound email credential hints: %w", err)
		}
	}
	return stored, nil
}

func encryptValue(plaintext string, mgr SecretManager) (string, error) {
	if mgr == nil {
		return "", ErrSecretManagerUnavailable
	}
	encrypted, err := mgr.EncryptString(plaintext)
	if err != nil || !secretcrypto.IsEncryptedEnvelope(encrypted) {
		return "", ErrEncryptFailed
	}
	return encrypted, nil
}

func decryptEnvelope(encrypted string, mgr SecretManager) (string, error) {
	if strings.TrimSpace(encrypted) == "" {
		return "", ErrSecretMissing
	}
	if mgr == nil {
		return "", ErrSecretManagerUnavailable
	}
	if !secretcrypto.IsEncryptedEnvelope(encrypted) {
		return "", ErrInvalidCiphertext
	}
	plaintext, err := mgr.DecryptString(encrypted)
	if err != nil {
		return "", ErrDecryptFailed
	}
	if strings.TrimSpace(plaintext) == "" {
		return "", ErrSecretMissing
	}
	return plaintext, nil
}
