// Package retention answers how long each kind of expiring record is kept:
// withdrawn comments, raw content events, and daily and weekly ranking
// snapshots.
//
// A tenant's effective period is its own override, else the platform default
// saved in platform_retention_config, else Builtin. The admin API reports a
// withdrawn comment's deadline from that value and the purge batches delete by
// it, so both go through Settings.Effective and the date arithmetic below
// rather than each carrying a copy.
package retention

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// MaxDays bounds every period. It keeps the cutoff a date PostgreSQL can hold;
// the same bound is a CHECK constraint on both tables.
const MaxDays = 36500

// Periods are retention periods in whole days.
type Periods struct {
	WithdrawnCommentDays      int
	ContentEventDays          int
	DailyRankingSnapshotDays  int
	WeeklyRankingSnapshotDays int
}

// Builtin is what an installation that has saved nothing keeps: the defaults
// the purge batches had before the periods became settings.
//
// A withdrawn comment outlives its withdrawal long enough for a report or a
// dispute about it to be settled. A daily snapshot covers a quarter of
// day-over-day movement, and a weekly one compares a week against the same
// week a year earlier.
func Builtin() Periods {
	return Periods{
		WithdrawnCommentDays:      180,
		ContentEventDays:          90,
		DailyRankingSnapshotDays:  90,
		WeeklyRankingSnapshotDays: 400,
	}
}

// Validate reports the first period outside 1 to MaxDays. A period of zero or
// less puts the cutoff at or after now and deletes every row of its kind.
func (p Periods) Validate() error {
	for _, period := range []struct {
		name string
		days int
	}{
		{"withdrawn_comment_days", p.WithdrawnCommentDays},
		{"content_event_days", p.ContentEventDays},
		{"daily_ranking_snapshot_days", p.DailyRankingSnapshotDays},
		{"weekly_ranking_snapshot_days", p.WeeklyRankingSnapshotDays},
	} {
		if err := validateDays(period.name, period.days); err != nil {
			return err
		}
	}
	return nil
}

func validateDays(name string, days int) error {
	if days < 1 || days > MaxDays {
		return fmt.Errorf("%s must be from 1 to %d, got %d", name, MaxDays, days)
	}
	return nil
}

// WithdrawnCommentPurgeDueAt is when a comment withdrawn at withdrawnAt is
// deleted: the first instant WithdrawnCommentCutoff passes it.
func (p Periods) WithdrawnCommentPurgeDueAt(withdrawnAt time.Time) time.Time {
	return withdrawnAt.UTC().AddDate(0, 0, p.WithdrawnCommentDays)
}

// WithdrawnCommentCutoff is the exclusive withdrawn_at bound a purge running
// at now deletes below.
func (p Periods) WithdrawnCommentCutoff(now time.Time) time.Time {
	return now.UTC().AddDate(0, 0, -p.WithdrawnCommentDays)
}

// ContentEventCutoff is the exclusive occurred_at bound a purge running at now
// deletes below.
func (p Periods) ContentEventCutoff(now time.Time) time.Time {
	return now.UTC().AddDate(0, 0, -p.ContentEventDays)
}

// DailyRankingSnapshotCutoff is the oldest period_end a purge running at now
// keeps. Snapshots are identified by calendar dates, so a run at any hour of
// the UTC day expires the same periods.
func (p Periods) DailyRankingSnapshotCutoff(now time.Time) time.Time {
	return utcDate(now).AddDate(0, 0, -p.DailyRankingSnapshotDays)
}

// WeeklyRankingSnapshotCutoff is DailyRankingSnapshotCutoff for weekly
// snapshots.
func (p Periods) WeeklyRankingSnapshotCutoff(now time.Time) time.Time {
	return utcDate(now).AddDate(0, 0, -p.WeeklyRankingSnapshotDays)
}

func utcDate(t time.Time) time.Time {
	year, month, day := t.UTC().Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

// Overrides are a tenant's own periods. A nil field follows the platform
// default.
type Overrides struct {
	WithdrawnCommentDays      *int
	ContentEventDays          *int
	DailyRankingSnapshotDays  *int
	WeeklyRankingSnapshotDays *int
}

// Validate reports the first override outside 1 to MaxDays. An override may
// be longer or shorter than the platform default.
func (o Overrides) Validate() error {
	for _, period := range []struct {
		name string
		days *int
	}{
		{"withdrawn_comment_days", o.WithdrawnCommentDays},
		{"content_event_days", o.ContentEventDays},
		{"daily_ranking_snapshot_days", o.DailyRankingSnapshotDays},
		{"weekly_ranking_snapshot_days", o.WeeklyRankingSnapshotDays},
	} {
		if period.days == nil {
			continue
		}
		if err := validateDays(period.name, *period.days); err != nil {
			return err
		}
	}
	return nil
}

// Apply is the one place an effective period is resolved: each override that
// is set replaces the matching default.
func (o Overrides) Apply(defaults Periods) Periods {
	effective := defaults
	for _, field := range []struct {
		override *int
		target   *int
	}{
		{o.WithdrawnCommentDays, &effective.WithdrawnCommentDays},
		{o.ContentEventDays, &effective.ContentEventDays},
		{o.DailyRankingSnapshotDays, &effective.DailyRankingSnapshotDays},
		{o.WeeklyRankingSnapshotDays, &effective.WeeklyRankingSnapshotDays},
	} {
		if field.override != nil {
			*field.target = *field.override
		}
	}
	return effective
}

// FromPlatformConfig reads a saved defaults row.
func FromPlatformConfig(config dbmodels.PlatformRetentionConfig) Periods {
	return Periods{
		WithdrawnCommentDays:      int(config.WithdrawnCommentDays),
		ContentEventDays:          int(config.ContentEventDays),
		DailyRankingSnapshotDays:  int(config.DailyRankingSnapshotDays),
		WeeklyRankingSnapshotDays: int(config.WeeklyRankingSnapshotDays),
	}
}

// PlatformConfigParams is the row that stores p. The insert takes the same
// fields, so its params convert from these.
func (p Periods) PlatformConfigParams() dbmodels.UpdatePlatformRetentionConfigParams {
	return dbmodels.UpdatePlatformRetentionConfigParams{
		WithdrawnCommentDays:      int32(p.WithdrawnCommentDays),
		ContentEventDays:          int32(p.ContentEventDays),
		DailyRankingSnapshotDays:  int32(p.DailyRankingSnapshotDays),
		WeeklyRankingSnapshotDays: int32(p.WeeklyRankingSnapshotDays),
	}
}

// FromTenantSettings reads a saved overrides row.
func FromTenantSettings(settings dbmodels.TenantRetentionSetting) Overrides {
	return Overrides{
		WithdrawnCommentDays:      daysFromColumn(settings.WithdrawnCommentDays),
		ContentEventDays:          daysFromColumn(settings.ContentEventDays),
		DailyRankingSnapshotDays:  daysFromColumn(settings.DailyRankingSnapshotDays),
		WeeklyRankingSnapshotDays: daysFromColumn(settings.WeeklyRankingSnapshotDays),
	}
}

// TenantSettingsInsertParams is the first row that stores o for tenantID.
func (o Overrides) TenantSettingsInsertParams(tenantID uuid.UUID) dbmodels.InsertTenantRetentionSettingsParams {
	update := o.TenantSettingsParams(tenantID)
	return dbmodels.InsertTenantRetentionSettingsParams{
		TenantID:                  update.TenantID,
		WithdrawnCommentDays:      update.WithdrawnCommentDays,
		ContentEventDays:          update.ContentEventDays,
		DailyRankingSnapshotDays:  update.DailyRankingSnapshotDays,
		WeeklyRankingSnapshotDays: update.WeeklyRankingSnapshotDays,
	}
}

// TenantSettingsParams is the row that stores o for tenantID.
func (o Overrides) TenantSettingsParams(tenantID uuid.UUID) dbmodels.UpdateTenantRetentionSettingsParams {
	return dbmodels.UpdateTenantRetentionSettingsParams{
		TenantID:                  tenantID,
		WithdrawnCommentDays:      daysToColumn(o.WithdrawnCommentDays),
		ContentEventDays:          daysToColumn(o.ContentEventDays),
		DailyRankingSnapshotDays:  daysToColumn(o.DailyRankingSnapshotDays),
		WeeklyRankingSnapshotDays: daysToColumn(o.WeeklyRankingSnapshotDays),
	}
}

func daysFromColumn(column sql.NullInt32) *int {
	if !column.Valid {
		return nil
	}
	days := int(column.Int32)
	return &days
}

func daysToColumn(days *int) sql.NullInt32 {
	if days == nil {
		return sql.NullInt32{}
	}
	return sql.NullInt32{Int32: int32(*days), Valid: true}
}

// DefaultsQuerier reads the platform defaults row.
type DefaultsQuerier interface {
	GetPlatformRetentionConfig(ctx context.Context) (dbmodels.PlatformRetentionConfig, error)
}

// ReadDefaults returns the platform defaults and the revision of the row they
// came from. A platform that has saved nothing gets Builtin at revision zero.
func ReadDefaults(ctx context.Context, q DefaultsQuerier) (Periods, int64, error) {
	config, err := q.GetPlatformRetentionConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return Builtin(), 0, nil
	}
	if err != nil {
		return Periods{}, 0, fmt.Errorf("read platform retention defaults: %w", err)
	}
	return FromPlatformConfig(config), config.Revision, nil
}

// Settings are one tenant's saved overrides beside what they resolve to.
type Settings struct {
	Overrides Overrides
	Defaults  Periods
	// Revision is the version of the tenant's row, or zero when it has saved
	// nothing.
	Revision int64
}

// Effective is the periods that apply to the tenant.
func (s Settings) Effective() Periods {
	return s.Overrides.Apply(s.Defaults)
}

// TenantQuerier reads what one tenant's periods resolve from.
type TenantQuerier interface {
	DefaultsQuerier
	GetTenantRetentionSettings(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantRetentionSetting, error)
}

// ReadTenant reads one tenant's overrides and the platform defaults they fall
// back to.
func ReadTenant(ctx context.Context, q TenantQuerier, tenantID uuid.UUID) (Settings, error) {
	defaults, _, err := ReadDefaults(ctx, q)
	if err != nil {
		return Settings{}, err
	}
	saved, err := q.GetTenantRetentionSettings(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{Defaults: defaults}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("read tenant retention settings: %w", err)
	}
	return Settings{Overrides: FromTenantSettings(saved), Defaults: defaults, Revision: saved.Revision}, nil
}

// TableQuerier reads every tenant's overrides at once.
type TableQuerier interface {
	DefaultsQuerier
	ListTenantRetentionSettings(ctx context.Context) ([]dbmodels.TenantRetentionSetting, error)
}

// Table holds what a batch spanning every tenant resolves each tenant's
// periods from, read once at the start of the run.
type Table struct {
	defaults  Periods
	overrides map[uuid.UUID]Overrides
}

// NewTable builds a Table from values a caller already holds. Tests state
// their retention with it.
func NewTable(defaults Periods, overrides map[uuid.UUID]Overrides) Table {
	return Table{defaults: defaults, overrides: overrides}
}

// LoadTable reads the platform defaults and every tenant's overrides.
func LoadTable(ctx context.Context, q TableQuerier) (Table, error) {
	defaults, _, err := ReadDefaults(ctx, q)
	if err != nil {
		return Table{}, err
	}
	rows, err := q.ListTenantRetentionSettings(ctx)
	if err != nil {
		return Table{}, fmt.Errorf("list tenant retention settings: %w", err)
	}
	overrides := make(map[uuid.UUID]Overrides, len(rows))
	for _, row := range rows {
		overrides[row.TenantID] = FromTenantSettings(row)
	}
	return Table{defaults: defaults, overrides: overrides}, nil
}

// Defaults is the periods of every tenant that overrides nothing.
func (t Table) Defaults() Periods {
	return t.defaults
}

// OverrideCount is how many tenants have saved an overrides row.
func (t Table) OverrideCount() int {
	return len(t.overrides)
}

// For is the periods that apply to tenantID.
func (t Table) For(tenantID uuid.UUID) Periods {
	return Settings{Overrides: t.overrides[tenantID], Defaults: t.defaults}.Effective()
}
