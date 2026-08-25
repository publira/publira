// Package paymentsettings stores tenant payment-provider credentials.
//
// Encrypted material never leaves this package except through [Store.LoadEnabledSecrets],
// which is the server-internal read boundary for Checkout and Webhook processing.
// Public reads return [PublicConfig] only: provider, enabled flag, configuration
// booleans, and masked hints. Callers must not log, persist, or attach [Secrets]
// to RPC responses or audit records.
package paymentsettings

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/secretcrypto"
)

const (
	ProviderStripe = "stripe"

	SecretUpdateModeUnspecified int32 = 0
	SecretUpdateModeUnchanged   int32 = 1
	SecretUpdateModeReplace     int32 = 2
	SecretUpdateModeClear       int32 = 3

	ActionUpdated = "tenant_payment_settings_updated"
	TargetType    = "payment_config"

	maskFill = "••••••••"
	maskTail = 4
)

var (
	ErrSecretManagerUnavailable = errors.New("secret manager is not configured")
	ErrSecretRequired           = errors.New("secret is required")
	ErrSecretsRequired          = errors.New("secret key and webhook signing secret are required when payment is enabled")
	ErrInvalidProvider          = errors.New("provider must be stripe")
	ErrInvalidSecretUpdateMode  = errors.New("invalid secret update mode")
	ErrEncryptFailed            = errors.New("failed to encrypt payment secret")
	ErrDecryptFailed            = errors.New("failed to decrypt payment secret")
	ErrInvalidCiphertext        = errors.New("payment secret is not an encrypted envelope")
	ErrSecretMissing            = errors.New("payment secret is not configured")
	ErrNotEnabled               = errors.New("tenant payment settings are not enabled")
)

type SecretManager interface {
	EncryptString(plaintext string) (string, error)
	DecryptString(value string) (string, error)
}

// PublicConfig is the non-secret view of a tenant's payment settings.
// It is safe to return from APIs and to log.
type PublicConfig struct {
	TenantID                uuid.UUID
	Provider                string
	Enabled                 bool
	SecretKeyConfigured     bool
	WebhookSecretConfigured bool
	SecretKeyHint           string
	WebhookSecretHint       string
	Ready                   bool
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

// Secrets is decrypted Stripe credential material. Only [Store.LoadEnabledSecrets]
// returns it. fmt, slog, and similar dump it as "redacted".
type Secrets struct {
	SecretKey     string
	WebhookSecret string
}

func (s Secrets) String() string {
	return "paymentsettings.Secrets{redacted}"
}

func (s Secrets) GoString() string {
	return s.String()
}

func (s Secrets) LogValue() slog.Value {
	return slog.StringValue("redacted")
}

type UpdateInput struct {
	Provider                string
	Enabled                 bool
	SecretKey               string
	SecretKeyUpdateMode     int32
	WebhookSecret           string
	WebhookSecretUpdateMode int32
}

type AuditMeta struct {
	ActorUserID uuid.UUID
	ActorRole   string
	ClientIP    string
	TargetID    string
}

func NormalizeProvider(provider string) (string, error) {
	provider = strings.TrimSpace(provider)
	if provider == "" {
		return ProviderStripe, nil
	}
	if provider != ProviderStripe {
		return "", ErrInvalidProvider
	}
	return provider, nil
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

func applySecretUpdate(existingEncrypted, existingHint string, mode int32, newPlaintext string, mgr SecretManager) (string, string, error) {
	switch mode {
	case SecretUpdateModeUnspecified, SecretUpdateModeUnchanged:
		return existingEncrypted, existingHint, nil
	case SecretUpdateModeReplace:
		return encryptSecret(newPlaintext, mgr)
	case SecretUpdateModeClear:
		return "", "", nil
	default:
		return "", "", fmt.Errorf("%w: %d", ErrInvalidSecretUpdateMode, mode)
	}
}

func encryptSecret(plaintext string, mgr SecretManager) (string, string, error) {
	if strings.TrimSpace(plaintext) == "" {
		return "", "", ErrSecretRequired
	}
	if mgr == nil {
		return "", "", ErrSecretManagerUnavailable
	}
	encrypted, err := mgr.EncryptString(plaintext)
	if err != nil {
		return "", "", ErrEncryptFailed
	}
	if !secretcrypto.IsEncryptedEnvelope(encrypted) {
		return "", "", ErrEncryptFailed
	}
	return encrypted, MaskSecret(plaintext), nil
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
