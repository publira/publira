// Package fcmsettings holds each tenant's Firebase Cloud Messaging credentials:
// the project its mobile app is built with, and the service account key the
// worker sends that app's push notifications as.
//
// The key is sealed before it is stored and opened only by [Senders]. What
// [Store] answers, [Settings], names the project and the account and never the
// key, so it is safe to return from an RPC and to log.
package fcmsettings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/push"
	"github.com/publira/publira/server/internal/secretcrypto"
)

const (
	ActionSaved   = "tenant_fcm_credentials_saved"
	ActionDeleted = "tenant_fcm_credentials_deleted"
	TargetType    = "fcm_config"
)

var (
	ErrSecretManagerUnavailable = errors.New("secret manager is not configured")
	// ErrNotConfigured is what a sender answers for a tenant with no
	// credentials stored.
	ErrNotConfigured      = errors.New("mobile push is not configured for this tenant")
	ErrProjectIDRequired  = errors.New("project id is required")
	ErrProjectMismatch    = errors.New("the service account key belongs to a different project")
	ErrEncryptFailed      = errors.New("failed to encrypt the service account key")
	ErrInvalidCiphertext  = errors.New("stored service account key is not an encrypted envelope")
	ErrInvalidCredentials = push.ErrInvalidServiceAccount
)

// SecretManager seals and opens the stored key.
type SecretManager interface {
	EncryptString(plaintext string) (string, error)
	DecryptString(value string) (string, error)
}

// Settings is the stored credentials as a caller may see them.
type Settings struct {
	Configured  bool
	ProjectID   string
	ClientEmail string
	UpdatedAt   time.Time
}

func settingsFromRow(row dbmodels.TenantFcmConfig) Settings {
	return Settings{
		Configured:  true,
		ProjectID:   row.ProjectID,
		ClientEmail: row.ClientEmail,
		UpdatedAt:   row.UpdatedAt,
	}
}

// Credentials is what a tenant's push is sent with.
type Credentials struct {
	ProjectID          string
	ServiceAccountJSON string
}

// String, GoString and LogValue keep the key out of whatever formats a
// Credentials, which is how a mistaken %v or log argument stops being a leak.
func (c Credentials) String() string {
	return "fcmsettings.Credentials{redacted}"
}

func (c Credentials) GoString() string {
	return c.String()
}

func (c Credentials) LogValue() slog.Value {
	return slog.StringValue("redacted")
}

// Validate checks a submitted key and the project it is meant for, answering
// what the key says about itself. The project has to be the key's own: a key
// from another project is almost always the wrong file.
func Validate(projectID, serviceAccountJSON string) (push.ServiceAccount, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return push.ServiceAccount{}, ErrProjectIDRequired
	}
	account, err := push.ParseServiceAccount([]byte(serviceAccountJSON))
	if err != nil {
		return push.ServiceAccount{}, err
	}
	if account.ProjectID != projectID {
		return push.ServiceAccount{}, ErrProjectMismatch
	}
	return account, nil
}

// Querier is the persistence Store uses. Handlers do not call these queries
// themselves: the row carries the sealed key.
type Querier interface {
	GetTenantFcmConfig(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantFcmConfig, error)
	UpsertTenantFcmConfig(ctx context.Context, arg dbmodels.UpsertTenantFcmConfigParams) (dbmodels.TenantFcmConfig, error)
	DeleteTenantFcmConfig(ctx context.Context, tenantID uuid.UUID) (int64, error)
}

// AuditMeta is who asked for a change.
type AuditMeta struct {
	ActorUserID uuid.UUID
	ActorRole   string
	ClientIP    string
	TargetID    string
}

// Store reads and writes one tenant's credentials, recording every change.
type Store struct {
	queries   Querier
	encryptor SecretManager
	recorder  auditlog.Recorder
}

func New(queries Querier, encryptor SecretManager, recorder auditlog.Recorder) *Store {
	return &Store{queries: queries, encryptor: encryptor, recorder: recorder}
}

// Get answers the stored credentials' description. A tenant without a row is
// not an error: it is Settings with Configured false.
func (s *Store) Get(ctx context.Context, tenantID uuid.UUID) (Settings, error) {
	row, err := s.queries.GetTenantFcmConfig(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("read fcm settings: %w", err)
	}
	return settingsFromRow(row), nil
}

// Save validates, seals and stores the credentials, replacing any already
// stored.
func (s *Store) Save(ctx context.Context, tenantID uuid.UUID, projectID, serviceAccountJSON string, audit AuditMeta) (Settings, error) {
	account, err := Validate(projectID, serviceAccountJSON)
	if err != nil {
		return Settings{}, err
	}
	if s.encryptor == nil {
		return Settings{}, ErrSecretManagerUnavailable
	}
	sealed, err := s.encryptor.EncryptString(serviceAccountJSON)
	if err != nil || !secretcrypto.IsEncryptedEnvelope(sealed) {
		return Settings{}, ErrEncryptFailed
	}
	row, err := s.queries.UpsertTenantFcmConfig(ctx, dbmodels.UpsertTenantFcmConfigParams{
		TenantID:                    tenantID,
		ProjectID:                   account.ProjectID,
		ClientEmail:                 account.ClientEmail,
		ServiceAccountJsonEncrypted: sealed,
	})
	if err != nil {
		return Settings{}, fmt.Errorf("store fcm settings: %w", err)
	}
	s.record(ctx, tenantID, ActionSaved, audit)
	return settingsFromRow(row), nil
}

// Delete removes the stored credentials. Removing none is not an error, and
// records nothing.
func (s *Store) Delete(ctx context.Context, tenantID uuid.UUID, audit AuditMeta) error {
	deleted, err := s.queries.DeleteTenantFcmConfig(ctx, tenantID)
	if err != nil {
		return fmt.Errorf("delete fcm settings: %w", err)
	}
	if deleted > 0 {
		s.record(ctx, tenantID, ActionDeleted, audit)
	}
	return nil
}

func (s *Store) record(ctx context.Context, tenantID uuid.UUID, action string, audit AuditMeta) {
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
		Action:      action,
		TargetType:  TargetType,
		TargetID:    targetID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    audit.ClientIP,
	})
}

// open unseals a stored row's key.
func open(row dbmodels.TenantFcmConfig, mgr SecretManager) (Credentials, error) {
	if mgr == nil {
		return Credentials{}, ErrSecretManagerUnavailable
	}
	if !secretcrypto.IsEncryptedEnvelope(row.ServiceAccountJsonEncrypted) {
		return Credentials{}, ErrInvalidCiphertext
	}
	key, err := mgr.DecryptString(row.ServiceAccountJsonEncrypted)
	if err != nil {
		return Credentials{}, fmt.Errorf("decrypt the service account key: %w", err)
	}
	return Credentials{ProjectID: row.ProjectID, ServiceAccountJSON: key}, nil
}
