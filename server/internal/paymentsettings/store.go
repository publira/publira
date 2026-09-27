package paymentsettings

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
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/secretupdate"
)

// PaymentQuerier is the persistence surface Store uses. Handlers should not
// call these queries directly: they return ciphertext.
type PaymentQuerier interface {
	GetTenantPaymentConfigByTenantID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantPaymentConfig, error)
	GetEnabledTenantPaymentConfigByTenantID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantPaymentConfig, error)
	UpsertTenantPaymentConfig(ctx context.Context, arg dbmodels.UpsertTenantPaymentConfigParams) (dbmodels.TenantPaymentConfig, error)
}

type Store struct {
	queries   PaymentQuerier
	encryptor SecretManager
	providers *paymentprovider.Registry
	recorder  auditlog.Recorder
	logger    *slog.Logger
}

// New answers a Store that validates settings against the providers in
// registry.
func New(queries PaymentQuerier, encryptor SecretManager, registry *paymentprovider.Registry, recorder auditlog.Recorder, logger *slog.Logger) *Store {
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
	row, ok, err := s.loadRow(ctx, tenantID)
	if err != nil {
		return PublicConfig{}, err
	}
	if !ok {
		return PublicConfig{TenantID: tenantID}, nil
	}
	stored, err := decodeStoredFields(row)
	if err != nil {
		return PublicConfig{}, err
	}
	return s.publicConfig(row, stored), nil
}

// Upsert encrypts replaced fields, persists the row, and records a tenant
// audit event naming the fields it touched. The returned view never includes
// ciphertext or a secret value.
func (s *Store) Upsert(ctx context.Context, tenantID uuid.UUID, input UpdateInput, audit AuditMeta) (PublicConfig, error) {
	provider, ok := s.providers.Lookup(strings.TrimSpace(input.Provider))
	if !ok {
		return PublicConfig{}, ErrInvalidProvider
	}
	declaration := provider.Declaration()

	existing, found, err := s.loadRow(ctx, tenantID)
	if err != nil {
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
	row, err := s.queries.UpsertTenantPaymentConfig(ctx, dbmodels.UpsertTenantPaymentConfigParams{
		TenantID:             tenantID,
		Provider:             declaration.ID,
		Enabled:              input.Enabled,
		CredentialsEncrypted: encrypted,
		CredentialHints:      hints,
	})
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to persist tenant payment settings",
			"tenant_id", tenantID,
			"error", err,
		)
		return PublicConfig{}, err
	}

	s.recordUpdate(ctx, tenantID, audit, auditlog.OutcomeSuccess, touchedReason(touched))
	return s.publicConfig(row, stored), nil
}

// LoadEnabledSecrets decrypts the tenant's enabled credentials, keyed by the
// field names the stored provider declares. This is the only method that
// returns plaintext. Missing, disabled, incomplete, or undecryptable
// configuration yields a sentinel error with no secret material.
func (s *Store) LoadEnabledSecrets(ctx context.Context, tenantID uuid.UUID) (PublicConfig, paymentprovider.Credentials, error) {
	row, err := s.queries.GetEnabledTenantPaymentConfigByTenantID(ctx, tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PublicConfig{}, nil, ErrNotEnabled
		}
		s.logger.ErrorContext(ctx, "failed to load enabled tenant payment settings",
			"tenant_id", tenantID,
			"error", err,
		)
		return PublicConfig{}, nil, err
	}
	provider, ok := s.providers.Lookup(row.Provider)
	if !ok {
		s.logger.ErrorContext(ctx, "tenant payment provider is not registered",
			"tenant_id", tenantID,
			"provider", row.Provider,
		)
		return PublicConfig{}, nil, ErrProviderUnavailable
	}
	stored, err := decodeStoredFields(row)
	if err != nil {
		return PublicConfig{}, nil, err
	}

	credentials := paymentprovider.Credentials{}
	for _, field := range provider.Declaration().Fields {
		encrypted, ok := stored.encrypted[field.Name]
		if !ok {
			if field.Required {
				s.logger.ErrorContext(ctx, "tenant payment credential is not configured",
					"tenant_id", tenantID,
					"provider", row.Provider,
					"field", field.Name,
				)
				return PublicConfig{}, nil, ErrSecretMissing
			}
			continue
		}
		value, err := decryptEnvelope(encrypted, s.encryptor)
		if err != nil {
			s.logger.ErrorContext(ctx, "failed to decrypt tenant payment credential",
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

func (s *Store) loadRow(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantPaymentConfig, bool, error) {
	row, err := s.queries.GetTenantPaymentConfigByTenantID(ctx, tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.TenantPaymentConfig{}, false, nil
		}
		s.logger.ErrorContext(ctx, "failed to load tenant payment settings",
			"tenant_id", tenantID,
			"error", err,
		)
		return dbmodels.TenantPaymentConfig{}, false, err
	}
	return row, true, nil
}

func (s *Store) recordUpdate(ctx context.Context, tenantID uuid.UUID, audit AuditMeta, outcome, reason string) {
	RecordUpdate(ctx, s.recorder, tenantID, audit, outcome, reason)
}

// RecordUpdate records a change to a tenant's payment settings, a web
// provider's or the stores'. A caller that wrote in a transaction calls it
// once that commits.
func RecordUpdate(ctx context.Context, recorder auditlog.Recorder, tenantID uuid.UUID, audit AuditMeta, outcome, reason string) {
	if recorder == nil || audit.ActorUserID == uuid.Nil {
		return
	}
	targetID := strings.TrimSpace(audit.TargetID)
	if targetID == "" {
		targetID = tenantID.String()
	}
	recorder.RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenantID,
		ActorUserID: audit.ActorUserID,
		ActorRole:   audit.ActorRole,
		Action:      ActionUpdated,
		TargetType:  TargetType,
		TargetID:    targetID,
		Outcome:     outcome,
		Reason:      reason,
		ClientIP:    audit.ClientIP,
	})
}

// touchedReason names the fields an update replaced or cleared, as
// provider.field, and never a value.
func touchedReason(touched []string) string {
	if len(touched) == 0 {
		return ""
	}
	return "fields: " + strings.Join(touched, ", ")
}

// publicConfig describes row by the fields its provider declares. A provider
// this build does not register has no fields and is never ready.
func (s *Store) publicConfig(row dbmodels.TenantPaymentConfig, stored storedFields) PublicConfig {
	config := PublicConfig{
		TenantID:  row.TenantID,
		Provider:  row.Provider,
		Enabled:   row.Enabled,
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
			if field.Public {
				state.PublicValue = stored.hints[field.Name]
			}
		}
		config.Fields = append(config.Fields, state)
	}
	config.Ready = row.Enabled && len(missingRequired(declaration, stored)) == 0
	return config
}

// missingRequired names the required fields of declaration that stored does
// not hold.
func missingRequired(declaration paymentprovider.Declaration, stored storedFields) []string {
	return declaration.Missing(paymentprovider.Credentials(stored.encrypted))
}

func decodeStoredFields(row dbmodels.TenantPaymentConfig) (storedFields, error) {
	stored := storedFields{encrypted: map[string]string{}, hints: map[string]string{}}
	if len(row.CredentialsEncrypted) > 0 {
		if err := json.Unmarshal(row.CredentialsEncrypted, &stored.encrypted); err != nil {
			return storedFields{}, fmt.Errorf("decode stored payment credentials: %w", err)
		}
	}
	if len(row.CredentialHints) > 0 {
		if err := json.Unmarshal(row.CredentialHints, &stored.hints); err != nil {
			return storedFields{}, fmt.Errorf("decode stored payment credential hints: %w", err)
		}
	}
	return stored, nil
}

func nullableString(value string) sql.NullString {
	if strings.TrimSpace(value) == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: value, Valid: true}
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}
