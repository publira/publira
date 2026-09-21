// Package storagesettings holds the platform's object store configuration: the
// values that address one S3-compatible bucket, the credential that signs for
// it, and what a connection test found when it exercised it.
//
// The secret access key never leaves this package in the clear except through
// [ResolveSecretForTest], which hands it to the connection test alone. Reads
// meant for a caller carry [Stored], which says whether a secret is held and
// never what it is.
package storagesettings

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strings"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// The modes a save states its secret access key in, matching
// publira.platform.v1.SecretUpdateMode.
const (
	SecretUpdateModeUnspecified int32 = 0
	SecretUpdateModeUnchanged   int32 = 1
	SecretUpdateModeReplace     int32 = 2
	SecretUpdateModeClear       int32 = 3
)

const (
	minBucketNameLength = 3
	maxBucketNameLength = 63
)

var (
	ErrSecretManagerUnavailable = errors.New("secret manager is not configured")
	ErrSecretAccessKeyRequired  = errors.New("secret_access_key is required to replace the stored one")
	ErrAccessKeyIDRequired      = errors.New("access_key_id is required alongside a secret access key")
	ErrSecretAccessKeyMissing   = errors.New("secret_access_key is required alongside an access key id")
	ErrAccessKeyIDChanged       = errors.New("secret_access_key must be replaced when access_key_id changes")
)

// SecretManager encrypts and decrypts the stored secret access key.
type SecretManager interface {
	EncryptString(plaintext string) (string, error)
	DecryptString(value string) (string, error)
}

// Settings addresses one bucket. Nothing here is secret, so it is what a read
// answers with and what a log line may carry.
type Settings struct {
	Bucket string
	Region string
	// Endpoint is empty for a bucket on AWS, where the SDK resolves the
	// address from the region.
	Endpoint       string
	ForcePathStyle bool
	// PublicBaseURL is where a stored object is readable from, empty when
	// nothing serves one directly.
	PublicBaseURL string
}

// Credentials signs requests to the bucket. The zero value is the ambient
// credential: whatever each process finds for itself.
type Credentials struct {
	AccessKeyID     string
	SecretAccessKey string
}

// Ambient reports the credential that names no key of its own.
func (c Credentials) Ambient() bool {
	return strings.TrimSpace(c.AccessKeyID) == "" && strings.TrimSpace(c.SecretAccessKey) == ""
}

// String, GoString and LogValue keep the secret access key out of whatever
// formats a Credentials, which is how a mistaken %v or log argument stops
// being a leak.
func (c Credentials) String() string {
	return "storagesettings.Credentials{redacted}"
}

func (c Credentials) GoString() string {
	return c.String()
}

func (c Credentials) LogValue() slog.Value {
	return slog.StringValue("redacted")
}

// Stored is a saved configuration as a caller reads it back.
type Stored struct {
	Settings    Settings
	AccessKeyID string
	// HasSecretAccessKey says a secret is held without saying what it is.
	HasSecretAccessKey bool
	// Revision is zero for a platform that has saved no configuration at all.
	Revision int64
}

// Normalize trims what an operator typed and drops the trailing slash a base
// URL is written with either way, so two spellings of one address are stored
// as one value.
func Normalize(settings Settings) Settings {
	settings.Bucket = strings.TrimSpace(settings.Bucket)
	settings.Region = strings.TrimSpace(settings.Region)
	settings.Endpoint = strings.TrimRight(strings.TrimSpace(settings.Endpoint), "/")
	settings.PublicBaseURL = strings.TrimRight(strings.TrimSpace(settings.PublicBaseURL), "/")
	return settings
}

// NormalizeCredentials trims both halves of the credential. The secret is left
// otherwise untouched: what an operator pasted is what signs the requests.
func NormalizeCredentials(credentials Credentials) Credentials {
	credentials.AccessKeyID = strings.TrimSpace(credentials.AccessKeyID)
	credentials.SecretAccessKey = strings.TrimSpace(credentials.SecretAccessKey)
	return credentials
}

// Validate reports the first value that names no bucket anything could be
// stored in. It is the whole reason a saved row can be trusted to address
// something, so it runs before every write and before every test.
func Validate(settings Settings) error {
	settings = Normalize(settings)
	if err := validateBucketName(settings.Bucket); err != nil {
		return err
	}
	if settings.Region == "" {
		return errors.New("region is required")
	}
	if strings.ContainsAny(settings.Region, " \t") {
		return errors.New("region must not contain whitespace")
	}
	if err := validateAbsoluteURL("endpoint", settings.Endpoint); err != nil {
		return err
	}
	return validateAbsoluteURL("public_base_url", settings.PublicBaseURL)
}

// ValidateCredentialPair refuses half a credential. An access key id without
// its secret cannot sign, and a secret without an id says nothing about who is
// signing, so a configuration holding one of the two is neither explicit nor
// ambient.
func ValidateCredentialPair(accessKeyID string, hasSecretAccessKey bool) error {
	accessKeyID = strings.TrimSpace(accessKeyID)
	switch {
	case accessKeyID == "" && hasSecretAccessKey:
		return ErrAccessKeyIDRequired
	case accessKeyID != "" && !hasSecretAccessKey:
		return ErrSecretAccessKeyMissing
	default:
		return nil
	}
}

// ValidateKeptSecret refuses to keep the stored secret under an access key id
// other than the one it was stored with, which would pair a new id with a key
// that was never issued for it.
func ValidateKeptSecret(storedAccessKeyID, accessKeyID string, mode int32, hasStoredSecret bool) error {
	if mode != SecretUpdateModeUnspecified && mode != SecretUpdateModeUnchanged {
		return nil
	}
	accessKeyID = strings.TrimSpace(accessKeyID)
	if !hasStoredSecret || accessKeyID == "" {
		return nil
	}
	if accessKeyID != strings.TrimSpace(storedAccessKeyID) {
		return ErrAccessKeyIDChanged
	}
	return nil
}

// FromConfig reads a saved row.
func FromConfig(config dbmodels.PlatformStorageConfig) Stored {
	return Stored{
		Settings: Settings{
			Bucket:         config.Bucket,
			Region:         config.Region,
			Endpoint:       nullStringValue(config.Endpoint),
			ForcePathStyle: config.ForcePathStyle,
			PublicBaseURL:  nullStringValue(config.PublicBaseUrl),
		},
		AccessKeyID:        nullStringValue(config.AccessKeyID),
		HasSecretAccessKey: strings.TrimSpace(nullStringValue(config.SecretAccessKeyEncrypted)) != "",
		Revision:           config.Revision,
	}
}

// ConfigParams is the row that stores settings alongside the credential the
// caller resolved. The insert takes the same fields, so its params convert
// from these.
func ConfigParams(settings Settings, accessKeyID, secretAccessKeyEncrypted string) dbmodels.UpdatePlatformStorageConfigParams {
	settings = Normalize(settings)
	return dbmodels.UpdatePlatformStorageConfigParams{
		Bucket:                   settings.Bucket,
		Region:                   settings.Region,
		Endpoint:                 nullableString(settings.Endpoint),
		ForcePathStyle:           settings.ForcePathStyle,
		PublicBaseUrl:            nullableString(settings.PublicBaseURL),
		AccessKeyID:              nullableString(accessKeyID),
		SecretAccessKeyEncrypted: nullableString(secretAccessKeyEncrypted),
	}
}

// EncryptUpdatedSecret answers what the secret column holds after a save:
// the ciphertext already there, a newly encrypted one, or nothing at all when
// the operator chose the ambient credential.
func EncryptUpdatedSecret(existingEncrypted string, mode int32, newSecret string, mgr SecretManager) (string, error) {
	switch mode {
	case SecretUpdateModeUnspecified, SecretUpdateModeUnchanged:
		return existingEncrypted, nil
	case SecretUpdateModeReplace:
		newSecret = strings.TrimSpace(newSecret)
		if newSecret == "" {
			return "", ErrSecretAccessKeyRequired
		}
		if mgr == nil {
			return "", ErrSecretManagerUnavailable
		}
		encrypted, err := mgr.EncryptString(newSecret)
		if err != nil {
			return "", fmt.Errorf("encrypt secret access key: %w", err)
		}
		return encrypted, nil
	case SecretUpdateModeClear:
		return "", nil
	default:
		return "", fmt.Errorf("invalid secret update mode: %d", mode)
	}
}

// ResolveSecretForTest answers the secret access key a connection test signs
// with. It is the one path that returns stored key material in the clear, and
// it hands it straight to the test.
func ResolveSecretForTest(existingEncrypted string, mode int32, newSecret string, mgr SecretManager) (string, error) {
	switch mode {
	case SecretUpdateModeUnspecified, SecretUpdateModeUnchanged:
		existingEncrypted = strings.TrimSpace(existingEncrypted)
		if existingEncrypted == "" {
			return "", nil
		}
		if mgr == nil {
			return "", ErrSecretManagerUnavailable
		}
		secret, err := mgr.DecryptString(existingEncrypted)
		if err != nil {
			return "", fmt.Errorf("decrypt secret access key: %w", err)
		}
		return secret, nil
	case SecretUpdateModeReplace:
		newSecret = strings.TrimSpace(newSecret)
		if newSecret == "" {
			return "", ErrSecretAccessKeyRequired
		}
		return newSecret, nil
	case SecretUpdateModeClear:
		return "", nil
	default:
		return "", fmt.Errorf("invalid secret update mode: %d", mode)
	}
}

// validateBucketName holds S3's own naming rules. A provider that accepts a
// name outside them still leaves Publira addressing it through the SDK, which
// does not.
func validateBucketName(bucket string) error {
	if bucket == "" {
		return errors.New("bucket is required")
	}
	if len(bucket) < minBucketNameLength || len(bucket) > maxBucketNameLength {
		return fmt.Errorf("bucket must be between %d and %d characters", minBucketNameLength, maxBucketNameLength)
	}
	if net.ParseIP(bucket) != nil {
		return errors.New("bucket must not be formatted as an IP address")
	}
	if strings.Contains(bucket, "..") {
		return errors.New("bucket must not contain consecutive dots")
	}
	for _, r := range bucket {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' && r != '.' {
			return errors.New("bucket must hold only lowercase letters, digits, dots, and hyphens")
		}
	}
	if !isBucketNameEdge(rune(bucket[0])) || !isBucketNameEdge(rune(bucket[len(bucket)-1])) {
		return errors.New("bucket must start and end with a lowercase letter or a digit")
	}
	return nil
}

func isBucketNameEdge(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
}

func validateAbsoluteURL(field, value string) error {
	if value == "" {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return fmt.Errorf("%s must be a valid URL", field)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("%s must be an http or https URL", field)
	}
	if parsed.Host == "" {
		return fmt.Errorf("%s must name a host", field)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("%s must not carry a query or a fragment", field)
	}
	return nil
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
