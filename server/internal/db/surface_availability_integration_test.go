package dbtest

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// A series is on both surfaces until it states otherwise, an episode follows its
// series until it states otherwise, and neither column takes a value naming no
// surface.
func TestSurfaceAvailabilityDefaultsAndChecks(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "SURFACETN01", "surface.example.com", "admin-surface.example.com", "Surface Tenant")
	seriesID := mustInsertSeries(t, ctx, pg.DB, tenantID, "SURFACESR01")
	episodeID := mustInsertEpisodeOfSeries(t, ctx, pg.DB, tenantID, seriesID, "SURFACEEP01", 1)

	var seriesAvailability string
	if err := pg.DB.QueryRowContext(ctx, `SELECT availability FROM series WHERE id = $1`, seriesID).Scan(&seriesAvailability); err != nil {
		t.Fatalf("read series availability: %v", err)
	}
	if seriesAvailability != "all" {
		t.Fatalf("series availability = %s, want all so an existing series stays on both surfaces", seriesAvailability)
	}
	var episodeAvailability sql.NullString
	if err := pg.DB.QueryRowContext(ctx, `SELECT availability FROM episodes WHERE id = $1`, episodeID).Scan(&episodeAvailability); err != nil {
		t.Fatalf("read episode availability: %v", err)
	}
	if episodeAvailability.Valid {
		t.Fatalf("episode availability = %s, want NULL so an episode follows its series", episodeAvailability.String)
	}

	for _, value := range []string{"web", "app", "all"} {
		if _, err := pg.DB.ExecContext(ctx, `UPDATE series SET availability = $2 WHERE id = $1`, seriesID, value); err != nil {
			t.Fatalf("set series availability %s: %v", value, err)
		}
		if _, err := pg.DB.ExecContext(ctx, `UPDATE episodes SET availability = $2 WHERE id = $1`, episodeID, value); err != nil {
			t.Fatalf("set episode availability %s: %v", value, err)
		}
	}

	_, err := pg.DB.ExecContext(ctx, `UPDATE series SET availability = 'tv' WHERE id = $1`, seriesID)
	if !isCheckViolation(err) || checkName(err) != "series_availability_check" {
		t.Fatalf("unknown series availability error = %v (%s), want series_availability_check", err, checkName(err))
	}
	_, err = pg.DB.ExecContext(ctx, `UPDATE episodes SET availability = 'tv' WHERE id = $1`, episodeID)
	if !isCheckViolation(err) || checkName(err) != "episodes_availability_check" {
		t.Fatalf("unknown episode availability error = %v (%s), want episodes_availability_check", err, checkName(err))
	}
}

// The views answer each combination of series and episode availability with
// the surfaces the episode is shown on: the series bounds the episode, so an
// episode can narrow its series' surfaces but never add one.
func TestEpisodeSurfacesAreBoundedByTheSeries(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "SURFACETN02", "surface-view.example.com", "admin-surface-view.example.com", "Surface View Tenant")
	seriesID := mustInsertSeries(t, ctx, pg.DB, tenantID, "SURFACESR02")
	episodeID := mustInsertEpisodeOfSeries(t, ctx, pg.DB, tenantID, seriesID, "SURFACEEP02", 1)

	tests := []struct {
		series  string
		episode sql.NullString
		want    []string
	}{
		{series: "all", want: []string{"app", "web"}},
		{series: "web", want: []string{"web"}},
		{series: "all", episode: sql.NullString{String: "app", Valid: true}, want: []string{"app"}},
		{series: "app", episode: sql.NullString{String: "all", Valid: true}, want: []string{"app"}},
		{series: "web", episode: sql.NullString{String: "app", Valid: true}, want: []string{}},
	}
	for _, tc := range tests {
		if _, err := pg.DB.ExecContext(ctx, `UPDATE series SET availability = $2 WHERE id = $1`, seriesID, tc.series); err != nil {
			t.Fatalf("set series availability: %v", err)
		}
		if _, err := pg.DB.ExecContext(ctx, `UPDATE episodes SET availability = $2 WHERE id = $1`, episodeID, tc.episode); err != nil {
			t.Fatalf("set episode availability: %v", err)
		}
		rows, err := pg.DB.QueryContext(ctx, `SELECT surface FROM episode_surfaces WHERE episode_id = $1 ORDER BY surface`, episodeID)
		if err != nil {
			t.Fatalf("read episode_surfaces: %v", err)
		}
		got := []string{}
		for rows.Next() {
			var surface string
			if err := rows.Scan(&surface); err != nil {
				t.Fatalf("scan surface: %v", err)
			}
			got = append(got, surface)
		}
		if err := rows.Close(); err != nil {
			t.Fatalf("close rows: %v", err)
		}
		if !slices.Equal(got, tc.want) {
			t.Fatalf("series %s, episode %v: surfaces = %v, want %v", tc.series, tc.episode, got, tc.want)
		}
	}
}
