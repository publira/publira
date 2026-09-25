package platformstorage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/storagesettings"
)

// The fields refused here beside those of [storagesettings.Validate].
const (
	FieldSecretAccessKeyUpdateMode = "secret_access_key_update_mode"
	FieldExpectedRevision          = "expected_revision"
)

var (
	// ErrConflict refuses a save based on a revision the stored row has moved
	// past.
	ErrConflict = errors.New("platform storage settings have changed since they were read")
	// ErrNotSaved is what a test of the saved settings finds when there are
	// none.
	ErrNotSaved = errors.New("platform storage settings are not saved")

	errNegativeRevision = errors.New("expected_revision must not be negative")
)

const (
	auditTargetType = "storage_config"
	auditTargetID   = "platform"
)

// Get reads the saved settings, reporting false when there are none.
func Get(ctx context.Context, q Querier) (dbmodels.PlatformStorageConfig, bool, error) {
	config, err := q.GetPlatformStorageConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.PlatformStorageConfig{}, false, nil
	}
	if err != nil {
		return dbmodels.PlatformStorageConfig{}, false, fmt.Errorf("get platform storage config: %w", err)
	}
	return config, true, nil
}

// SaveParams replaces the saved settings. The secret access key is SecretMode
// applied to SecretAccessKey; no access key id and no secret is the ambient
// credential.
type SaveParams struct {
	Settings        storagesettings.Settings
	AccessKeyID     string
	SecretMode      secretupdate.Mode
	SecretAccessKey string
	// ExpectedRevision is the revision Settings were read at, 0 when none were
	// saved. Nil saves over whatever is stored, for a caller that read nothing.
	ExpectedRevision *int64
}

// Validate refuses p without reading anything.
func (p SaveParams) Validate() error {
	if err := storagesettings.Validate(p.Settings); err != nil {
		return err
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision < 0 {
		return &fielderr.Invalid{Field: FieldExpectedRevision, Err: errNegativeRevision}
	}
	return nil
}

// Save writes p in one transaction on db, with its entry filed under actor.
// The row is locked first, so the secret a save keeps is the one its revision
// was compared against rather than one another session has since replaced.
// A save that changes no stored value writes nothing and files nothing, which
// leaves every process's client as it is.
func Save(
	ctx context.Context,
	db *sql.DB,
	logger *slog.Logger,
	encryptor storagesettings.SecretManager,
	actor auditlog.PlatformActor,
	p SaveParams,
) (dbmodels.PlatformStorageConfig, error) {
	if err := p.Validate(); err != nil {
		return dbmodels.PlatformStorageConfig{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformStorageConfig{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	saved, changed, err := write(ctx, q, encryptor, p)
	if err != nil || !changed {
		return saved, err
	}
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		Action:     "platform_storage_settings_updated",
		TargetType: auditTargetType,
		TargetID:   auditTargetID,
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return dbmodels.PlatformStorageConfig{}, fmt.Errorf("audit platform_storage_settings_updated: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformStorageConfig{}, fmt.Errorf("commit: %w", err)
	}
	return saved, nil
}

func write(ctx context.Context, q *dbmodels.Queries, encryptor storagesettings.SecretManager, p SaveParams) (dbmodels.PlatformStorageConfig, bool, error) {
	current, err := q.LockPlatformStorageConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if p.ExpectedRevision != nil && *p.ExpectedRevision != 0 {
			return dbmodels.PlatformStorageConfig{}, false, ErrConflict
		}
		params, err := configParams(p, dbmodels.PlatformStorageConfig{}, encryptor)
		if err != nil {
			return dbmodels.PlatformStorageConfig{}, false, err
		}
		inserted, err := q.InsertPlatformStorageConfig(ctx, dbmodels.InsertPlatformStorageConfigParams(params))
		// Two first saves both find nothing to lock; the primary key settles
		// which one wins.
		if dberr.IsUniqueViolation(err) {
			return dbmodels.PlatformStorageConfig{}, false, ErrConflict
		}
		if err != nil {
			return dbmodels.PlatformStorageConfig{}, false, fmt.Errorf("insert platform storage config: %w", err)
		}
		return inserted, true, nil
	}
	if err != nil {
		return dbmodels.PlatformStorageConfig{}, false, fmt.Errorf("lock platform storage config: %w", err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision != current.Revision {
		return dbmodels.PlatformStorageConfig{}, false, ErrConflict
	}
	params, err := configParams(p, current, encryptor)
	if err != nil {
		return dbmodels.PlatformStorageConfig{}, false, err
	}
	if params == storedParams(current) {
		return current, false, nil
	}
	updated, err := q.UpdatePlatformStorageConfig(ctx, params)
	if err != nil {
		return dbmodels.PlatformStorageConfig{}, false, fmt.Errorf("update platform storage config: %w", err)
	}
	return updated, true, nil
}

// configParams resolves the secret the row ends up holding and refuses a
// credential that is only half stated, or whose halves no longer belong
// together. current is the zero row when nothing is saved yet.
func configParams(p SaveParams, current dbmodels.PlatformStorageConfig, encryptor storagesettings.SecretManager) (dbmodels.UpdatePlatformStorageConfigParams, error) {
	accessKeyID := storagesettings.NormalizeCredentials(storagesettings.Credentials{AccessKeyID: p.AccessKeyID}).AccessKeyID
	existingEncrypted := current.SecretAccessKeyEncrypted.String
	if err := storagesettings.ValidateKeptSecret(current.AccessKeyID.String, accessKeyID, p.SecretMode, existingEncrypted != ""); err != nil {
		return dbmodels.UpdatePlatformStorageConfigParams{}, err
	}
	encrypted, err := storagesettings.EncryptUpdatedSecret(existingEncrypted, p.SecretMode, p.SecretAccessKey, encryptor)
	if err != nil {
		return dbmodels.UpdatePlatformStorageConfigParams{}, secretError(err)
	}
	if err := storagesettings.ValidateCredentialPair(accessKeyID, encrypted != ""); err != nil {
		return dbmodels.UpdatePlatformStorageConfigParams{}, err
	}
	return storagesettings.ConfigParams(p.Settings, accessKeyID, encrypted), nil
}

func storedParams(config dbmodels.PlatformStorageConfig) dbmodels.UpdatePlatformStorageConfigParams {
	return dbmodels.UpdatePlatformStorageConfigParams{
		Bucket:                   config.Bucket,
		Region:                   config.Region,
		Endpoint:                 config.Endpoint,
		ForcePathStyle:           config.ForcePathStyle,
		PublicBaseUrl:            config.PublicBaseUrl,
		AccessKeyID:              config.AccessKeyID,
		SecretAccessKeyEncrypted: config.SecretAccessKeyEncrypted,
	}
}

// secretError names the field behind a secret access key that could not be
// resolved.
func secretError(err error) error {
	if errors.Is(err, secretupdate.ErrInvalidMode) {
		return &fielderr.Invalid{Field: FieldSecretAccessKeyUpdateMode, Err: err}
	}
	return &fielderr.Invalid{Field: storagesettings.FieldSecretAccessKey, Err: err}
}

// TestParams tests settings that may not be saved. The secret access key is
// SecretMode applied to SecretAccessKey, over the saved one.
type TestParams struct {
	Settings        storagesettings.Settings
	AccessKeyID     string
	SecretMode      secretupdate.Mode
	SecretAccessKey string
}

// Tester runs the connection test and files an entry for every run.
type Tester struct {
	Encryptor storagesettings.SecretManager
	Store     storagesettings.Tester
	Recorder  auditlog.Recorder
}

// Test runs the connection test against p's settings.
func (t Tester) Test(ctx context.Context, q Querier, actor auditlog.PlatformActor, p TestParams) ([]storagesettings.Check, error) {
	if err := storagesettings.Validate(p.Settings); err != nil {
		return nil, err
	}
	saved, _, err := Get(ctx, q)
	if err != nil {
		return nil, err
	}
	existingEncrypted := saved.SecretAccessKeyEncrypted.String
	if err := storagesettings.ValidateKeptSecret(saved.AccessKeyID.String, p.AccessKeyID, p.SecretMode, existingEncrypted != ""); err != nil {
		return nil, err
	}
	secret, err := storagesettings.ResolveSecretForTest(existingEncrypted, p.SecretMode, p.SecretAccessKey, t.Encryptor)
	if err != nil {
		return nil, secretError(err)
	}
	credentials := storagesettings.NormalizeCredentials(storagesettings.Credentials{AccessKeyID: p.AccessKeyID, SecretAccessKey: secret})
	if err := storagesettings.ValidateCredentialPair(credentials.AccessKeyID, credentials.SecretAccessKey != ""); err != nil {
		return nil, err
	}
	return t.run(ctx, actor, storagesettings.Normalize(p.Settings), credentials)
}

// TestSaved runs the connection test against the saved settings, signing as
// every process that resolves them does.
func (t Tester) TestSaved(ctx context.Context, q Querier, actor auditlog.PlatformActor) ([]storagesettings.Check, error) {
	saved, found, err := Get(ctx, q)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrNotSaved
	}
	stored := storagesettings.FromConfig(saved)
	secret, err := storagesettings.ResolveSecretForTest(saved.SecretAccessKeyEncrypted.String, secretupdate.Unchanged, "", t.Encryptor)
	if err != nil {
		return nil, secretError(err)
	}
	return t.run(ctx, actor, stored.Settings, storagesettings.NormalizeCredentials(storagesettings.Credentials{
		AccessKeyID:     stored.AccessKeyID,
		SecretAccessKey: secret,
	}))
}

func (t Tester) run(ctx context.Context, actor auditlog.PlatformActor, settings storagesettings.Settings, credentials storagesettings.Credentials) ([]storagesettings.Check, error) {
	checks, err := t.Store.TestConnection(ctx, settings, credentials)
	if err != nil {
		return nil, fmt.Errorf("test platform storage connection: %w", err)
	}
	entry := auditlog.PlatformEntry{
		Action:     "platform_storage_connection_tested",
		TargetType: auditTargetType,
		TargetID:   auditTargetID,
		Outcome:    auditlog.OutcomeSuccess,
	}
	if failed, ok := storagesettings.Failed(checks); ok {
		entry.Outcome, entry.Reason = auditlog.OutcomeFailure, failed.Reason
	}
	t.Recorder.RecordPlatform(ctx, actor.Entry(entry))
	return checks, nil
}
