package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) exportStats(t *testing.T, tenant adminDBTenant, req *publiraadminv1.ExportStatsRequest) string {
	t.Helper()

	req.Tenant = tenant.tenantContext()
	res, err := e.engagementClient().ExportStats(testutil.WithBearer(context.Background(), tenant.token()), req)
	if err != nil {
		t.Fatalf("ExportStats %s: %v", req.Kind, err)
	}
	return string(res.Csv)
}

// csvFile is the bytes a CSV export should hold: the byte order mark, then
// each line ended by CRLF.
func csvFile(lines ...string) string {
	file := "\xEF\xBB\xBF"
	for _, line := range lines {
		file += line + "\r\n"
	}
	return file
}

// Each revenue export holds the rows GetRevenueStats answers for its grouping,
// a ranked one all of them at once, and is recorded against its period.
func TestDBAdminExportStatsWritesTheRevenueReports(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRevenueFixture(t, "RVX")
	currency := env.PG.TenantCurrency(t, f.admin.Tenant.ID)
	export := func(kind publiraadminv1.StatsExportKind) string {
		return env.exportStats(t, f.admin, &publiraadminv1.ExportStatsRequest{Kind: kind, StartDate: "2026-01-10", EndDate: "2026-01-13"})
	}

	if got, want := export(publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_DAY), csvFile(
		"date,purchase_count,gross_amount,refunded_amount,net_amount,currency",
		"2026-01-10,1,500,0,500,"+currency,
		"2026-01-11,2,800,300,500,"+currency,
		"2026-01-12,1,500,500,0,"+currency,
		"2026-01-13,0,0,0,0,"+currency,
	); got != want {
		t.Fatalf("by day csv =\n%q\nwant\n%q", got, want)
	}

	if got, want := export(publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_SERIES), csvFile(
		"start_date,end_date,series_id,series_title,purchase_count,gross_amount,refunded_amount,net_amount,currency",
		"2026-01-10,2026-01-13,RVXSERIES01,Royalty Series,3,1600,600,1000,"+currency,
		"2026-01-10,2026-01-13,RVXSERIES02,Other Series,1,200,200,0,"+currency,
	); got != want {
		t.Fatalf("by series csv =\n%q\nwant\n%q", got, want)
	}

	if got, want := export(publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_EPISODE), csvFile(
		"start_date,end_date,series_id,series_title,episode_id,episode_title,purchase_count,gross_amount,refunded_amount,net_amount,currency",
		"2026-01-10,2026-01-13,RVXSERIES01,Royalty Series,RVXEPISODE1,Episode 1,3,1375,562,813,"+currency,
		"2026-01-10,2026-01-13,RVXSERIES01,Royalty Series,RVXEPISODE2,Episode 2,1,225,37,188,"+currency,
		"2026-01-10,2026-01-13,RVXSERIES02,Other Series,RVXOTHEREP1,Other Episode,1,200,200,0,"+currency,
	); got != want {
		t.Fatalf("by episode csv =\n%q\nwant\n%q", got, want)
	}

	if count := env.countRows(t, `
		SELECT count(*) FROM audit_logs
		WHERE tenant_id = $1 AND action = 'stats_exported' AND target_type = 'revenue_stats' AND target_id = '2026-01-10/2026-01-13'
	`, f.admin.Tenant.ID); count != 3 {
		t.Fatalf("export audit entries = %d, want one per export", count)
	}
}

// The audience exports hold the rows GetAudienceStats answers, every series
// in one file, and one narrowed to a series is recorded against that series.
func TestDBAdminExportStatsWritesTheAudienceReports(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedAudienceFixture(t, "AUX")
	export := func(kind publiraadminv1.StatsExportKind, seriesPublicID string) string {
		return env.exportStats(t, f.admin, &publiraadminv1.ExportStatsRequest{
			Kind:           kind,
			StartDate:      "2026-01-10",
			EndDate:        "2026-01-12",
			SeriesPublicId: seriesPublicID,
		})
	}

	if got, want := export(publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_AUDIENCE_BY_DAY, ""), csvFile(
		"date,follower_count,followed_count,unfollowed_count,view_count,complete_count,reaction_count,reaction_points",
		"2026-01-10,1,1,0,40,4,3,15",
		"2026-01-11,3,2,0,60,6,2,10",
		"2026-01-12,4,1,0,100,10,1,5",
	); got != want {
		t.Fatalf("by day csv =\n%q\nwant\n%q", got, want)
	}

	if got, want := export(publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_AUDIENCE_BY_DAY, f.secondSeries.PublicID), csvFile(
		"date,follower_count,followed_count,unfollowed_count,view_count,complete_count,reaction_count,reaction_points",
		"2026-01-10,0,0,0,0,0,0,0",
		"2026-01-11,1,1,0,0,0,0,0",
		"2026-01-12,1,0,0,100,10,1,5",
	); got != want {
		t.Fatalf("by day of the second series csv =\n%q\nwant\n%q", got, want)
	}

	if got, want := export(publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_AUDIENCE_BY_SERIES, ""), csvFile(
		"start_date,end_date,series_id,series_title,follower_count,followed_count,unfollowed_count,view_count,complete_count,reaction_count,reaction_points,rating_average,rating_count",
		"2026-01-10,2026-01-12,AUXSERIES01,Royalty Series,3,3,0,100,10,5,25,2.0,1",
		"2026-01-10,2026-01-12,AUXSERIES02,Second Series,1,1,0,100,10,1,5,0.0,0",
		"2026-01-10,2026-01-12,AUXSERIES03,Third Series,0,0,0,0,0,0,0,0.0,0",
	); got != want {
		t.Fatalf("by series csv =\n%q\nwant\n%q", got, want)
	}

	for _, target := range []struct{ targetType, targetID string }{
		{"audience_stats", "2026-01-10/2026-01-12"},
		{"series", f.secondSeries.PublicID},
	} {
		want := 2
		if target.targetType == "series" {
			want = 1
		}
		if count := env.countRows(t, `
			SELECT count(*) FROM audit_logs
			WHERE tenant_id = $1 AND action = 'stats_exported' AND target_type = $2 AND target_id = $3
		`, f.admin.Tenant.ID, target.targetType, target.targetID); count != want {
			t.Fatalf("export audit entries on %s %s = %d, want %d", target.targetType, target.targetID, count, want)
		}
	}
}

// The drop-off export holds the pages GetEpisodeDropOff answers, and is
// recorded against the episode.
func TestDBAdminExportStatsWritesTheDropOffOfAnEpisode(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "DRX")
	tenantID := f.admin.Tenant.ID
	for page := range int32(3) {
		env.PG.SeedEpisodeImage(t, tenantID, f.episode.ID, page)
	}
	for page, readers := range []int64{5, 4, 2} {
		if _, err := env.PG.DB.ExecContext(context.Background(), `
			INSERT INTO episode_page_reach_stats (tenant_id, stat_date, episode_id, page_index, reader_count)
			VALUES ($1, '2026-01-10'::date, $2, $3, $4)
		`, tenantID, f.episode.ID, page, readers); err != nil {
			t.Fatalf("seed the page reach of page %d: %v", page, err)
		}
	}

	got := env.exportStats(t, f.admin, &publiraadminv1.ExportStatsRequest{
		Kind:            publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_EPISODE_DROP_OFF,
		StartDate:       "2026-01-10",
		EndDate:         "2026-01-12",
		EpisodePublicId: f.episode.PublicID,
	})
	if want := csvFile(
		"start_date,end_date,episode_id,page_index,reader_count",
		"2026-01-10,2026-01-12,DRXEPISODE1,0,5",
		"2026-01-10,2026-01-12,DRXEPISODE1,1,4",
		"2026-01-10,2026-01-12,DRXEPISODE1,2,2",
	); got != want {
		t.Fatalf("drop-off csv =\n%q\nwant\n%q", got, want)
	}
	if count := env.countRows(t, `
		SELECT count(*) FROM audit_logs
		WHERE tenant_id = $1 AND action = 'stats_exported' AND target_type = 'episode' AND target_id = $2
	`, tenantID, f.episode.PublicID); count != 1 {
		t.Fatalf("export audit entries = %d, want 1", count)
	}
}

// Every export is for a tenant_admin alone, the audience one included, and a
// request whose fields do not fit its kind is refused rather than answered
// with a file that is not what it asked for. A refused export records nothing.
func TestDBAdminExportStatsRefusesWhatItCannotWrite(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "SXR")
	editor := env.PG.SeedTenantUser(t, f.admin.Tenant.ID, "SXREDITOR01", "editor@sxr.example.com", "Editor", auth.RoleTenantEditor)
	period := func(req *publiraadminv1.ExportStatsRequest) *publiraadminv1.ExportStatsRequest {
		req.Tenant = f.admin.tenantContext()
		req.StartDate, req.EndDate = "2026-01-10", "2026-01-12"
		return req
	}

	for _, refusal := range []struct {
		name   string
		tenant adminDBTenant
		req    *publiraadminv1.ExportStatsRequest
		code   connect.Code
	}{
		{"revenue by an editor", f.admin.as(editor), period(&publiraadminv1.ExportStatsRequest{
			Kind: publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_DAY,
		}), connect.CodePermissionDenied},
		{"the audience by an editor", f.admin.as(editor), period(&publiraadminv1.ExportStatsRequest{
			Kind: publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_AUDIENCE_BY_DAY,
		}), connect.CodePermissionDenied},
		{"no kind", f.admin, period(&publiraadminv1.ExportStatsRequest{}), connect.CodeInvalidArgument},
		{"a reversed period", f.admin, &publiraadminv1.ExportStatsRequest{
			Tenant:    f.admin.tenantContext(),
			Kind:      publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_AUDIENCE_BY_DAY,
			StartDate: "2026-01-12",
			EndDate:   "2026-01-10",
		}, connect.CodeInvalidArgument},
		{"revenue narrowed to a series", f.admin, period(&publiraadminv1.ExportStatsRequest{
			Kind:           publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_EPISODE,
			SeriesPublicId: f.series.PublicID,
		}), connect.CodeInvalidArgument},
		{"a drop-off of no episode", f.admin, period(&publiraadminv1.ExportStatsRequest{
			Kind: publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_EPISODE_DROP_OFF,
		}), connect.CodeInvalidArgument},
		{"an audience report naming an episode", f.admin, period(&publiraadminv1.ExportStatsRequest{
			Kind:            publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_AUDIENCE_BY_SERIES,
			EpisodePublicId: f.episode.PublicID,
		}), connect.CodeInvalidArgument},
		{"a drop-off of an unknown episode", f.admin, period(&publiraadminv1.ExportStatsRequest{
			Kind:            publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_EPISODE_DROP_OFF,
			EpisodePublicId: "NOSUCHEPISODE",
		}), connect.CodeNotFound},
		{"an audience report of an unknown series", f.admin, period(&publiraadminv1.ExportStatsRequest{
			Kind:           publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_AUDIENCE_BY_DAY,
			SeriesPublicId: "NOSUCHSERIES",
		}), connect.CodeNotFound},
	} {
		t.Run(refusal.name, func(t *testing.T) {
			_, err := env.engagementClient().ExportStats(testutil.WithBearer(context.Background(), refusal.tenant.token()), refusal.req)
			if connect.CodeOf(err) != refusal.code {
				t.Fatalf("ExportStats error = %v, want %s", err, refusal.code)
			}
		})
	}
	if count := env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'stats_exported'", f.admin.Tenant.ID); count != 0 {
		t.Fatalf("audit entries of refused exports = %d, want none", count)
	}
}
