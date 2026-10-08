package maintenance

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/retention"
	"github.com/publira/publira/server/internal/testutil"
)

// A run by hand names its day, and a day whose events the purge has taken from
// one tenant is logged as skipped for that tenant rather than rebuilt from what
// is left, while a tenant that keeps its events longer still gets the day.
func TestContentStatsAggregationLogsATenantPastRetentionAsSkipped(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()

	purged := pg.SeedTenant(t, "MANUALPURGE1", "purged.manual.example.com", "Purged Manual Tenant")
	kept := pg.SeedTenant(t, "MANUALKEPT01", "kept.manual.example.com", "Kept Manual Tenant")
	setTenantTimeZone(t, pg.DB, purged.ID, "UTC")
	setTenantTimeZone(t, pg.DB, kept.ID, "UTC")
	if _, err := pg.DB.ExecContext(ctx,
		"INSERT INTO tenant_retention_settings (tenant_id, content_event_days) VALUES ($1, $2)", purged.ID, retention.MinContentEventDays,
	); err != nil {
		t.Fatalf("set tenant retention: %v", err)
	}
	statDate := utcDate(time.Now()).AddDate(0, 0, -retention.MinContentEventDays-5)
	for _, seed := range []struct {
		tenant  testutil.Tenant
		series  string
		episode string
	}{
		{purged, "MANUALPRGSER", "MANUALPRGEP1"},
		{kept, "MANUALKPTSER", "MANUALKPTEP1"},
	} {
		series := pg.SeedSeries(t, seed.tenant.ID, testutil.SeriesSeed{PublicID: seed.series})
		episode := pg.SeedEpisode(t, seed.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: seed.episode})
		insertView(t, pg.DB, seed.tenant.ID, series.ID, episode.ID, statDate.Add(12*time.Hour))
	}

	var logs bytes.Buffer
	deps := Deps{DB: pg.OpenContentStatsDB(t), Logger: slog.New(slog.NewJSONHandler(&logs, nil))}
	if err := (ContentStatsAggregation{Date: statDate}).Run(ctx, deps); err != nil {
		t.Fatalf("Run: %v", err)
	}

	if got := countRows(t, pg.DB, "SELECT count(*) FROM content_daily_stats WHERE tenant_id = $1", purged.ID); got != 0 {
		t.Fatalf("rebuilt %d rows for the tenant whose events are past retention, want none", got)
	}
	if got := countRows(t, pg.DB, "SELECT count(*) FROM content_daily_stats WHERE tenant_id = $1 AND stat_date = $2", kept.ID, statDate); got == 0 {
		t.Fatal("the tenant that keeps its events was not rebuilt")
	}

	skipped := map[string]string{}
	scanner := bufio.NewScanner(&logs)
	for scanner.Scan() {
		var record struct {
			Level    string `json:"level"`
			TenantID string `json:"tenant_id"`
			StatDate string `json:"stat_date"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			t.Fatalf("parse log line %q: %v", scanner.Text(), err)
		}
		if record.Level == slog.LevelWarn.String() && record.TenantID != "" {
			skipped[record.TenantID] = record.StatDate
		}
	}
	want := map[string]string{purged.ID.String(): statDate.Format(time.DateOnly)}
	if len(skipped) != len(want) || skipped[purged.ID.String()] != want[purged.ID.String()] {
		t.Fatalf("tenants logged as skipped = %v, want %v", skipped, want)
	}
}
