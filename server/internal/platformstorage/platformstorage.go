// Package platformstorage resolves the object store every process uses from
// the platform's saved storage configuration. The row is reread once
// [RefreshInterval] has passed, and the client built from it is rebuilt only
// when the row has changed.
package platformstorage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/storage"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/storagesettings"
)

// RefreshInterval is how long a Resolver keeps answering from one read of the
// row, and so how long a change saved in the Platform Console takes to reach
// every process.
const RefreshInterval = 30 * time.Second

// ErrSecretManagerUnavailable is what a configuration with an explicit access
// key resolves to in a process started without the encryption keys that
// decrypt it.
var ErrSecretManagerUnavailable = errors.New("platform storage names an access key, but this process has no secret encryption keys to decrypt it")

// Querier reads the saved configuration.
type Querier interface {
	GetPlatformStorageConfig(ctx context.Context) (dbmodels.PlatformStorageConfig, error)
}

// SecretManager decrypts the stored secret access key.
type SecretManager interface {
	DecryptString(value string) (string, error)
}

// Snapshot is one saved configuration with its secret decrypted.
type Snapshot struct {
	Settings    storagesettings.Settings
	Credentials storagesettings.Credentials
	Revision    int64
}

// S3Config is the client configuration the snapshot addresses.
func (s Snapshot) S3Config() s3storage.Config {
	return s3storage.Config{
		Bucket:          s.Settings.Bucket,
		Region:          s.Settings.Region,
		Endpoint:        s.Settings.Endpoint,
		PublicBaseURL:   s.Settings.PublicBaseURL,
		AccessKeyID:     s.Credentials.AccessKeyID,
		SecretAccessKey: s.Credentials.SecretAccessKey,
		ForcePathStyle:  s.Settings.ForcePathStyle,
	}
}

// Build turns a snapshot into whatever the process stores or reads with.
type Build[T any] func(ctx context.Context, snapshot Snapshot) (T, error)

// Config is what a Resolver reads with.
type Config struct {
	Queries Querier
	// Secrets decrypts an explicit access key. Nil is a process started without
	// encryption keys, which can still use a configuration that names none.
	Secrets SecretManager
	// Interval overrides RefreshInterval. Zero keeps the default; a negative
	// value rereads the row on every call.
	Interval time.Duration
	Logger   *slog.Logger
}

// Resolver answers the value built from the current configuration.
type Resolver[T any] struct {
	queries  Querier
	secrets  SecretManager
	build    Build[T]
	interval time.Duration
	now      func() time.Time
	logger   *slog.Logger

	mu sync.Mutex
	// read says the row has been read at least once, successfully.
	read bool
	// configured is false while the last read found no row.
	configured bool
	key        version
	value      T
	bucket     string
	nextReadAt time.Time
}

// version identifies one saved row. The revision moves with every write, and
// the update time covers a row deleted and saved again from revision one.
type version struct {
	revision  int64
	updatedAt time.Time
}

func (v version) same(other version) bool {
	return v.revision == other.revision && v.updatedAt.Equal(other.updatedAt)
}

// New returns a Resolver that builds its value with build.
func New[T any](cfg Config, build Build[T]) *Resolver[T] {
	interval := cfg.Interval
	switch {
	case interval == 0:
		interval = RefreshInterval
	case interval < 0:
		interval = 0
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &Resolver[T]{
		queries:  cfg.Queries,
		secrets:  cfg.Secrets,
		build:    build,
		interval: interval,
		now:      time.Now,
		logger:   logger,
	}
}

// Resolve answers the value built from the current configuration and the
// bucket it addresses, or [storage.ErrNotConfigured] while nothing is saved.
// A failed reread keeps the last value built; a saved row that cannot be built
// from is answered as its error, never with the configuration it replaced.
func (r *Resolver[T]) Resolve(ctx context.Context) (T, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	var zero T
	now := r.now()
	if !r.read || !now.Before(r.nextReadAt) {
		row, found, err := r.readRow(ctx)
		switch {
		case err != nil && !r.read:
			return zero, "", err
		case err != nil:
			r.logger.WarnContext(ctx, "serving the last platform storage configuration read", "error", err)
		case !found:
			r.read, r.configured, r.key, r.value, r.bucket = true, false, version{}, zero, ""
		default:
			if buildErr := r.rebuild(ctx, row); buildErr != nil {
				r.read, r.configured, r.key, r.value, r.bucket = false, false, version{}, zero, ""
				return zero, "", buildErr
			}
		}
		r.nextReadAt = now.Add(r.interval)
	}
	if !r.configured {
		return zero, "", storage.ErrNotConfigured
	}
	return r.value, r.bucket, nil
}

func (r *Resolver[T]) readRow(ctx context.Context) (dbmodels.PlatformStorageConfig, bool, error) {
	if r.queries == nil {
		return dbmodels.PlatformStorageConfig{}, false, errors.New("platformstorage: queries is nil")
	}
	row, err := r.queries.GetPlatformStorageConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.PlatformStorageConfig{}, false, nil
	}
	if err != nil {
		return dbmodels.PlatformStorageConfig{}, false, fmt.Errorf("read platform storage configuration: %w", err)
	}
	return row, true, nil
}

// rebuild builds from row unless the value held was built from the same row.
func (r *Resolver[T]) rebuild(ctx context.Context, row dbmodels.PlatformStorageConfig) error {
	key := version{revision: row.Revision, updatedAt: row.UpdatedAt}
	if r.read && r.configured && r.key.same(key) {
		return nil
	}
	snapshot, err := r.snapshot(row)
	if err != nil {
		return err
	}
	value, err := r.build(ctx, snapshot)
	if err != nil {
		return fmt.Errorf("build object storage client: %w", err)
	}
	r.read, r.configured, r.key, r.value, r.bucket = true, true, key, value, snapshot.Settings.Bucket
	r.logger.InfoContext(ctx, "platform storage configuration loaded",
		"bucket", snapshot.Settings.Bucket,
		"revision", snapshot.Revision,
		"ambient_credentials", snapshot.Credentials.Ambient(),
	)
	return nil
}

func (r *Resolver[T]) snapshot(row dbmodels.PlatformStorageConfig) (Snapshot, error) {
	stored := storagesettings.FromConfig(row)
	snapshot := Snapshot{Settings: stored.Settings, Revision: stored.Revision}
	if !stored.HasSecretAccessKey {
		return snapshot, nil
	}
	if r.secrets == nil {
		return Snapshot{}, ErrSecretManagerUnavailable
	}
	secret, err := r.secrets.DecryptString(strings.TrimSpace(row.SecretAccessKeyEncrypted.String))
	if err != nil {
		return Snapshot{}, fmt.Errorf("decrypt platform storage secret access key: %w", err)
	}
	snapshot.Credentials = storagesettings.Credentials{AccessKeyID: stored.AccessKeyID, SecretAccessKey: secret}
	return snapshot, nil
}

// NewStorage is the Build that makes the uploader and reclaimer.
func NewStorage(ctx context.Context, snapshot Snapshot) (*s3storage.Storage, error) {
	return s3storage.New(ctx, snapshot.S3Config())
}

// Provider is a [storage.Provider] that uploads to the bucket resolved for
// each call.
type Provider struct {
	Resolver *Resolver[*s3storage.Storage]
}

// Upload implements storage.Provider.
func (p Provider) Upload(ctx context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	store, _, err := p.Resolver.Resolve(ctx)
	if err != nil {
		return storage.UploadResult{}, err
	}
	return store.Upload(ctx, req)
}

// Reclaimers is a [storage.ReclaimerSource] over the resolved bucket.
type Reclaimers struct {
	Resolver *Resolver[*s3storage.Storage]
}

// Reclaimer implements storage.ReclaimerSource.
func (r Reclaimers) Reclaimer(ctx context.Context) (storage.Reclaimer, string, error) {
	store, bucket, err := r.Resolver.Resolve(ctx)
	if err != nil {
		return nil, "", err
	}
	return store, bucket, nil
}
