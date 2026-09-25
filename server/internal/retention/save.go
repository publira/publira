package retention

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
)

// The fields of UpdatePlatformRetentionDefaultsRequest a save is refused over.
// A period Periods.Validate refuses is named as a field inside FieldDefaults.
const (
	FieldDefaults         = "defaults"
	FieldExpectedRevision = "expected_revision"
)

var (
	// ErrDefaultsConflict refuses a save based on a revision the stored row
	// has moved past.
	ErrDefaultsConflict = errors.New("platform retention defaults have changed since they were read")

	errNegativeRevision = errors.New("expected_revision must not be negative")
)

// SaveDefaultsParams replaces every saved platform default.
type SaveDefaultsParams struct {
	Defaults Periods
	// ExpectedRevision is the revision Defaults were derived from, 0 when
	// nothing was saved. Nil saves over whatever is stored, for a caller that
	// read nothing.
	ExpectedRevision *int64
}

// Validate refuses p without reading anything.
func (p SaveDefaultsParams) Validate() error {
	if err := p.Defaults.Validate(); err != nil {
		return fielderr.Within(FieldDefaults, err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision < 0 {
		return &fielderr.Invalid{Field: FieldExpectedRevision, Err: errNegativeRevision}
	}
	return nil
}

// SaveDefaults writes p in one transaction on db, with its entry filed under
// actor, so a change to how long every tenant's data is kept never goes
// unrecorded. Each purge reads the row at the start of its run.
func SaveDefaults(
	ctx context.Context,
	db *sql.DB,
	logger *slog.Logger,
	actor auditlog.PlatformActor,
	p SaveDefaultsParams,
) (dbmodels.PlatformRetentionConfig, error) {
	if err := p.Validate(); err != nil {
		return dbmodels.PlatformRetentionConfig{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformRetentionConfig{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	saved, err := writeDefaults(ctx, q, p)
	if err != nil {
		return dbmodels.PlatformRetentionConfig{}, err
	}
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		Action:     "platform_retention_defaults_updated",
		TargetType: "platform_retention",
		TargetID:   "platform",
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return dbmodels.PlatformRetentionConfig{}, fmt.Errorf("audit platform_retention_defaults_updated: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformRetentionConfig{}, fmt.Errorf("commit: %w", err)
	}
	return saved, nil
}

func writeDefaults(ctx context.Context, q *dbmodels.Queries, p SaveDefaultsParams) (dbmodels.PlatformRetentionConfig, error) {
	params := p.Defaults.PlatformConfigParams()
	current, err := q.LockPlatformRetentionConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if p.ExpectedRevision != nil && *p.ExpectedRevision != 0 {
			return dbmodels.PlatformRetentionConfig{}, ErrDefaultsConflict
		}
		inserted, err := q.InsertPlatformRetentionConfig(ctx, dbmodels.InsertPlatformRetentionConfigParams(params))
		// Two first saves both find nothing to lock; the primary key settles
		// which one wins.
		if dberr.IsUniqueViolation(err) {
			return dbmodels.PlatformRetentionConfig{}, ErrDefaultsConflict
		}
		if err != nil {
			return dbmodels.PlatformRetentionConfig{}, fmt.Errorf("insert platform retention defaults: %w", err)
		}
		return inserted, nil
	}
	if err != nil {
		return dbmodels.PlatformRetentionConfig{}, fmt.Errorf("lock platform retention defaults: %w", err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision != current.Revision {
		return dbmodels.PlatformRetentionConfig{}, ErrDefaultsConflict
	}
	updated, err := q.UpdatePlatformRetentionConfig(ctx, params)
	if err != nil {
		return dbmodels.PlatformRetentionConfig{}, fmt.Errorf("update platform retention defaults: %w", err)
	}
	return updated, nil
}
