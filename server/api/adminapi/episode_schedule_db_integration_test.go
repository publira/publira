package adminapi

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A period answers the scheduled and published episodes of every series of the
// tenant whose publication falls in its days, cut at the tenant's midnights,
// and nothing either side of them, of a draft, or of another tenant.
func TestDBAdminListEpisodesByPublicationDateAnswersThePeriodAcrossSeries(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "PUBCAL", "pubcal.example.com", "Publication Calendar", "PUBCALADMIN1", "admin@pubcal.example.com")
	other := env.seedTenantWithAdmin(t, "PUBOTH", "puboth.example.com", "Other Tenant", "PUBOTHADMIN1", "admin@puboth.example.com")
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE tenants SET timezone = 'Asia/Tokyo' WHERE id = $1`, tenant.Tenant.ID); err != nil {
		t.Fatalf("set the tenant's time zone: %v", err)
	}
	auditor := tenant.as(env.PG.SeedTenantUser(t, tenant.Tenant.ID, "PUBCALAUDIT1", "auditor@pubcal.example.com", "Auditor", auth.RoleTenantAuditor))

	// The tenant's 2026-02-01 starts at 2026-01-31T15:00Z, and its
	// 2026-02-28 ends at 2026-02-28T15:00Z.
	first := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "PUBCALSER001", Title: "First Series", Published: true})
	second := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "PUBCALSER002", Title: "Second Series", Published: true})
	seed := func(series testutil.Series, publicID, status string, at time.Time) testutil.Episode {
		t.Helper()
		episodeSeed := testutil.EpisodeSeed{PublicID: publicID, Title: publicID + " title", Status: status}
		switch status {
		case testutil.EpisodeStatusPublished:
			episodeSeed.PublishedAt = at
		case testutil.EpisodeStatusScheduled:
			episodeSeed.ScheduledAt = at
		}
		return env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, episodeSeed)
	}
	seed(first, "PUBCALEP0001", testutil.EpisodeStatusPublished, time.Date(2026, 1, 31, 14, 59, 59, 0, time.UTC))
	seed(first, "PUBCALEP0002", testutil.EpisodeStatusPublished, time.Date(2026, 1, 31, 15, 0, 0, 0, time.UTC))
	seed(second, "PUBCALEP0003", testutil.EpisodeStatusScheduled, time.Date(2026, 2, 28, 14, 59, 59, 0, time.UTC))
	seed(second, "PUBCALEP0004", testutil.EpisodeStatusScheduled, time.Date(2026, 2, 28, 15, 0, 0, 0, time.UTC))
	seed(first, "PUBCALEP0005", testutil.EpisodeStatusPublished, time.Date(2026, 2, 10, 3, 0, 0, 0, time.UTC))
	seed(second, "PUBCALEP0006", testutil.EpisodeStatusDraft, time.Time{})
	// Scheduled inside the period and published after it: placed where it was
	// published, so it is not answered here.
	late := seed(first, "PUBCALEP0007", testutil.EpisodeStatusPublished, time.Date(2026, 3, 2, 0, 0, 0, 0, time.UTC))
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE episode_listings SET scheduled_at = $2 WHERE episode_id = $1`,
		late.ID, time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("set the late episode's schedule: %v", err)
	}
	// A draft that once had a time keeps none it is placed by.
	draft := seed(second, "PUBCALEP0008", testutil.EpisodeStatusDraft, time.Time{})
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE episode_listings SET scheduled_at = $2 WHERE episode_id = $1`,
		draft.ID, time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("set the draft's time: %v", err)
	}
	otherSeries := env.PG.SeedSeries(t, other.Tenant.ID, testutil.SeriesSeed{PublicID: "PUBOTHSER001", Title: "Other Series", Published: true})
	env.PG.SeedEpisode(t, other.Tenant.ID, otherSeries.ID, testutil.EpisodeSeed{
		PublicID: "PUBOTHEP0001", Status: testutil.EpisodeStatusPublished, PublishedAt: time.Date(2026, 2, 10, 3, 0, 0, 0, time.UTC),
	})

	res, err := env.seriesClient().ListEpisodesByPublicationDate(testutil.WithBearer(context.Background(), auditor.token()), &publiraadminv1.ListEpisodesByPublicationDateRequest{
		Tenant:    auditor.tenantContext(),
		StartDate: "2026-02-01",
		EndDate:   "2026-02-28",
	})
	if err != nil {
		t.Fatalf("ListEpisodesByPublicationDate: %v", err)
	}
	want := []*publiraadminv1.EpisodePublication{
		{SeriesPublicId: "PUBCALSER001", SeriesTitle: "First Series", EpisodePublicId: "PUBCALEP0002", EpisodeTitle: "PUBCALEP0002 title", Status: "published", PublishedAt: "2026-01-31T15:00:00Z"},
		{SeriesPublicId: "PUBCALSER001", SeriesTitle: "First Series", EpisodePublicId: "PUBCALEP0005", EpisodeTitle: "PUBCALEP0005 title", Status: "published", PublishedAt: "2026-02-10T03:00:00Z"},
		{SeriesPublicId: "PUBCALSER002", SeriesTitle: "Second Series", EpisodePublicId: "PUBCALEP0003", EpisodeTitle: "PUBCALEP0003 title", Status: "scheduled", PublishedAt: "2026-02-28T14:59:59Z"},
	}
	if len(res.Episodes) != len(want) {
		t.Fatalf("episodes = %v, want %v", res.Episodes, want)
	}
	for i := range want {
		got := res.Episodes[i]
		if got.SeriesPublicId != want[i].SeriesPublicId || got.SeriesTitle != want[i].SeriesTitle ||
			got.EpisodePublicId != want[i].EpisodePublicId || got.EpisodeTitle != want[i].EpisodeTitle ||
			got.Status != want[i].Status || got.PublishedAt != want[i].PublishedAt {
			t.Fatalf("episodes[%d] = %v, want %v", i, got, want[i])
		}
	}
	if res.PreviousToken != "" || res.NextToken != "" {
		t.Fatalf("tokens = %q, %q, want none on a period that fits one page", res.PreviousToken, res.NextToken)
	}
}

// The period is paged on (publication time, id), so episodes published at
// one instant are neither repeated nor skipped across a page boundary, and a
// token only reads the period it was issued for.
func TestDBAdminListEpisodesByPublicationDatePagesThePeriod(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "PUBPAG", "pubpag.example.com", "Publication Pages", "PUBPAGADMIN1", "admin@pubpag.example.com")
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "PUBPAGSER001", Title: "Series", Published: true})
	at := time.Date(2026, 4, 10, 3, 0, 0, 0, time.UTC)
	for _, publicID := range []string{"PUBPAGEP0001", "PUBPAGEP0002", "PUBPAGEP0003"} {
		env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: publicID, Status: testutil.EpisodeStatusScheduled, ScheduledAt: at})
	}
	env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PUBPAGEP0004", Status: testutil.EpisodeStatusScheduled, ScheduledAt: at.Add(time.Hour)})

	list := func(token, end string) (*publiraadminv1.ListEpisodesByPublicationDateResponse, error) {
		return env.seriesClient().ListEpisodesByPublicationDate(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodesByPublicationDateRequest{
			Tenant:    tenant.tenantContext(),
			StartDate: "2026-04-01",
			EndDate:   end,
			Limit:     2,
			Token:     token,
		})
	}
	publicIDs := func(res *publiraadminv1.ListEpisodesByPublicationDateResponse) []string {
		ids := make([]string, 0, len(res.Episodes))
		for _, episode := range res.Episodes {
			ids = append(ids, episode.EpisodePublicId)
		}
		return ids
	}

	first, err := list("", "2026-04-30")
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	if got := publicIDs(first); !slices.Equal(got, []string{"PUBPAGEP0001", "PUBPAGEP0002"}) || first.PreviousToken != "" || first.NextToken == "" {
		t.Fatalf("first page = %v (previous %q, next %q), want the first two and a next token", got, first.PreviousToken, first.NextToken)
	}
	second, err := list(first.NextToken, "2026-04-30")
	if err != nil {
		t.Fatalf("second page: %v", err)
	}
	if got := publicIDs(second); !slices.Equal(got, []string{"PUBPAGEP0003", "PUBPAGEP0004"}) || second.PreviousToken == "" || second.NextToken != "" {
		t.Fatalf("second page = %v (previous %q, next %q), want the last two and a previous token", got, second.PreviousToken, second.NextToken)
	}
	back, err := list(second.PreviousToken, "2026-04-30")
	if err != nil {
		t.Fatalf("back to the first page: %v", err)
	}
	if got := publicIDs(back); !slices.Equal(got, []string{"PUBPAGEP0001", "PUBPAGEP0002"}) || back.PreviousToken != "" {
		t.Fatalf("page before the second = %v (previous %q), want the first page again", got, back.PreviousToken)
	}

	if _, err := list(first.NextToken, "2026-04-29"); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a token presented with another period: error = %v, want invalid_argument", err)
	}
}

// A period past two months is refused.
func TestDBAdminListEpisodesByPublicationDateRefusesAPeriodPast62Days(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "PUBREF", "pubref.example.com", "Publication Refusal", "PUBREFADMIN1", "admin@pubref.example.com")

	for _, refusal := range []struct {
		name       string
		start, end string
		code       connect.Code
	}{
		{"63 days", "2026-01-01", "2026-03-04", connect.CodeInvalidArgument},
		{"a reversed period", "2026-01-31", "2026-01-01", connect.CodeInvalidArgument},
		{"no period", "", "", connect.CodeInvalidArgument},
	} {
		t.Run(refusal.name, func(t *testing.T) {
			_, err := env.seriesClient().ListEpisodesByPublicationDate(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodesByPublicationDateRequest{
				Tenant:    tenant.tenantContext(),
				StartDate: refusal.start,
				EndDate:   refusal.end,
			})
			if connect.CodeOf(err) != refusal.code {
				t.Fatalf("ListEpisodesByPublicationDate error = %v, want %s", err, refusal.code)
			}
		})
	}

	// 62 days, two months of 31, is the longest period one answer covers.
	if _, err := env.seriesClient().ListEpisodesByPublicationDate(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodesByPublicationDateRequest{
		Tenant:    tenant.tenantContext(),
		StartDate: "2026-07-01",
		EndDate:   "2026-08-31",
	}); err != nil {
		t.Fatalf("ListEpisodesByPublicationDate over 62 days: %v", err)
	}
}
