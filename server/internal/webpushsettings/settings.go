// Package webpushsettings holds the platform's Web Push identity: the VAPID
// key pair the server generates for itself, and the subject an operator saves.
// The private key leaves this package only inside [Credentials], for the sender.
// The platform API's PlatformWebPushSettingsService and publiractl webpush are
// adapters over its save.
//
// A refusal of what the caller asked for is a [*fielderr.Invalid] naming the
// field at fault, [ErrConflict], or [ErrSecretManagerUnavailable]; any other
// error is an internal fault.
package webpushsettings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"net/url"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

const maxSubjectLength = 2048

var (
	ErrSecretManagerUnavailable = errors.New("secret manager is not configured")
	// ErrNotConfigured is what a sender asks for while no subject is saved.
	ErrNotConfigured  = errors.New("web push is not configured")
	ErrInvalidSubject = errors.New("subject must be a mailto: URI with an address or an absolute https: URL")
)

// SecretManager seals and opens the stored private key.
type SecretManager interface {
	EncryptString(plaintext string) (string, error)
	DecryptString(value string) (string, error)
}

// Querier is what generating and reading the stored pair needs.
type Querier interface {
	GetPlatformWebPushConfig(ctx context.Context) (dbmodels.PlatformWebpushConfig, error)
	InsertPlatformWebPushKeyPair(ctx context.Context, arg dbmodels.InsertPlatformWebPushKeyPairParams) (int64, error)
}

// Stored is the saved settings as a caller reads them back.
type Stored struct {
	PublicKey string
	// Subject is empty until an operator saves one.
	Subject  string
	Revision int64
}

// Configured reports whether a push can be signed, which is whether a subject
// is saved: the key pair exists as soon as the row does.
func (s Stored) Configured() bool {
	return s.Subject != ""
}

func FromConfig(config dbmodels.PlatformWebpushConfig) Stored {
	return Stored{
		PublicKey: config.VapidPublicKey,
		Subject:   config.Subject.String,
		Revision:  config.Revision,
	}
}

// Credentials is everything a delivery is signed with.
type Credentials struct {
	PublicKey  string
	PrivateKey string
	Subject    string
}

// String, GoString and LogValue keep the private key out of whatever formats a
// Credentials, which is how a mistaken %v or log argument stops being a leak.
func (c Credentials) String() string {
	return "webpushsettings.Credentials{redacted}"
}

func (c Credentials) GoString() string {
	return c.String()
}

func (c Credentials) LogValue() slog.Value {
	return slog.StringValue("redacted")
}

// NormalizeSubject trims the subject an operator typed.
func NormalizeSubject(subject string) string {
	return strings.TrimSpace(subject)
}

// ValidateSubject accepts the two forms RFC 8292 names for the contact: a
// mailto: URI naming one bare address, or an absolute https: URL.
func ValidateSubject(subject string) error {
	if subject == "" || len(subject) > maxSubjectLength {
		return ErrInvalidSubject
	}
	parsed, err := url.Parse(subject)
	if err != nil {
		return ErrInvalidSubject
	}
	switch parsed.Scheme {
	case "mailto":
		address, err := mail.ParseAddress(parsed.Opaque)
		if err != nil || address.Name != "" || address.Address != parsed.Opaque {
			return ErrInvalidSubject
		}
		return nil
	case "https":
		if parsed.Host == "" || parsed.User != nil {
			return ErrInvalidSubject
		}
		return nil
	default:
		return ErrInvalidSubject
	}
}

// Ensure answers the stored row, generating and storing a key pair first when
// there is none. Racing processes all answer whichever pair was stored first.
func Ensure(ctx context.Context, q Querier, mgr SecretManager) (dbmodels.PlatformWebpushConfig, error) {
	config, err := q.GetPlatformWebPushConfig(ctx)
	if err == nil {
		return config, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("read web push settings: %w", err)
	}
	if mgr == nil {
		return dbmodels.PlatformWebpushConfig{}, ErrSecretManagerUnavailable
	}
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("generate VAPID key pair: %w", err)
	}
	encrypted, err := mgr.EncryptString(privateKey)
	if err != nil {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("encrypt VAPID private key: %w", err)
	}
	if _, err := q.InsertPlatformWebPushKeyPair(ctx, dbmodels.InsertPlatformWebPushKeyPairParams{
		VapidPublicKey:           publicKey,
		VapidPrivateKeyEncrypted: encrypted,
	}); err != nil {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("store VAPID key pair: %w", err)
	}
	config, err = q.GetPlatformWebPushConfig(ctx)
	if err != nil {
		return dbmodels.PlatformWebpushConfig{}, fmt.Errorf("read web push settings: %w", err)
	}
	return config, nil
}

// CredentialsQuerier is what loading the signing credentials needs.
type CredentialsQuerier interface {
	GetPlatformWebPushConfig(ctx context.Context) (dbmodels.PlatformWebpushConfig, error)
}

// LoadCredentials opens the stored pair for signing, reporting
// [ErrNotConfigured] while no pair or no subject is stored.
func LoadCredentials(ctx context.Context, q CredentialsQuerier, mgr SecretManager) (Credentials, error) {
	config, err := q.GetPlatformWebPushConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return Credentials{}, ErrNotConfigured
	}
	if err != nil {
		return Credentials{}, fmt.Errorf("read web push settings: %w", err)
	}
	if !config.Subject.Valid {
		return Credentials{}, ErrNotConfigured
	}
	if mgr == nil {
		return Credentials{}, ErrSecretManagerUnavailable
	}
	privateKey, err := mgr.DecryptString(config.VapidPrivateKeyEncrypted)
	if err != nil {
		return Credentials{}, fmt.Errorf("decrypt VAPID private key: %w", err)
	}
	return Credentials{
		PublicKey:  config.VapidPublicKey,
		PrivateKey: privateKey,
		Subject:    config.Subject.String,
	}, nil
}

func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}
