package maintenance

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantday"
	"github.com/publira/publira/server/internal/testutil"
)

// A worker that was down for four days comes back to a tenant whose chain
// stopped four days ago. Every one of those days has to be rebuilt, and each
// link only as far as the one before it has got.
func TestCatchUpRebuildsEveryMissedDayInDependencyOrder(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()

	tenant := pg.SeedTenant(t, "CATCHUPTNT01", "catchup.example.com", "Catch-up Tenant")
	setTenantTimeZone(t, pg.DB, tenant.ID, "UTC")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "CATCHUPSER01"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "CATCHUPEP001"})

	now := time.Now()
	yesterday := utcDate(now).AddDate(0, 0, -1)
	stoppedOn := yesterday.AddDate(0, 0, -4)
	seedProgress(t, pg.DB, tenant.ID, now, stoppedOn)
	missed := []time.Time{
		yesterday.AddDate(0, 0, -3),
		yesterday.AddDate(0, 0, -2),
		yesterday.AddDate(0, 0, -1),
		yesterday,
	}
	for _, day := range missed {
		insertView(t, pg.DB, tenant.ID, series.ID, episode.ID, day.Add(12*time.Hour))
	}

	deps := Deps{DB: pg.OpenContentStatsDB(t), Logger: discardLogger()}
	rankings := RankingAggregation{ItemLimit: 10}
	features := RecommendFeatureBuild{WindowDays: 28}

	// Rankings read the stats, so before the stats have moved there is
	// nothing for them to rank.
	if err := rankings.CatchUp(ctx, deps); err != nil {
		t.Fatalf("rankings CatchUp before stats: %v", err)
	}
	if got := readProgress(t, pg.DB, tenant.ID); !got.RankingsThrough.Equal(stoppedOn) {
		t.Fatalf("rankings_through = %s before the stats moved, want %s", got.RankingsThrough.Format(time.DateOnly), stoppedOn.Format(time.DateOnly))
	}

	if err := (ContentStatsAggregation{}).CatchUp(ctx, deps); err != nil {
		t.Fatalf("content stats CatchUp: %v", err)
	}
	if err := rankings.CatchUp(ctx, deps); err != nil {
		t.Fatalf("rankings CatchUp: %v", err)
	}
	if err := features.CatchUp(ctx, deps); err != nil {
		t.Fatalf("recommend features CatchUp: %v", err)
	}

	for _, day := range missed {
		if got := countRows(t, pg.DB, "SELECT count(*) FROM content_daily_stats WHERE tenant_id = $1 AND stat_date = $2", tenant.ID, day); got == 0 {
			t.Fatalf("no content_daily_stats for %s", day.Format(time.DateOnly))
		}
		if got := countRows(t, pg.DB, "SELECT count(*) FROM content_ranking_snapshots WHERE tenant_id = $1 AND ranking_key = 'daily' AND period_end = $2", tenant.ID, day); got == 0 {
			t.Fatalf("no daily ranking snapshot for %s", day.Format(time.DateOnly))
		}
	}
	if got := countRows(t, pg.DB, "SELECT count(*) FROM item_recommend_features WHERE tenant_id = $1", tenant.ID); got == 0 {
		t.Fatal("no item recommend features after the catch-up")
	}
	got := readProgress(t, pg.DB, tenant.ID)
	for name, through := range map[string]time.Time{
		"content_stats_through":      got.ContentStatsThrough,
		"rankings_through":           got.RankingsThrough,
		"recommend_features_through": got.RecommendFeaturesThrough,
	} {
		if !through.Equal(yesterday) {
			t.Fatalf("%s = %s, want %s", name, through.Format(time.DateOnly), yesterday.Format(time.DateOnly))
		}
	}
}

// A day is the tenant's own, and a day may be aggregated only once it ended
// before the projection that filed its reads began. 2026-08-28T20:00Z is
// already the 29th in Seoul and still the 28th in Los Angeles, so the same
// projection lets Seoul through the 28th and Los Angeles only through the 27th.
func TestContentStatsCatchUpStopsAtEachTenantsLastProjectedDay(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()

	projectedAt := time.Date(2026, time.August, 28, 20, 0, 0, 0, time.UTC)
	stoppedOn := time.Date(2026, time.August, 25, 0, 0, 0, 0, time.UTC)
	seoul := pg.SeedTenant(t, "CATCHUPSEL01", "seoul.catchup.example.com", "Seoul Catch-up Tenant")
	losAngeles := pg.SeedTenant(t, "CATCHUPLAX01", "la.catchup.example.com", "Los Angeles Catch-up Tenant")
	setTenantTimeZone(t, pg.DB, seoul.ID, "Asia/Seoul")
	setTenantTimeZone(t, pg.DB, losAngeles.ID, "America/Los_Angeles")
	seedProgress(t, pg.DB, seoul.ID, projectedAt, stoppedOn)
	seedProgress(t, pg.DB, losAngeles.ID, projectedAt, stoppedOn)

	deps := Deps{DB: pg.OpenContentStatsDB(t), Logger: discardLogger()}
	if err := (ContentStatsAggregation{}).CatchUp(ctx, deps); err != nil {
		t.Fatalf("CatchUp: %v", err)
	}

	for tenantID, want := range map[uuid.UUID]string{seoul.ID: "2026-08-28", losAngeles.ID: "2026-08-27"} {
		if got := readProgress(t, pg.DB, tenantID).ContentStatsThrough.Format(time.DateOnly); got != want {
			t.Fatalf("content_stats_through of %s = %s, want %s", tenantID, got, want)
		}
	}
}

// A tenant the record has not seen starts on its own yesterday, and a tenant it
// has seen keeps its progress while the projection instant moves forward.
func TestEpisodeReadProjectionCatchUpRecordsEveryTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()

	fresh := pg.SeedTenant(t, "CATCHUPNEW01", "new.catchup.example.com", "New Catch-up Tenant")
	known := pg.SeedTenant(t, "CATCHUPOLD01", "old.catchup.example.com", "Known Catch-up Tenant")
	setTenantTimeZone(t, pg.DB, fresh.ID, "UTC")
	setTenantTimeZone(t, pg.DB, known.ID, "UTC")
	longAgo := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	seedProgress(t, pg.DB, known.ID, longAgo.Add(time.Hour), longAgo)

	before := time.Now()
	deps := Deps{DB: pg.OpenContentStatsDB(t), Logger: discardLogger()}
	if err := (EpisodeReadProjection{BatchSize: 100}).CatchUp(ctx, deps); err != nil {
		t.Fatalf("CatchUp: %v", err)
	}

	got := readProgress(t, pg.DB, fresh.ID)
	if want := utcDate(got.EpisodeReadsProjectedAt).AddDate(0, 0, -2); !got.ContentStatsThrough.Equal(want) ||
		!got.RankingsThrough.Equal(want) || !got.RecommendFeaturesThrough.Equal(want) {
		t.Fatalf("new tenant progress = %+v, want every link on %s", got, want.Format(time.DateOnly))
	}
	if got.EpisodeReadsProjectedAt.Before(before.Add(-time.Second)) {
		t.Fatalf("new tenant projected at %s, want no earlier than the pass", got.EpisodeReadsProjectedAt)
	}

	got = readProgress(t, pg.DB, known.ID)
	if !got.ContentStatsThrough.Equal(longAgo) {
		t.Fatalf("known tenant content_stats_through = %s, want %s kept", got.ContentStatsThrough.Format(time.DateOnly), longAgo.Format(time.DateOnly))
	}
	if got.EpisodeReadsProjectedAt.Before(before.Add(-time.Second)) {
		t.Fatalf("known tenant projected at %s, want it moved to the pass", got.EpisodeReadsProjectedAt)
	}
}

// A failed day stops that tenant's progress there, so the next pass starts on
// it rather than behind a later day that succeeded. The other tenant carries
// on, and the pass still reports the failure.
func TestCatchUpStopsATenantAtTheDayThatFailedAndResumesThere(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()

	failing := pg.SeedTenant(t, "CATCHUPFAIL1", "fail.catchup.example.com", "Failing Catch-up Tenant")
	healthy := pg.SeedTenant(t, "CATCHUPOKAY1", "okay.catchup.example.com", "Healthy Catch-up Tenant")
	stoppedOn := time.Date(2026, time.August, 25, 0, 0, 0, 0, time.UTC)
	last := stoppedOn.AddDate(0, 0, 3)
	broken := stoppedOn.AddDate(0, 0, 2)
	seedProgress(t, pg.DB, failing.ID, time.Now(), stoppedOn)
	seedProgress(t, pg.DB, healthy.ID, time.Now(), stoppedOn)

	errBroken := errors.New("broken day")
	var (
		fail  = true
		calls = map[uuid.UUID][]string{}
	)
	link := catchUpLink{
		name: "test",
		pending: func(_ tenantday.Tenant, p dbmodels.ListDailyRebuildProgressRow) (time.Time, time.Time, error) {
			return civilDate(p.ContentStatsThrough).AddDate(0, 0, 1), last, nil
		},
		rebuild: func(_ context.Context, tenant tenantday.Tenant, day time.Time) (int64, error) {
			calls[tenant.ID] = append(calls[tenant.ID], day.Format(time.DateOnly))
			if fail && tenant.ID == failing.ID && day.Equal(broken) {
				return 0, errBroken
			}
			return 1, nil
		},
		advance: func(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, day time.Time) error {
			return q.AdvanceContentStatsThrough(ctx, dbmodels.AdvanceContentStatsThroughParams{TenantID: tenantID, Through: day})
		},
	}
	deps := Deps{DB: pg.OpenContentStatsDB(t), Logger: discardLogger()}

	if err := catchUp(ctx, deps, link); !errors.Is(err, errBroken) {
		t.Fatalf("first pass error = %v, want %v", err, errBroken)
	}
	if got := readProgress(t, pg.DB, failing.ID).ContentStatsThrough; !got.Equal(broken.AddDate(0, 0, -1)) {
		t.Fatalf("failing tenant through = %s after the failure, want the day before it", got.Format(time.DateOnly))
	}
	if got := readProgress(t, pg.DB, healthy.ID).ContentStatsThrough; !got.Equal(last) {
		t.Fatalf("healthy tenant through = %s, want %s", got.Format(time.DateOnly), last.Format(time.DateOnly))
	}
	if want := []string{"2026-08-26", "2026-08-27"}; !slices.Equal(calls[failing.ID], want) {
		t.Fatalf("failing tenant rebuilt %v on the first pass, want %v and nothing after the failure", calls[failing.ID], want)
	}

	fail = false
	calls = map[uuid.UUID][]string{}
	if err := catchUp(ctx, deps, link); err != nil {
		t.Fatalf("second pass: %v", err)
	}
	if want := []string{"2026-08-27", "2026-08-28"}; !slices.Equal(calls[failing.ID], want) {
		t.Fatalf("failing tenant rebuilt %v on the retry, want %v", calls[failing.ID], want)
	}
	if len(calls[healthy.ID]) != 0 {
		t.Fatalf("healthy tenant rebuilt %v on the retry, want nothing", calls[healthy.ID])
	}
	if got := readProgress(t, pg.DB, failing.ID).ContentStatsThrough; !got.Equal(last) {
		t.Fatalf("failing tenant through = %s after the retry, want %s", got.Format(time.DateOnly), last.Format(time.DateOnly))
	}
}

func seedProgress(t *testing.T, db *sql.DB, tenantID uuid.UUID, projectedAt, through time.Time) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), `
		INSERT INTO daily_rebuild_progress (
			tenant_id, episode_reads_projected_at, content_stats_through, rankings_through, recommend_features_through
		) VALUES ($1, $2, $3, $3, $3)
	`, tenantID, projectedAt, through); err != nil {
		t.Fatalf("seed daily rebuild progress: %v", err)
	}
}

func readProgress(t *testing.T, db *sql.DB, tenantID uuid.UUID) dbmodels.ListDailyRebuildProgressRow {
	t.Helper()
	var row dbmodels.ListDailyRebuildProgressRow
	if err := db.QueryRowContext(context.Background(), `
		SELECT tenant_id, episode_reads_projected_at, content_stats_through, rankings_through, recommend_features_through
		FROM daily_rebuild_progress WHERE tenant_id = $1
	`, tenantID).Scan(&row.TenantID, &row.EpisodeReadsProjectedAt, &row.ContentStatsThrough, &row.RankingsThrough, &row.RecommendFeaturesThrough); err != nil {
		t.Fatalf("read daily rebuild progress: %v", err)
	}
	row.ContentStatsThrough = civilDate(row.ContentStatsThrough)
	row.RankingsThrough = civilDate(row.RankingsThrough)
	row.RecommendFeaturesThrough = civilDate(row.RecommendFeaturesThrough)
	return row
}

func setTenantTimeZone(t *testing.T, db *sql.DB, tenantID uuid.UUID, timeZone string) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), "UPDATE tenants SET timezone = $2 WHERE id = $1", tenantID, timeZone); err != nil {
		t.Fatalf("set tenant time zone: %v", err)
	}
}

func insertView(t *testing.T, db *sql.DB, tenantID, seriesID, episodeID uuid.UUID, occurredAt time.Time) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), `
		INSERT INTO content_events (id, tenant_id, event_type, anonymous_id, series_id, episode_id, debounce_bucket, occurred_at)
		VALUES ($1, $2, 'episode_view', $3, $4, $5, 1, $6)
	`, uuid.Must(uuid.NewV7()), tenantID, uuid.Must(uuid.NewV7()), seriesID, episodeID, occurredAt); err != nil {
		t.Fatalf("insert view: %v", err)
	}
}

func countRows(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRowContext(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return n
}

func utcDate(at time.Time) time.Time { return civilDate(at.UTC()) }

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// Row-level security would hide every progress row from a role without
// BYPASSRLS, and a pass that saw none would succeed having rebuilt nothing.
func TestCatchUpRefusesARoleUnderRowLevelSecurity(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	deps := Deps{DB: pg.OpenAdminDB(t), Logger: discardLogger()}
	if err := (ContentStatsAggregation{}).CatchUp(context.Background(), deps); err == nil {
		t.Fatal("CatchUp under row-level security returned no error, want one")
	}
}

// A day that began before the tenant's content event retention cutoff has lost
// its events to the purge, so rebuilding it would record a partial day as
// complete. It is passed over instead, and the days still retained are rebuilt.
func TestContentStatsCatchUpPassesOverDaysPastRetention(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()

	tenant := pg.SeedTenant(t, "CATCHUPRETN1", "retention.catchup.example.com", "Retention Catch-up Tenant")
	setTenantTimeZone(t, pg.DB, tenant.ID, "UTC")
	if _, err := pg.DB.ExecContext(ctx,
		"INSERT INTO tenant_retention_settings (tenant_id, content_event_days) VALUES ($1, 2)", tenant.ID,
	); err != nil {
		t.Fatalf("set tenant retention: %v", err)
	}
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "CATCHUPRSER1"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "CATCHUPREP01"})

	now := time.Now()
	yesterday := utcDate(now).AddDate(0, 0, -1)
	stoppedOn := yesterday.AddDate(0, 0, -4)
	seedProgress(t, pg.DB, tenant.ID, now, stoppedOn)
	// Two days of retention keep only yesterday whole: the cutoff falls inside
	// the day before it. The older events are left in place, standing in for
	// what the purge would have left of those days.
	for day := stoppedOn.AddDate(0, 0, 1); !day.After(yesterday); day = day.AddDate(0, 0, 1) {
		insertView(t, pg.DB, tenant.ID, series.ID, episode.ID, day.Add(12*time.Hour))
	}

	deps := Deps{DB: pg.OpenContentStatsDB(t), Logger: discardLogger()}
	if err := (ContentStatsAggregation{}).CatchUp(ctx, deps); err != nil {
		t.Fatalf("CatchUp: %v", err)
	}

	if got := countRows(t, pg.DB, "SELECT count(DISTINCT stat_date) FROM content_daily_stats WHERE tenant_id = $1", tenant.ID); got != 1 {
		t.Fatalf("rebuilt %d days, want only yesterday", got)
	}
	if got := countRows(t, pg.DB, "SELECT count(*) FROM content_daily_stats WHERE tenant_id = $1 AND stat_date = $2", tenant.ID, yesterday); got == 0 {
		t.Fatal("yesterday was not rebuilt")
	}
	if got := readProgress(t, pg.DB, tenant.ID).ContentStatsThrough; !got.Equal(yesterday) {
		t.Fatalf("content_stats_through = %s, want %s", got.Format(time.DateOnly), yesterday.Format(time.DateOnly))
	}
}
