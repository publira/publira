// Package signin signs readers in with Apple and Google: the providers a
// tenant enables, the ID tokens they issue, and the Apple tokens the server
// keeps so that it can revoke them.
//
// The Sign in with Apple key leaves this package decrypted only through
// [Settings.LoadAppleCredentials], which the worker uses to exchange and
// revoke tokens. Reads for the consoles and the storefront return [Config].
package signin

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"regexp"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
)

// ProviderApple and ProviderGoogle are the values user_identities.provider
// takes.
const (
	ProviderApple  = "apple"
	ProviderGoogle = "google"
)

// ActionSettingsUpdated is the audit action of a change to the settings.
const ActionSettingsUpdated = "tenant_sign_in_settings_updated"

var (
	ErrInvalidServicesID        = errors.New("services ID must be two or more dot-separated segments of letters, digits, and hyphens")
	ErrInvalidTeamID            = errors.New("team ID must be ten capital letters and digits")
	ErrInvalidKeyID             = errors.New("key ID must be ten capital letters and digits")
	ErrInvalidPrivateKey        = errors.New("private key must be a PKCS #8 P-256 key in PEM form")
	ErrAppleCredentialsRequired = errors.New("team ID, key ID, and private key are required when Apple sign-in is enabled")
	ErrInvalidGoogleClientID    = errors.New("client ID must end in .apps.googleusercontent.com")
	ErrGoogleClientRequired     = errors.New("a client ID is required when Google sign-in is enabled")
	ErrSecretManagerUnavailable = errors.New("secret manager is not configured")
	ErrPrivateKeyRequired       = errors.New("private key is required")
	ErrEncryptFailed            = errors.New("failed to encrypt a sign-in credential")
	ErrDecryptFailed            = errors.New("failed to decrypt a sign-in credential")
	ErrAppleNotConfigured       = errors.New("apple sign-in has no key to sign with")
)

var (
	servicesIDPattern     = regexp.MustCompile(`^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$`)
	appleIDPattern        = regexp.MustCompile(`^[A-Z0-9]{10}$`)
	googleClientIDPattern = regexp.MustCompile(`^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$`)
)

// SecretManager encrypts the Sign in with Apple key and the refresh tokens.
type SecretManager interface {
	EncryptString(plaintext string) (string, error)
	DecryptString(value string) (string, error)
}

// Querier is the persistence surface [Settings] uses. Its reads return
// ciphertext.
type Querier interface {
	GetTenantConfigByTenantID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantConfig, error)
	GetTenantAppleSignInConfig(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantAppleSignInConfig, error)
	GetTenantGoogleSignInConfig(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantGoogleSignInConfig, error)
	UpsertTenantAppleSignInConfig(ctx context.Context, arg dbmodels.UpsertTenantAppleSignInConfigParams) (dbmodels.TenantAppleSignInConfig, error)
	UpsertTenantGoogleSignInConfig(ctx context.Context, arg dbmodels.UpsertTenantGoogleSignInConfigParams) (dbmodels.TenantGoogleSignInConfig, error)
}

// AppleConfig is the non-secret view of a tenant's Sign in with Apple
// settings. BundleIdentifier comes from the tenant's iOS app association.
type AppleConfig struct {
	Enabled              bool
	ServicesID           string
	TeamID               string
	KeyID                string
	PrivateKeyConfigured bool
	PrivateKeyHint       string
	BundleIdentifier     string
	Ready                bool
}

// Audiences are the client IDs an Apple ID token of the tenant is issued to.
func (c AppleConfig) Audiences() []string {
	return nonEmpty(c.ServicesID, c.BundleIdentifier)
}

// GoogleConfig is a tenant's Google sign-in settings, all of them public.
type GoogleConfig struct {
	Enabled     bool
	WebClientID string
	IOSClientID string
	Ready       bool
}

// Audiences are the client IDs a Google ID token of the tenant is issued to.
func (c GoogleConfig) Audiences() []string {
	return nonEmpty(c.WebClientID, c.IOSClientID)
}

// Config is how readers of a tenant sign in. It is safe to return from APIs
// and to log.
type Config struct {
	Apple  AppleConfig
	Google GoogleConfig
}

type AppleUpdate struct {
	Enabled              bool
	ServicesID           string
	TeamID               string
	KeyID                string
	PrivateKey           string
	PrivateKeyUpdateMode secretupdate.Mode
}

type GoogleUpdate struct {
	Enabled     bool
	WebClientID string
	IOSClientID string
}

type UpdateInput struct {
	Apple  AppleUpdate
	Google GoogleUpdate
}

// AppleCredentials sign the client secret Apple's token endpoints take. They
// are secret and are never logged or returned.
type AppleCredentials struct {
	TeamID     string
	KeyID      string
	PrivateKey string
}

// Settings reads and writes a tenant's sign-in settings.
type Settings struct {
	queries   Querier
	encryptor SecretManager
}

func NewSettings(queries Querier, encryptor SecretManager) *Settings {
	return &Settings{queries: queries, encryptor: encryptor}
}

// Get returns the non-secret view. A tenant that has saved nothing has both
// providers disabled.
func (s *Settings) Get(ctx context.Context, tenantID uuid.UUID) (Config, error) {
	rows, err := s.load(ctx, tenantID)
	if err != nil {
		return Config{}, err
	}
	return Config{
		Apple:  appleConfigFromRow(rows.apple, rows.bundleIdentifier),
		Google: googleConfigFromRow(rows.google),
	}, nil
}

// Update writes both providers. Every field of input is written; the key is
// kept, replaced, or cleared as its update mode says.
func (s *Settings) Update(ctx context.Context, tenantID uuid.UUID, input UpdateInput) (Config, error) {
	rows, err := s.load(ctx, tenantID)
	if err != nil {
		return Config{}, err
	}
	appleParams, err := s.appleParams(tenantID, rows.apple, input.Apple)
	if err != nil {
		return Config{}, err
	}
	googleParams, err := googleParams(tenantID, input.Google)
	if err != nil {
		return Config{}, err
	}
	appleRow, err := s.queries.UpsertTenantAppleSignInConfig(ctx, appleParams)
	if err != nil {
		return Config{}, err
	}
	googleRow, err := s.queries.UpsertTenantGoogleSignInConfig(ctx, googleParams)
	if err != nil {
		return Config{}, err
	}
	return Config{
		Apple:  appleConfigFromRow(appleRow, rows.bundleIdentifier),
		Google: googleConfigFromRow(googleRow),
	}, nil
}

// LoadAppleCredentials decrypts the tenant's Sign in with Apple key. It does
// not ask whether Apple sign-in is enabled: a tenant that switched it off
// still owes Apple the revocation of the tokens it holds.
func (s *Settings) LoadAppleCredentials(ctx context.Context, tenantID uuid.UUID) (AppleCredentials, error) {
	row, err := s.queries.GetTenantAppleSignInConfig(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return AppleCredentials{}, ErrAppleNotConfigured
	}
	if err != nil {
		return AppleCredentials{}, err
	}
	if !row.TeamID.Valid || !row.KeyID.Valid || !row.PrivateKeyEncrypted.Valid {
		return AppleCredentials{}, ErrAppleNotConfigured
	}
	privateKey, err := Open(s.encryptor, row.PrivateKeyEncrypted.String)
	if err != nil {
		return AppleCredentials{}, err
	}
	return AppleCredentials{TeamID: row.TeamID.String, KeyID: row.KeyID.String, PrivateKey: privateKey}, nil
}

// Seal encrypts a credential, such as a refresh token, for storage.
func Seal(mgr SecretManager, plaintext string) (string, error) {
	if mgr == nil {
		return "", ErrSecretManagerUnavailable
	}
	encrypted, err := mgr.EncryptString(plaintext)
	if err != nil || !secretcrypto.IsEncryptedEnvelope(encrypted) {
		return "", ErrEncryptFailed
	}
	return encrypted, nil
}

// Open decrypts a credential [Seal] encrypted.
func Open(mgr SecretManager, sealed string) (string, error) {
	if mgr == nil {
		return "", ErrSecretManagerUnavailable
	}
	if !secretcrypto.IsEncryptedEnvelope(sealed) {
		return "", ErrDecryptFailed
	}
	plaintext, err := mgr.DecryptString(sealed)
	if err != nil || strings.TrimSpace(plaintext) == "" {
		return "", ErrDecryptFailed
	}
	return plaintext, nil
}

func (s *Settings) appleParams(tenantID uuid.UUID, existing dbmodels.TenantAppleSignInConfig, update AppleUpdate) (dbmodels.UpsertTenantAppleSignInConfigParams, error) {
	servicesID := strings.TrimSpace(update.ServicesID)
	if servicesID != "" && !servicesIDPattern.MatchString(servicesID) {
		return dbmodels.UpsertTenantAppleSignInConfigParams{}, ErrInvalidServicesID
	}
	teamID := strings.ToUpper(strings.TrimSpace(update.TeamID))
	if teamID != "" && !appleIDPattern.MatchString(teamID) {
		return dbmodels.UpsertTenantAppleSignInConfigParams{}, ErrInvalidTeamID
	}
	keyID := strings.ToUpper(strings.TrimSpace(update.KeyID))
	if keyID != "" && !appleIDPattern.MatchString(keyID) {
		return dbmodels.UpsertTenantAppleSignInConfigParams{}, ErrInvalidKeyID
	}

	encrypted, hint := existing.PrivateKeyEncrypted.String, existing.PrivateKeyHint.String
	mode, err := secretupdate.Resolve(update.PrivateKeyUpdateMode, update.PrivateKey, ErrPrivateKeyRequired)
	if err != nil {
		return dbmodels.UpsertTenantAppleSignInConfigParams{}, err
	}
	switch mode {
	case secretupdate.Replace:
		if _, err := ParsePrivateKey(update.PrivateKey); err != nil {
			return dbmodels.UpsertTenantAppleSignInConfigParams{}, err
		}
		encrypted, err = Seal(s.encryptor, strings.TrimSpace(update.PrivateKey))
		if err != nil {
			return dbmodels.UpsertTenantAppleSignInConfigParams{}, err
		}
		hint = paymentsettings.MaskSecret(pemBody(update.PrivateKey))
	case secretupdate.Clear:
		encrypted, hint = "", ""
	}
	if update.Enabled && (teamID == "" || keyID == "" || encrypted == "") {
		return dbmodels.UpsertTenantAppleSignInConfigParams{}, ErrAppleCredentialsRequired
	}
	return dbmodels.UpsertTenantAppleSignInConfigParams{
		TenantID:            tenantID,
		Enabled:             update.Enabled,
		ServicesID:          nullable(servicesID),
		TeamID:              nullable(teamID),
		KeyID:               nullable(keyID),
		PrivateKeyEncrypted: nullable(encrypted),
		PrivateKeyHint:      nullable(hint),
	}, nil
}

func googleParams(tenantID uuid.UUID, update GoogleUpdate) (dbmodels.UpsertTenantGoogleSignInConfigParams, error) {
	webClientID := strings.TrimSpace(update.WebClientID)
	iosClientID := strings.TrimSpace(update.IOSClientID)
	for _, id := range []string{webClientID, iosClientID} {
		if id != "" && !googleClientIDPattern.MatchString(id) {
			return dbmodels.UpsertTenantGoogleSignInConfigParams{}, ErrInvalidGoogleClientID
		}
	}
	if update.Enabled && webClientID == "" && iosClientID == "" {
		return dbmodels.UpsertTenantGoogleSignInConfigParams{}, ErrGoogleClientRequired
	}
	return dbmodels.UpsertTenantGoogleSignInConfigParams{
		TenantID:    tenantID,
		Enabled:     update.Enabled,
		WebClientID: nullable(webClientID),
		IosClientID: nullable(iosClientID),
	}, nil
}

type settingsRows struct {
	bundleIdentifier string
	apple            dbmodels.TenantAppleSignInConfig
	google           dbmodels.TenantGoogleSignInConfig
}

func (s *Settings) load(ctx context.Context, tenantID uuid.UUID) (settingsRows, error) {
	var rows settingsRows
	config, err := s.queries.GetTenantConfigByTenantID(ctx, tenantID)
	switch {
	case err == nil:
		rows.bundleIdentifier = config.IosBundleIdentifier.String
	case !errors.Is(err, sql.ErrNoRows):
		return settingsRows{}, err
	}
	rows.apple, err = s.queries.GetTenantAppleSignInConfig(ctx, tenantID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return settingsRows{}, err
	}
	rows.google, err = s.queries.GetTenantGoogleSignInConfig(ctx, tenantID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return settingsRows{}, err
	}
	return rows, nil
}

func appleConfigFromRow(row dbmodels.TenantAppleSignInConfig, bundleIdentifier string) AppleConfig {
	cfg := AppleConfig{
		Enabled:              row.Enabled,
		ServicesID:           row.ServicesID.String,
		TeamID:               row.TeamID.String,
		KeyID:                row.KeyID.String,
		PrivateKeyConfigured: row.PrivateKeyEncrypted.Valid,
		PrivateKeyHint:       row.PrivateKeyHint.String,
		BundleIdentifier:     bundleIdentifier,
	}
	cfg.Ready = cfg.Enabled && cfg.PrivateKeyConfigured && len(cfg.Audiences()) > 0
	return cfg
}

func googleConfigFromRow(row dbmodels.TenantGoogleSignInConfig) GoogleConfig {
	cfg := GoogleConfig{
		Enabled:     row.Enabled,
		WebClientID: row.WebClientID.String,
		IOSClientID: row.IosClientID.String,
	}
	cfg.Ready = cfg.Enabled && len(cfg.Audiences()) > 0
	return cfg
}

// ParsePrivateKey reads what the Apple Developer account issues for Sign in
// with Apple: an EC key on P-256 in a PKCS #8 "PRIVATE KEY" block.
func ParsePrivateKey(value string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(value)))
	if block == nil || block.Type != "PRIVATE KEY" {
		return nil, ErrInvalidPrivateKey
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, ErrInvalidPrivateKey
	}
	ecKey, ok := key.(*ecdsa.PrivateKey)
	if !ok || ecKey.Curve != elliptic.P256() {
		return nil, ErrInvalidPrivateKey
	}
	return ecKey, nil
}

// pemBody is the base64 of a PEM block without its armor, so a hint of a .p8
// file shows key material rather than its END line.
func pemBody(value string) string {
	block, _ := pem.Decode([]byte(strings.TrimSpace(value)))
	if block == nil {
		return ""
	}
	return base64.StdEncoding.EncodeToString(block.Bytes)
}

func nullable(value string) sql.NullString {
	return sql.NullString{String: value, Valid: value != ""}
}

func nonEmpty(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}
