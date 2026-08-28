package paymentsettings

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
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
	recorder  auditlog.Recorder
	logger    *slog.Logger
}

func New(queries PaymentQuerier, encryptor SecretManager, recorder auditlog.Recorder, logger *slog.Logger) *Store {
	if logger == nil {
		logger = slog.Default()
	}
	return &Store{
		queries:   queries,
		encryptor: encryptor,
		recorder:  recorder,
		logger:    logger,
	}
}

// GetPublic returns the non-secret configuration for tenantID. A missing row
// is an empty disabled Stripe config, not an error.
func (s *Store) GetPublic(ctx context.Context, tenantID uuid.UUID) (PublicConfig, error) {
	row, ok, err := s.loadRow(ctx, tenantID)
	if err != nil {
		return PublicConfig{}, err
	}
	if !ok {
		return emptyPublicConfig(tenantID), nil
	}
	return publicConfigFromRow(row), nil
}

// Upsert encrypts replaced secrets, persists the row, and records a tenant
// audit event. The returned view never includes ciphertext or plaintext.
func (s *Store) Upsert(ctx context.Context, tenantID uuid.UUID, input UpdateInput, audit AuditMeta) (PublicConfig, error) {
	provider, err := NormalizeProvider(input.Provider)
	if err != nil {
		return PublicConfig{}, err
	}

	existing, _, err := s.loadRow(ctx, tenantID)
	if err != nil {
		return PublicConfig{}, err
	}

	secretKeyEncrypted, secretKeyHint, err := applySecretUpdate(
		nullStringValue(existing.SecretKeyEncrypted),
		nullStringValue(existing.SecretKeyHint),
		input.SecretKeyUpdateMode,
		input.SecretKey,
		s.encryptor,
	)
	if err != nil {
		return PublicConfig{}, err
	}
	webhookEncrypted, webhookHint, err := applySecretUpdate(
		nullStringValue(existing.WebhookSecretEncrypted),
		nullStringValue(existing.WebhookSecretHint),
		input.WebhookSecretUpdateMode,
		input.WebhookSecret,
		s.encryptor,
	)
	if err != nil {
		return PublicConfig{}, err
	}

	if input.Enabled && (secretKeyEncrypted == "" || webhookEncrypted == "") {
		return PublicConfig{}, ErrSecretsRequired
	}

	row, err := s.queries.UpsertTenantPaymentConfig(ctx, dbmodels.UpsertTenantPaymentConfigParams{
		TenantID:               tenantID,
		Provider:               provider,
		Enabled:                input.Enabled,
		SecretKeyEncrypted:     nullableString(secretKeyEncrypted),
		WebhookSecretEncrypted: nullableString(webhookEncrypted),
		SecretKeyHint:          nullableString(secretKeyHint),
		WebhookSecretHint:      nullableString(webhookHint),
	})
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to persist tenant payment settings",
			"tenant_id", tenantID,
			"error", err,
		)
		return PublicConfig{}, err
	}

	s.recordUpdate(ctx, tenantID, audit, auditlog.OutcomeSuccess, "")
	return publicConfigFromRow(row), nil
}

// LoadEnabledSecrets decrypts the tenant's enabled Stripe credentials.
// This is the only method that returns plaintext. Missing, disabled, or
// undecryptable configuration yields a sentinel error with no secret material.
func (s *Store) LoadEnabledSecrets(ctx context.Context, tenantID uuid.UUID) (PublicConfig, Secrets, error) {
	row, err := s.queries.GetEnabledTenantPaymentConfigByTenantID(ctx, tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PublicConfig{}, Secrets{}, ErrNotEnabled
		}
		s.logger.ErrorContext(ctx, "failed to load enabled tenant payment settings",
			"tenant_id", tenantID,
			"error", err,
		)
		return PublicConfig{}, Secrets{}, err
	}

	secretKey, err := decryptEnvelope(nullStringValue(row.SecretKeyEncrypted), s.encryptor)
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to decrypt tenant payment secret key",
			"tenant_id", tenantID,
			"error", err,
		)
		return PublicConfig{}, Secrets{}, err
	}
	webhookSecret, err := decryptEnvelope(nullStringValue(row.WebhookSecretEncrypted), s.encryptor)
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to decrypt tenant payment webhook secret",
			"tenant_id", tenantID,
			"error", err,
		)
		return PublicConfig{}, Secrets{}, err
	}

	return publicConfigFromRow(row), Secrets{
		SecretKey:     secretKey,
		WebhookSecret: webhookSecret,
	}, nil
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
		Outcome:     outcome,
		Reason:      reason,
		ClientIP:    audit.ClientIP,
	})
}

func publicConfigFromRow(row dbmodels.TenantPaymentConfig) PublicConfig {
	secretConfigured := strings.TrimSpace(nullStringValue(row.SecretKeyEncrypted)) != ""
	webhookConfigured := strings.TrimSpace(nullStringValue(row.WebhookSecretEncrypted)) != ""
	return PublicConfig{
		TenantID:                row.TenantID,
		Provider:                row.Provider,
		Enabled:                 row.Enabled,
		SecretKeyConfigured:     secretConfigured,
		WebhookSecretConfigured: webhookConfigured,
		SecretKeyHint:           nullStringValue(row.SecretKeyHint),
		WebhookSecretHint:       nullStringValue(row.WebhookSecretHint),
		Ready:                   row.Enabled && secretConfigured && webhookConfigured,
		CreatedAt:               row.CreatedAt,
		UpdatedAt:               row.UpdatedAt,
	}
}

func emptyPublicConfig(tenantID uuid.UUID) PublicConfig {
	return PublicConfig{
		TenantID: tenantID,
		Provider: ProviderStripe,
	}
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
