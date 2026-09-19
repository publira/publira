package retention

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// The built-in defaults are what the purge batches kept before the periods
// became settings, so an installation that saves nothing keeps its behaviour.
func TestBuiltinMatchesThePreviousDefaults(t *testing.T) {
	want := Periods{WithdrawnCommentDays: 180, ContentEventDays: 90, DailyRankingSnapshotDays: 90, WeeklyRankingSnapshotDays: 400}
	if got := Builtin(); got != want {
		t.Fatalf("Builtin() = %+v, want %+v", got, want)
	}
	if err := Builtin().Validate(); err != nil {
		t.Fatalf("Builtin().Validate() = %v, want nil", err)
	}
}

func TestPeriodsValidate(t *testing.T) {
	for name, mutate := range map[string]func(*Periods){
		"zero withdrawn comment days":       func(p *Periods) { p.WithdrawnCommentDays = 0 },
		"negative content event days":       func(p *Periods) { p.ContentEventDays = -1 },
		"zero daily ranking snapshot days":  func(p *Periods) { p.DailyRankingSnapshotDays = 0 },
		"too many weekly ranking snapshots": func(p *Periods) { p.WeeklyRankingSnapshotDays = MaxDays + 1 },
	} {
		t.Run(name, func(t *testing.T) {
			periods := Builtin()
			mutate(&periods)
			if err := periods.Validate(); err == nil {
				t.Fatalf("Validate(%+v) = nil, want an error", periods)
			}
		})
	}

	bounds := Periods{WithdrawnCommentDays: 1, ContentEventDays: MaxDays, DailyRankingSnapshotDays: 1, WeeklyRankingSnapshotDays: MaxDays}
	if err := bounds.Validate(); err != nil {
		t.Fatalf("Validate(%+v) = %v, want nil", bounds, err)
	}
}

func TestOverridesValidate(t *testing.T) {
	if err := (Overrides{}).Validate(); err != nil {
		t.Fatalf("empty overrides Validate() = %v, want nil", err)
	}
	// An override may be shorter or longer than the platform default.
	if err := (Overrides{WithdrawnCommentDays: new(1), WeeklyRankingSnapshotDays: new(MaxDays)}).Validate(); err != nil {
		t.Fatalf("Validate() = %v, want nil", err)
	}
	for _, overrides := range []Overrides{
		{WithdrawnCommentDays: new(0)},
		{ContentEventDays: new(-5)},
		{DailyRankingSnapshotDays: new(MaxDays + 1)},
	} {
		if err := overrides.Validate(); err == nil {
			t.Fatalf("Validate(%+v) = nil, want an error", overrides)
		}
	}
}

func TestOverridesApplyReplacesOnlyTheSetPeriods(t *testing.T) {
	defaults := Builtin()
	got := Overrides{ContentEventDays: new(30), WeeklyRankingSnapshotDays: new(800)}.Apply(defaults)
	want := Periods{
		WithdrawnCommentDays:      defaults.WithdrawnCommentDays,
		ContentEventDays:          30,
		DailyRankingSnapshotDays:  defaults.DailyRankingSnapshotDays,
		WeeklyRankingSnapshotDays: 800,
	}
	if got != want {
		t.Fatalf("Apply() = %+v, want %+v", got, want)
	}
	if got := (Overrides{}).Apply(defaults); got != defaults {
		t.Fatalf("empty Apply() = %+v, want the defaults %+v", got, defaults)
	}
}

// The deadline the console shows and the cutoff the purge deletes below are
// two sides of one comparison: a comment is deleted by a run at now exactly
// when its deadline is before now.
func TestWithdrawnCommentDeadlineAndCutoffAgree(t *testing.T) {
	periods := Periods{WithdrawnCommentDays: 7}
	withdrawnAt := time.Date(2026, time.March, 28, 23, 30, 0, 0, time.FixedZone("JST", 9*60*60))
	dueAt := periods.WithdrawnCommentPurgeDueAt(withdrawnAt)
	if want := withdrawnAt.UTC().Add(7 * 24 * time.Hour); !dueAt.Equal(want) {
		t.Fatalf("PurgeDueAt = %s, want %s", dueAt, want)
	}
	for _, tc := range []struct {
		now     time.Time
		deleted bool
	}{
		{dueAt.Add(-time.Second), false},
		{dueAt, false},
		{dueAt.Add(time.Second), true},
	} {
		deleted := withdrawnAt.Before(periods.WithdrawnCommentCutoff(tc.now))
		if deleted != tc.deleted {
			t.Fatalf("a run at %s deletes = %t, want %t", tc.now, deleted, tc.deleted)
		}
	}
}

func TestContentEventCutoff(t *testing.T) {
	now := time.Date(2026, time.September, 19, 13, 0, 0, 0, time.UTC)
	if got, want := (Periods{ContentEventDays: 30}).ContentEventCutoff(now), now.AddDate(0, 0, -30); !got.Equal(want) {
		t.Fatalf("ContentEventCutoff = %s, want %s", got, want)
	}
}

// Snapshot cutoffs are dates, so a run at any hour of the UTC day expires the
// same periods.
func TestRankingSnapshotCutoffsAreUTCDates(t *testing.T) {
	periods := Periods{DailyRankingSnapshotDays: 10, WeeklyRankingSnapshotDays: 20}
	for _, now := range []time.Time{
		time.Date(2026, time.September, 19, 0, 0, 0, 0, time.UTC),
		time.Date(2026, time.September, 19, 23, 59, 59, 0, time.UTC),
		time.Date(2026, time.September, 20, 8, 0, 0, 0, time.FixedZone("JST", 9*60*60)),
	} {
		if got, want := periods.DailyRankingSnapshotCutoff(now), time.Date(2026, time.September, 9, 0, 0, 0, 0, time.UTC); !got.Equal(want) {
			t.Fatalf("DailyRankingSnapshotCutoff(%s) = %s, want %s", now, got, want)
		}
		if got, want := periods.WeeklyRankingSnapshotCutoff(now), time.Date(2026, time.August, 30, 0, 0, 0, 0, time.UTC); !got.Equal(want) {
			t.Fatalf("WeeklyRankingSnapshotCutoff(%s) = %s, want %s", now, got, want)
		}
	}
}

func TestOverridesRoundTripThroughTheRow(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	overrides := Overrides{WithdrawnCommentDays: new(30), DailyRankingSnapshotDays: new(14)}
	params := overrides.TenantSettingsInsertParams(tenantID)
	row := dbmodels.TenantRetentionSetting{
		TenantID:                  params.TenantID,
		WithdrawnCommentDays:      params.WithdrawnCommentDays,
		ContentEventDays:          params.ContentEventDays,
		DailyRankingSnapshotDays:  params.DailyRankingSnapshotDays,
		WeeklyRankingSnapshotDays: params.WeeklyRankingSnapshotDays,
	}
	if row.TenantID != tenantID || row.ContentEventDays.Valid || row.WeeklyRankingSnapshotDays.Valid {
		t.Fatalf("params = %+v, want the tenant and NULL for every unset period", params)
	}
	got := FromTenantSettings(row).Apply(Builtin())
	if want := overrides.Apply(Builtin()); got != want {
		t.Fatalf("round trip = %+v, want %+v", got, want)
	}
}

type fakeQuerier struct {
	platform    *dbmodels.PlatformRetentionConfig
	tenants     []dbmodels.TenantRetentionSetting
	platformErr error
}

func (f fakeQuerier) GetPlatformRetentionConfig(context.Context) (dbmodels.PlatformRetentionConfig, error) {
	if f.platformErr != nil {
		return dbmodels.PlatformRetentionConfig{}, f.platformErr
	}
	if f.platform == nil {
		return dbmodels.PlatformRetentionConfig{}, sql.ErrNoRows
	}
	return *f.platform, nil
}

func (f fakeQuerier) GetTenantRetentionSettings(_ context.Context, tenantID uuid.UUID) (dbmodels.TenantRetentionSetting, error) {
	for _, row := range f.tenants {
		if row.TenantID == tenantID {
			return row, nil
		}
	}
	return dbmodels.TenantRetentionSetting{}, sql.ErrNoRows
}

func (f fakeQuerier) ListTenantRetentionSettings(context.Context) ([]dbmodels.TenantRetentionSetting, error) {
	return f.tenants, nil
}

// The admin API reads one tenant and the batches read the whole table, and
// both must land on the same periods for every tenant.
func TestReadTenantAndTableResolveTheSamePeriods(t *testing.T) {
	overridden := uuid.Must(uuid.NewV7())
	plain := uuid.Must(uuid.NewV7())
	q := fakeQuerier{
		platform: &dbmodels.PlatformRetentionConfig{WithdrawnCommentDays: 60, ContentEventDays: 45, DailyRankingSnapshotDays: 30, WeeklyRankingSnapshotDays: 365, Revision: 3},
		tenants: []dbmodels.TenantRetentionSetting{{
			TenantID:             overridden,
			WithdrawnCommentDays: sql.NullInt32{Int32: 400, Valid: true},
			ContentEventDays:     sql.NullInt32{Int32: 7, Valid: true},
			Revision:             2,
		}},
	}
	ctx := context.Background()
	table, err := LoadTable(ctx, q)
	if err != nil {
		t.Fatalf("LoadTable: %v", err)
	}
	if table.OverrideCount() != 1 {
		t.Fatalf("OverrideCount() = %d, want 1", table.OverrideCount())
	}

	for tenantID, want := range map[uuid.UUID]Periods{
		overridden: {WithdrawnCommentDays: 400, ContentEventDays: 7, DailyRankingSnapshotDays: 30, WeeklyRankingSnapshotDays: 365},
		plain:      {WithdrawnCommentDays: 60, ContentEventDays: 45, DailyRankingSnapshotDays: 30, WeeklyRankingSnapshotDays: 365},
	} {
		settings, err := ReadTenant(ctx, q, tenantID)
		if err != nil {
			t.Fatalf("ReadTenant: %v", err)
		}
		if got := settings.Effective(); got != want {
			t.Fatalf("ReadTenant(%s).Effective() = %+v, want %+v", tenantID, got, want)
		}
		if got := table.For(tenantID); got != want {
			t.Fatalf("Table.For(%s) = %+v, want %+v", tenantID, got, want)
		}
	}
}

func TestReadDefaults(t *testing.T) {
	ctx := context.Background()
	got, revision, err := ReadDefaults(ctx, fakeQuerier{})
	if err != nil || got != Builtin() || revision != 0 {
		t.Fatalf("ReadDefaults(nothing saved) = (%+v, %d, %v), want (Builtin, 0, nil)", got, revision, err)
	}

	boom := errors.New("connection refused")
	if _, _, err := ReadDefaults(ctx, fakeQuerier{platformErr: boom}); !errors.Is(err, boom) {
		t.Fatalf("ReadDefaults error = %v, want it to wrap %v", err, boom)
	}
	// A failed read must not quietly become the built-in defaults: a batch
	// deleting by them could remove rows a longer saved period protects.
	if _, err := LoadTable(ctx, fakeQuerier{platformErr: boom}); !errors.Is(err, boom) {
		t.Fatalf("LoadTable error = %v, want it to wrap %v", err, boom)
	}
}
