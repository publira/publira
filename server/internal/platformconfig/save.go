package platformconfig

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
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/tenanttz"
)

// The fields a refusal names, spelled as UpdatePlatformSettingsRequest spells
// them so the Connect adapter can report them as they are.
const (
	FieldDefaultTimezone  = "default_timezone"
	FieldDefaultLocale    = "default_locale"
	FieldExpectedRevision = "expected_revision"
)

var (
	// ErrConflict refuses a save based on a revision the stored row has moved
	// past. The caller re-reads and decides again rather than having its half
	// of the row written over the half it never saw.
	ErrConflict = errors.New("platform settings have changed since they were read")

	errNegativeRevision = errors.New("expected_revision must not be negative")
)

// SaveParams replaces the platform default time zone and locale.
type SaveParams struct {
	DefaultTimezone string
	DefaultLocale   string
	// ExpectedRevision is the revision the settings were read at, 0 when none
	// were saved. Nil saves over whatever is stored, for a caller that read
	// nothing.
	ExpectedRevision *int64
}

// Validate normalizes p, or refuses it with a [*fielderr.Invalid], without
// reading anything.
func (p SaveParams) Validate() (SaveParams, error) {
	timezone, err := tenanttz.Normalize(p.DefaultTimezone)
	if err != nil {
		return SaveParams{}, &fielderr.Invalid{Field: FieldDefaultTimezone, Err: err}
	}
	defaultLocale, err := locale.Normalize(p.DefaultLocale)
	if err != nil {
		return SaveParams{}, &fielderr.Invalid{Field: FieldDefaultLocale, Err: err}
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision < 0 {
		return SaveParams{}, &fielderr.Invalid{Field: FieldExpectedRevision, Err: errNegativeRevision}
	}
	return SaveParams{DefaultTimezone: timezone, DefaultLocale: defaultLocale, ExpectedRevision: p.ExpectedRevision}, nil
}

// Save writes p in one transaction on db, with its entry filed under actor.
// The row is locked first, so the revision it compares against cannot change
// between the comparison and the write. A save that changes no stored value
// writes nothing and files nothing.
func Save(ctx context.Context, db *sql.DB, logger *slog.Logger, actor auditlog.PlatformActor, p SaveParams) (dbmodels.PlatformConfig, error) {
	p, err := p.Validate()
	if err != nil {
		return dbmodels.PlatformConfig{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformConfig{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	saved, changed, err := write(ctx, q, p)
	if err != nil || !changed {
		return saved, err
	}
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		Action:     "platform_settings_updated",
		TargetType: "platform_config",
		TargetID:   "platform",
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return dbmodels.PlatformConfig{}, fmt.Errorf("audit platform_settings_updated: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformConfig{}, fmt.Errorf("commit: %w", err)
	}
	return saved, nil
}

func write(ctx context.Context, q *dbmodels.Queries, p SaveParams) (dbmodels.PlatformConfig, bool, error) {
	current, err := q.LockPlatformConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if p.ExpectedRevision != nil && *p.ExpectedRevision != 0 {
			return dbmodels.PlatformConfig{}, false, ErrConflict
		}
		inserted, err := q.InsertPlatformSettings(ctx, dbmodels.InsertPlatformSettingsParams{
			DefaultTimezone: p.DefaultTimezone,
			DefaultLocale:   p.DefaultLocale,
		})
		// Two first saves both find nothing to lock; the primary key settles
		// which one wins.
		if dberr.IsUniqueViolation(err) {
			return dbmodels.PlatformConfig{}, false, ErrConflict
		}
		if err != nil {
			return dbmodels.PlatformConfig{}, false, fmt.Errorf("insert platform settings: %w", err)
		}
		return inserted, true, nil
	}
	if err != nil {
		return dbmodels.PlatformConfig{}, false, fmt.Errorf("lock platform settings: %w", err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision != current.Revision {
		return dbmodels.PlatformConfig{}, false, ErrConflict
	}
	if current.DefaultTimezone == p.DefaultTimezone && current.DefaultLocale == p.DefaultLocale {
		return current, false, nil
	}
	updated, err := q.UpdatePlatformSettings(ctx, dbmodels.UpdatePlatformSettingsParams{
		DefaultTimezone: p.DefaultTimezone,
		DefaultLocale:   p.DefaultLocale,
	})
	if err != nil {
		return dbmodels.PlatformConfig{}, false, fmt.Errorf("update platform settings: %w", err)
	}
	return updated, true, nil
}

// Get reads the settings row, reporting whether one is saved.
func Get(ctx context.Context, q Querier) (dbmodels.PlatformConfig, bool, error) {
	config, err := q.GetPlatformConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.PlatformConfig{}, false, nil
	}
	if err != nil {
		return dbmodels.PlatformConfig{}, false, fmt.Errorf("read platform config: %w", err)
	}
	return config, true, nil
}
