package dbtest

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/testutil"
)

// db/seeds/scenarios/170_ranking.sql writes the rankings the E2E stack starts
// from, and the worker keeps rebuilding rankings while a run goes on. The
// screens read the newest period, so a pass that ranks a day after the seeded
// periods hides them behind a snapshot of nothing. The tenant's midnight is
// passed by moving the tenant from UTC-12 to UTC+12 between applying the file
// and running the chain: the two zones are a day apart at every instant, so the
// chain sees the day after the one the file was applied on, whatever the time
// of day the test runs at.
func TestRankingScenarioSurvivesTheTenantsMidnight(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	devSeed := filepath.Join("..", "..", "..", "db", "seeds", "dev.sql")
	if _, err := pg.DB.ExecContext(ctx, readSeedSQL(t, devSeed, map[string]string{"tenant_port": "3080"})); err != nil {
		t.Fatalf("apply %s: %v", devSeed, err)
	}

	setSeedTenantTimeZone := func(zone string) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx,
			`UPDATE tenants SET timezone = $1 WHERE public_id = 'SeedTNNTAAA1'`, zone,
		); err != nil {
			t.Fatalf("move the seed tenant to %s: %v", zone, err)
		}
	}

	setSeedTenantTimeZone("Etc/GMT+12")
	ranking := filepath.Join("..", "..", "..", "db", "seeds", "scenarios", "170_ranking.sql")
	if _, err := pg.DB.ExecContext(ctx, readSeedSQL(t, ranking, map[string]string{})); err != nil {
		t.Fatalf("apply %s: %v", ranking, err)
	}

	const newestPeriod = `
		SELECT max(s.period_end)
		FROM content_ranking_snapshots s
		JOIN tenants t ON t.id = s.tenant_id
		WHERE t.public_id = 'SeedTNNTAAA1'`

	var seeded time.Time
	if err := pg.DB.QueryRowContext(ctx, newestPeriod).Scan(&seeded); err != nil {
		t.Fatalf("read the seeded periods: %v", err)
	}

	setSeedTenantTimeZone("Etc/GMT-12")
	deps := maintenance.Deps{DB: pg.DB, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := (maintenance.EpisodeReadProjection{BatchSize: 500}).CatchUp(ctx, deps); err != nil {
		t.Fatalf("project episode reads: %v", err)
	}
	if err := (maintenance.ContentStatsAggregation{}).CatchUp(ctx, deps); err != nil {
		t.Fatalf("aggregate content stats: %v", err)
	}
	if err := (maintenance.RankingAggregation{ItemLimit: 10}).CatchUp(ctx, deps); err != nil {
		t.Fatalf("aggregate rankings: %v", err)
	}

	var newest time.Time
	if err := pg.DB.QueryRowContext(ctx, newestPeriod).Scan(&newest); err != nil {
		t.Fatalf("read the periods after the worker's pass: %v", err)
	}
	if !newest.Equal(seeded) {
		t.Fatalf("the worker ranked a period ending %s in front of the seeded one ending %s",
			newest.Format(time.DateOnly), seeded.Format(time.DateOnly))
	}
}
