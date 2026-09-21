package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// A tenant sells on both surfaces until it states otherwise, a series and an
// episode follow the level above until they state otherwise, and no column
// takes a value naming no surface or a store listing that is not https.
func TestPurchaseAvailabilityDefaultsAndChecks(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "PURCHASETN01", "purchase.example.com", "admin-purchase.example.com", "Purchase Tenant")
	seriesID := mustInsertSeries(t, ctx, pg.DB, tenantID, "PURCHASESR01")
	episodeID := mustInsertEpisodeOfSeries(t, ctx, pg.DB, tenantID, seriesID, "PURCHASEEP01", 1)
	if _, err := pg.DB.ExecContext(ctx, `INSERT INTO tenant_config (tenant_id) VALUES ($1)`, tenantID); err != nil {
		t.Fatalf("insert tenant_config: %v", err)
	}

	var tenantDefault string
	var appStoreURL, googlePlayURL sql.NullString
	if err := pg.DB.QueryRowContext(ctx, `SELECT purchase_availability, app_store_url, google_play_url FROM tenant_config WHERE tenant_id = $1`, tenantID).Scan(&tenantDefault, &appStoreURL, &googlePlayURL); err != nil {
		t.Fatalf("read tenant_config: %v", err)
	}
	if tenantDefault != "all" {
		t.Fatalf("tenant purchase_availability = %s, want all so an existing tenant keeps selling on both surfaces", tenantDefault)
	}
	if appStoreURL.Valid || googlePlayURL.Valid {
		t.Fatalf("store listings = %v, %v, want none", appStoreURL, googlePlayURL)
	}
	var seriesValue, episodeValue sql.NullString
	if err := pg.DB.QueryRowContext(ctx, `SELECT purchase_availability FROM series WHERE id = $1`, seriesID).Scan(&seriesValue); err != nil {
		t.Fatalf("read series purchase_availability: %v", err)
	}
	if err := pg.DB.QueryRowContext(ctx, `SELECT purchase_availability FROM episodes WHERE id = $1`, episodeID).Scan(&episodeValue); err != nil {
		t.Fatalf("read episode purchase_availability: %v", err)
	}
	if seriesValue.Valid || episodeValue.Valid {
		t.Fatalf("series, episode purchase_availability = %v, %v, want NULL so both follow the level above", seriesValue, episodeValue)
	}

	checks := []struct {
		statement string
		arg       any
		check     string
	}{
		{`UPDATE tenant_config SET purchase_availability = $2 WHERE tenant_id = $1`, tenantID, "tenant_config_purchase_availability_check"},
		{`UPDATE series SET purchase_availability = $2 WHERE id = $1`, seriesID, "series_purchase_availability_check"},
		{`UPDATE episodes SET purchase_availability = $2 WHERE id = $1`, episodeID, "episodes_purchase_availability_check"},
	}
	for _, tc := range checks {
		for _, value := range []string{"all", "web", "app"} {
			if _, err := pg.DB.ExecContext(ctx, tc.statement, tc.arg, value); err != nil {
				t.Fatalf("%s with %s: %v", tc.check, value, err)
			}
		}
		_, err := pg.DB.ExecContext(ctx, tc.statement, tc.arg, "tv")
		if !isCheckViolation(err) || checkName(err) != tc.check {
			t.Fatalf("unknown value error = %v (%s), want %s", err, checkName(err), tc.check)
		}
	}

	for _, column := range []string{"app_store_url", "google_play_url"} {
		statement := `UPDATE tenant_config SET ` + column + ` = $2 WHERE tenant_id = $1`
		if _, err := pg.DB.ExecContext(ctx, statement, tenantID, "https://store.example.com/app?id=com.example"); err != nil {
			t.Fatalf("set %s: %v", column, err)
		}
		for _, value := range []string{"http://store.example.com/app", "https://store.example.com/my app", ""} {
			_, err := pg.DB.ExecContext(ctx, statement, tenantID, value)
			if want := "tenant_config_" + column + "_check"; !isCheckViolation(err) || checkName(err) != want {
				t.Fatalf("%s = %q error = %v (%s), want %s", column, value, err, checkName(err), want)
			}
		}
	}
}

// The view answers where an episode may be bought: the nearest level that
// states a value, where each level replaces the one above rather than bounding
// it, and both surfaces for a tenant with no config row.
func TestEpisodePurchaseAvailabilityResolvesTenantSeriesEpisode(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "PURCHASETN02", "purchase-view.example.com", "admin-purchase-view.example.com", "Purchase View Tenant")
	seriesID := mustInsertSeries(t, ctx, pg.DB, tenantID, "PURCHASESR02")
	episodeID := mustInsertEpisodeOfSeries(t, ctx, pg.DB, tenantID, seriesID, "PURCHASEEP02", 1)

	resolved := func() string {
		t.Helper()
		var value string
		if err := pg.DB.QueryRowContext(ctx, `SELECT purchase_availability FROM episode_purchase_availability WHERE episode_id = $1`, episodeID).Scan(&value); err != nil {
			t.Fatalf("read episode_purchase_availability: %v", err)
		}
		return value
	}
	if got := resolved(); got != "all" {
		t.Fatalf("without a tenant config row: %s, want all", got)
	}
	if _, err := pg.DB.ExecContext(ctx, `INSERT INTO tenant_config (tenant_id) VALUES ($1)`, tenantID); err != nil {
		t.Fatalf("insert tenant_config: %v", err)
	}

	value := func(v string) sql.NullString { return sql.NullString{String: v, Valid: true} }
	tests := []struct {
		name    string
		tenant  string
		series  sql.NullString
		episode sql.NullString
		want    string
	}{
		{name: "the tenant default", tenant: "all", want: "all"},
		{name: "an app-only tenant", tenant: "app", want: "app"},
		{name: "a series replacing the tenant", tenant: "app", series: value("web"), want: "web"},
		{name: "a series widening the tenant", tenant: "app", series: value("all"), want: "all"},
		{name: "an episode following its series", tenant: "all", series: value("app"), want: "app"},
		{name: "an episode replacing its series", tenant: "all", series: value("app"), episode: value("web"), want: "web"},
		{name: "an episode replacing the tenant", tenant: "web", episode: value("app"), want: "app"},
	}
	for _, tc := range tests {
		if _, err := pg.DB.ExecContext(ctx, `UPDATE tenant_config SET purchase_availability = $2 WHERE tenant_id = $1`, tenantID, tc.tenant); err != nil {
			t.Fatalf("%s: set tenant: %v", tc.name, err)
		}
		if _, err := pg.DB.ExecContext(ctx, `UPDATE series SET purchase_availability = $2 WHERE id = $1`, seriesID, tc.series); err != nil {
			t.Fatalf("%s: set series: %v", tc.name, err)
		}
		if _, err := pg.DB.ExecContext(ctx, `UPDATE episodes SET purchase_availability = $2 WHERE id = $1`, episodeID, tc.episode); err != nil {
			t.Fatalf("%s: set episode: %v", tc.name, err)
		}
		if got := resolved(); got != tc.want {
			t.Fatalf("%s: resolved = %s, want %s", tc.name, got, tc.want)
		}
	}

	// Another tenant's default never reaches this episode.
	otherTenantID := mustInsertTenant(t, ctx, pg.DB, "PURCHASETN03", "purchase-other.example.com", "admin-purchase-other.example.com", "Purchase Other Tenant")
	if _, err := pg.DB.ExecContext(ctx, `INSERT INTO tenant_config (tenant_id, purchase_availability) VALUES ($1, 'web')`, otherTenantID); err != nil {
		t.Fatalf("insert other tenant_config: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `UPDATE tenant_config SET purchase_availability = 'app' WHERE tenant_id = $1`, tenantID); err != nil {
		t.Fatalf("set tenant: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `UPDATE series SET purchase_availability = NULL WHERE id = $1`, seriesID); err != nil {
		t.Fatalf("clear series: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `UPDATE episodes SET purchase_availability = NULL WHERE id = $1`, episodeID); err != nil {
		t.Fatalf("clear episode: %v", err)
	}
	if got := resolved(); got != "app" {
		t.Fatalf("with another tenant configured: resolved = %s, want app", got)
	}
}
