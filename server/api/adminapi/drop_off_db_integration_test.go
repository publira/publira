package adminapi

import (
	"context"
	"reflect"
	"testing"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) getEpisodeDropOff(t *testing.T, tenant adminDBTenant, req *publiraadminv1.GetEpisodeDropOffRequest) *publiraadminv1.GetEpisodeDropOffResponse {
	t.Helper()

	req.Tenant = tenant.tenantContext()
	res, err := e.engagementClient().GetEpisodeDropOff(testutil.WithBearer(context.Background(), tenant.token()), req)
	if err != nil {
		t.Fatalf("GetEpisodeDropOff %s to %s: %v", req.StartDate, req.EndDate, err)
	}
	return res
}

// readerCounts is a report's pages as their reader counts, after checking they
// run from page 0 without a gap.
func readerCounts(t *testing.T, pages []*publiraadminv1.EpisodePageReach) []int64 {
	t.Helper()
	counts := make([]int64, 0, len(pages))
	for i, page := range pages {
		if page.PageIndex != int32(i) {
			t.Fatalf("page %d of the report is page %d", i, page.PageIndex)
		}
		counts = append(counts, page.ReaderCount)
	}
	return counts
}

// A report sums the days of its period page by page, and runs through the
// episode's last page even where nobody reached it, and through a page past
// it that readers reached before the episode lost pages.
func TestDBAdminEpisodeDropOffSumsThePeriodPageByPage(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "DRP")
	tenantID := f.admin.Tenant.ID
	for page := range int32(4) {
		env.PG.SeedEpisodeImage(t, tenantID, f.episode.ID, page)
	}
	for _, day := range []struct {
		date    string
		readers []int64
	}{
		{"2026-01-10", []int64{5, 4, 2}},
		{"2026-01-11", []int64{3, 3, 3, 2, 1, 1}},
		{"2026-01-13", []int64{9}},
	} {
		for page, readers := range day.readers {
			if _, err := env.PG.DB.ExecContext(context.Background(), `
				INSERT INTO episode_page_reach_stats (tenant_id, stat_date, episode_id, page_index, reader_count)
				VALUES ($1, $2::date, $3, $4, $5)
			`, tenantID, day.date, f.episode.ID, page, readers); err != nil {
				t.Fatalf("seed the page reach of %s: %v", day.date, err)
			}
		}
	}

	res := env.getEpisodeDropOff(t, f.admin, &publiraadminv1.GetEpisodeDropOffRequest{
		EpisodePublicId: f.episode.PublicID,
		StartDate:       "2026-01-10",
		EndDate:         "2026-01-12",
	})
	if got, want := readerCounts(t, res.Pages), []int64{8, 7, 5, 2, 1, 1}; !reflect.DeepEqual(got, want) {
		t.Fatalf("readers per page = %v, want %v", got, want)
	}
	if res.PageCount != 4 || res.StartDate != "2026-01-10" || res.EndDate != "2026-01-12" || res.TimeZone != royaltyZoneName {
		t.Fatalf("report = %d pages, %s to %s in %q, want 4 pages, 2026-01-10 to 2026-01-12 in %q",
			res.PageCount, res.StartDate, res.EndDate, res.TimeZone, royaltyZoneName)
	}

	day := env.getEpisodeDropOff(t, f.admin, &publiraadminv1.GetEpisodeDropOffRequest{
		EpisodePublicId: f.episode.PublicID,
		StartDate:       "2026-01-10",
		EndDate:         "2026-01-10",
	})
	if got, want := readerCounts(t, day.Pages), []int64{5, 4, 2, 0}; !reflect.DeepEqual(got, want) {
		t.Fatalf("readers per page on the 10th = %v, want %v", got, want)
	}

	quiet := env.getEpisodeDropOff(t, f.admin, &publiraadminv1.GetEpisodeDropOffRequest{
		EpisodePublicId: f.episode.PublicID,
		StartDate:       "2026-02-01",
		EndDate:         "2026-02-28",
	})
	if got, want := readerCounts(t, quiet.Pages), []int64{0, 0, 0, 0}; !reflect.DeepEqual(got, want) {
		t.Fatalf("readers per page in a quiet period = %v, want %v", got, want)
	}

	blank := env.PG.SeedEpisode(t, tenantID, f.series.ID, testutil.EpisodeSeed{PublicID: "DRPEPISODE2", Title: "Episode 2"})
	empty := env.getEpisodeDropOff(t, f.admin, &publiraadminv1.GetEpisodeDropOffRequest{
		EpisodePublicId: blank.PublicID,
		StartDate:       "2026-01-10",
		EndDate:         "2026-01-12",
	})
	if len(empty.Pages) != 0 || empty.PageCount != 0 {
		t.Fatalf("an episode without pages or readers = %d pages reported of %d, want none", len(empty.Pages), empty.PageCount)
	}
}

// An episode the tenant does not have is refused rather than answered with an
// empty histogram a chart would draw as an episode nobody opened.
func TestDBAdminEpisodeDropOffRefusesAnEpisodeTheTenantDoesNotHave(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "DRQ")
	other := env.seedRoyaltyFixture(t, "DRR")

	for name, publicID := range map[string]string{"unknown": "NOSUCHEPISODE", "another tenant's": other.episode.PublicID} {
		_, err := env.engagementClient().GetEpisodeDropOff(testutil.WithBearer(context.Background(), f.admin.token()), &publiraadminv1.GetEpisodeDropOffRequest{
			Tenant:          f.admin.tenantContext(),
			EpisodePublicId: publicID,
			StartDate:       "2026-01-10",
			EndDate:         "2026-01-12",
		})
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s episode: error = %v, want not_found", name, err)
		}
	}
}
