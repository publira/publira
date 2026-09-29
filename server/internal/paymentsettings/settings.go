// Package paymentsettings stores a tenant's web payment provider and the
// credential fields that provider declares.
//
// Encrypted material never leaves this package except through [Store.LoadEnabledSecrets],
// which is the server-internal read boundary for Checkout and Webhook processing.
// Public reads return [PublicConfig] only: provider, enabled flag, and per field
// whether it is stored, its masked hint, and the value of a public field.
// Callers must not log, persist, or attach the credentials LoadEnabledSecrets
// answers to RPC responses or audit records.
package paymentsettings

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
)

const (
	ActionUpdated = "tenant_payment_settings_updated"
	TargetType    = "payment_config"

	maskFill = "••••••••"
	maskTail = 4
)

var (
	ErrSecretManagerUnavailable = errors.New("secret manager is not configured")
	ErrSecretRequired           = errors.New("secret is required")
	ErrFieldsRequired           = errors.New("every required credential field must be stored when payment is enabled")
	ErrInvalidProvider          = errors.New("provider is not registered")
	ErrUnknownField             = errors.New("credential field is not declared by the provider")
	ErrDuplicateField           = errors.New("credential field is updated twice")
	ErrEncryptFailed            = errors.New("failed to encrypt payment credential")
	ErrDecryptFailed            = errors.New("failed to decrypt payment credential")
	ErrInvalidCiphertext        = errors.New("payment credential is not an encrypted envelope")
	ErrSecretMissing            = errors.New("required payment credential is not configured")
	ErrNotEnabled               = errors.New("tenant payment settings are not enabled")
	ErrProviderUnavailable      = errors.New("stored payment provider is not registered")
)

// IsUnavailable reports errors that mean Checkout and Webhook must not run:
// missing or disabled settings, a provider this build does not register, a
// missing required field, or a decrypt failure. Other errors (for example a
// database outage) are not unavailable in this sense and should surface as
// internal failures.
func IsUnavailable(err error) bool {
	return errors.Is(err, ErrNotEnabled) ||
		errors.Is(err, ErrProviderUnavailable) ||
		errors.Is(err, ErrDecryptFailed) ||
		errors.Is(err, ErrInvalidCiphertext) ||
		errors.Is(err, ErrSecretMissing) ||
		errors.Is(err, ErrSecretManagerUnavailable)
}

type SecretManager interface {
	EncryptString(plaintext string) (string, error)
	DecryptString(value string) (string, error)
}

// FieldState is what is stored for one field the provider declares.
type FieldState struct {
	Name       string
	Configured bool
	// Hint is the masked value of a secret field and the value itself of any
	// other, derived when it was stored.
	Hint string
	// PublicValue is the stored value of a field the provider declares public,
	// and empty for every other field.
	PublicValue string
}

// PublicConfig is the non-secret view of a tenant's payment settings.
// It is safe to return from APIs and to log.
type PublicConfig struct {
	TenantID uuid.UUID
	// Provider is empty until the tenant saves one.
	Provider string
	Enabled  bool
	// Fields has one entry per field the provider declares, in its order.
	Fields    []FieldState
	Ready     bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Field answers the state of the field named name.
func (c PublicConfig) Field(name string) (FieldState, bool) {
	for _, field := range c.Fields {
		if field.Name == name {
			return field, true
		}
	}
	return FieldState{}, false
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

// MaskSecret turns a live credential into a display hint (prefix + bullets +
// last four characters). The result is stored alongside ciphertext so public
// reads never decrypt.
func MaskSecret(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	prefix, rest := splitSecretPrefix(value)
	if len(rest) <= maskTail {
		return prefix + strings.Repeat("•", 4)
	}
	return prefix + maskFill + rest[len(rest)-maskTail:]
}

func splitSecretPrefix(value string) (string, string) {
	i := strings.LastIndex(value, "_")
	if i < 0 || i == len(value)-1 {
		return "", value
	}
	return value[:i+1], value[i+1:]
}

// hintFor answers what the console shows for a stored value of field.
func hintFor(field paymentprovider.Field, value string) string {
	if field.Secret {
		return MaskSecret(value)
	}
	return value
}

func applySecretUpdate(existingEncrypted, existingHint string, mode secretupdate.Mode, newPlaintext string, mgr SecretManager) (string, string, error) {
	resolved, err := secretupdate.Resolve(mode, newPlaintext, ErrSecretRequired)
	if err != nil {
		return "", "", err
	}
	switch resolved {
	case secretupdate.Replace:
		return encryptSecret(newPlaintext, mgr)
	case secretupdate.Clear:
		return "", "", nil
	default:
		return existingEncrypted, existingHint, nil
	}
}

func encryptSecret(plaintext string, mgr SecretManager) (string, string, error) {
	encrypted, err := encryptValue(plaintext, mgr)
	if err != nil {
		return "", "", err
	}
	return encrypted, MaskSecret(plaintext), nil
}

func encryptValue(plaintext string, mgr SecretManager) (string, error) {
	if mgr == nil {
		return "", ErrSecretManagerUnavailable
	}
	encrypted, err := mgr.EncryptString(plaintext)
	if err != nil {
		return "", ErrEncryptFailed
	}
	if !secretcrypto.IsEncryptedEnvelope(encrypted) {
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
