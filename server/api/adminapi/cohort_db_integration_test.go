package adminapi

import (
	"context"
	"reflect"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/contentstats"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/tenantday"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) getRetentionCohorts(t *testing.T, tenant adminDBTenant, req *publiraadminv1.GetRetentionCohortsRequest) *publiraadminv1.GetRetentionCohortsResponse {
	t.Helper()

	req.Tenant = tenant.tenantContext()
	res, err := e.engagementClient().GetRetentionCohorts(testutil.WithBearer(context.Background(), tenant.token()), req)
	if err != nil {
		t.Fatalf("GetRetentionCohorts %s to %s: %v", req.StartDate, req.EndDate, err)
	}
	return res
}

func (e *adminDBEnv) getSignUpFunnel(t *testing.T, tenant adminDBTenant, req *publiraadminv1.GetSignUpFunnelRequest) *publiraadminv1.GetSignUpFunnelResponse {
	t.Helper()

	req.Tenant = tenant.tenantContext()
	res, err := e.engagementClient().GetSignUpFunnel(testutil.WithBearer(context.Background(), tenant.token()), req)
	if err != nil {
		t.Fatalf("GetSignUpFunnel %s to %s: %v", req.StartDate, req.EndDate, err)
	}
	return res
}

// signUp seeds a reader of the tenant whose account was created at createdAt.
func (e *adminDBEnv) signUp(t *testing.T, tenantID uuid.UUID, publicID string, createdAt time.Time) uuid.UUID {
	t.Helper()

	reader := e.PG.SeedEndUser(t, tenantID, publicID, publicID+"@cohort.example.com", "Reader "+publicID)
	e.setCreatedAt(t, reader.ID, createdAt)
	return reader.ID
}

func (e *adminDBEnv) setCreatedAt(t *testing.T, userID uuid.UUID, createdAt time.Time) {
	t.Helper()

	if _, err := e.PG.DB.ExecContext(context.Background(), "UPDATE users SET created_at = $2 WHERE id = $1", userID, createdAt); err != nil {
		t.Fatalf("set the sign-up of user %s: %v", userID, err)
	}
}

// cohortCounts is a report's cohorts as each week's size followed by its
// active counts.
func cohortCounts(cohorts []*publiraadminv1.RetentionCohort) map[string][]int64 {
	counts := map[string][]int64{}
	for _, cohort := range cohorts {
		counts[cohort.WeekStart] = append([]int64{cohort.CohortSize}, cohort.ActiveCounts...)
	}
	return counts
}

// withWeeks pads a cohort's expected counts out to the thirteen weeks every
// cohort of January 2026 has ended.
func withWeeks(size int64, active ...int64) []int64 {
	counts := append([]int64{size}, active...)
	for len(counts) < 14 {
		counts = append(counts, 0)
	}
	return counts
}

// A cohort is the readers who signed up in one of the tenant's calendar weeks,
// and a week after it counts each of them active once, however many of its
// days they read on, from the days the daily rebuild filed. Staff are no
// reader of the tenant, and a deleted account leaves its cohort and every count
// over it on the next read.
func TestDBAdminRetentionCohortsFollowEachWeeksSignUps(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "CHT")
	tenantID := f.admin.Tenant.ID
	otherSeries := env.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: "CHTSERIES02", Title: "Other Series"})
	otherEpisode := env.PG.SeedEpisode(t, tenantID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "CHTEPISODE2", Title: "Other Episode"})

	// The week of Monday 5 January 2026 in Seoul. The last reader signs up ten
	// minutes into the Monday after it, which is still the Sunday in UTC.
	env.setCreatedAt(t, f.admin.User.ID, inRoyaltyZone(2026, time.January, 6, 9, 0, 0))
	env.setCreatedAt(t, f.reader.ID, inRoyaltyZone(2025, time.December, 1, 9, 0, 0))
	steady := env.signUp(t, tenantID, "CHTSTEADY01", inRoyaltyZone(2026, time.January, 5, 0, 10, 0))
	once := env.signUp(t, tenantID, "CHTONCE0001", inRoyaltyZone(2026, time.January, 6, 12, 0, 0))
	late := env.signUp(t, tenantID, "CHTLATE0001", inRoyaltyZone(2026, time.January, 11, 23, 50, 0))
	nextWeek := env.signUp(t, tenantID, "CHTNEXT0001", inRoyaltyZone(2026, time.January, 12, 0, 10, 0))

	bucket := int64(0)
	view := func(reader, seriesID, episodeID uuid.UUID, at time.Time) {
		t.Helper()
		bucket++
		if _, err := env.PG.DB.ExecContext(context.Background(), `
			INSERT INTO content_events (id, tenant_id, event_type, user_id, series_id, episode_id, debounce_bucket, occurred_at)
			VALUES ($1, $2, 'episode_view', $3, $4, $5, $6, $7)
		`, uuid.Must(uuid.NewV7()), tenantID, reader, seriesID, episodeID, bucket, at); err != nil {
			t.Fatalf("insert a view: %v", err)
		}
	}
	// Two days of the sign-up week, then two of the week after it.
	view(steady, f.series.ID, f.episode.ID, inRoyaltyZone(2026, time.January, 7, 20, 0, 0))
	view(steady, f.series.ID, f.episode.ID, inRoyaltyZone(2026, time.January, 8, 20, 0, 0))
	view(once, f.series.ID, f.episode.ID, inRoyaltyZone(2026, time.January, 8, 21, 0, 0))
	view(steady, f.series.ID, f.episode.ID, inRoyaltyZone(2026, time.January, 13, 20, 0, 0))
	view(steady, f.series.ID, f.episode.ID, inRoyaltyZone(2026, time.January, 14, 20, 0, 0))
	view(late, otherSeries.ID, otherEpisode.ID, inRoyaltyZone(2026, time.January, 14, 21, 0, 0))
	view(nextWeek, f.series.ID, f.episode.ID, inRoyaltyZone(2026, time.January, 14, 22, 0, 0))
	aggregator := contentstats.New(env.PG.OpenContentStatsDB(t))
	for _, day := range []int{7, 8, 13, 14} {
		if _, err := aggregator.RunTenant(context.Background(), tenantday.Tenant{ID: tenantID, TimeZone: royaltyZoneName},
			time.Date(2026, time.January, day, 0, 0, 0, 0, time.UTC)); err != nil {
			t.Fatalf("rebuild 2026-01-%02d: %v", day, err)
		}
	}

	req := &publiraadminv1.GetRetentionCohortsRequest{StartDate: "2026-01-07", EndDate: "2026-01-12"}
	res := env.getRetentionCohorts(t, f.admin, req)
	want := map[string][]int64{
		"2026-01-05": withWeeks(3, 2, 2),
		"2026-01-12": withWeeks(1, 1),
	}
	if got := cohortCounts(res.Cohorts); !reflect.DeepEqual(got, want) {
		t.Fatalf("cohorts = %v, want %v", got, want)
	}
	if len(res.Cohorts) != 2 || res.Cohorts[0].WeekStart != "2026-01-05" {
		t.Fatalf("cohorts are not in week order: %v", res.Cohorts)
	}
	if res.StartDate != "2026-01-07" || res.EndDate != "2026-01-12" || res.TimeZone != royaltyZoneName {
		t.Fatalf("report = %s to %s in %q, want 2026-01-07 to 2026-01-12 in %q", res.StartDate, res.EndDate, res.TimeZone, royaltyZoneName)
	}

	// Narrowed to the other series, the cohorts stay whole and only their
	// activity there counts.
	narrowed := env.getRetentionCohorts(t, f.admin, &publiraadminv1.GetRetentionCohortsRequest{
		StartDate: "2026-01-07", EndDate: "2026-01-12", SeriesPublicId: otherSeries.PublicID,
	})
	if got, want := cohortCounts(narrowed.Cohorts), (map[string][]int64{
		"2026-01-05": withWeeks(3, 0, 1),
		"2026-01-12": withWeeks(1, 0),
	}); !reflect.DeepEqual(got, want) {
		t.Fatalf("cohorts narrowed to the other series = %v, want %v", got, want)
	}

	if _, err := env.PG.DB.ExecContext(context.Background(), "DELETE FROM users WHERE id = $1", steady); err != nil {
		t.Fatalf("delete a reader: %v", err)
	}
	if got, want := cohortCounts(env.getRetentionCohorts(t, f.admin, req).Cohorts), (map[string][]int64{
		"2026-01-05": withWeeks(2, 1, 1),
		"2026-01-12": withWeeks(1, 1),
	}); !reflect.DeepEqual(got, want) {
		t.Fatalf("cohorts once a reader was deleted = %v, want %v", got, want)
	}
}

// A week still in progress is no count at all rather than one short of the
// days it has left.
func TestDBAdminRetentionCohortsLeaveOutAWeekInProgress(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "CHU")
	today := time.Now().In(royaltyZone).Format(time.DateOnly)
	env.setCreatedAt(t, f.reader.ID, inRoyaltyZone(2026, time.January, 6, 9, 0, 0))
	env.signUp(t, f.admin.Tenant.ID, "CHUTODAY001", time.Now())

	res := env.getRetentionCohorts(t, f.admin, &publiraadminv1.GetRetentionCohortsRequest{StartDate: today, EndDate: today})
	if len(res.Cohorts) != 1 || res.Cohorts[0].CohortSize != 1 || len(res.Cohorts[0].ActiveCounts) != 0 {
		t.Fatalf("this week's cohorts = %v, want one of 1 reader with no week counted", res.Cohorts)
	}
}

func TestDBAdminRetentionCohortsRefuseASeriesTheTenantDoesNotHave(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "CHV")
	other := env.seedRoyaltyFixture(t, "CHW")

	_, err := env.engagementClient().GetRetentionCohorts(testutil.WithBearer(context.Background(), f.admin.token()), &publiraadminv1.GetRetentionCohortsRequest{
		Tenant:         f.admin.tenantContext(),
		StartDate:      "2026-01-05",
		EndDate:        "2026-01-11",
		SeriesPublicId: other.series.PublicID,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another tenant's series: error = %v, want not_found", err)
	}
}

// The funnel counts the readers who signed up in the period, those of them
// with an active day, and those whose first purchase came within 7 days,
// within 30, and at all, leaving a sandbox purchase out.
func TestDBAdminSignUpFunnelCountsHowSoonReadersFirstBought(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "FNL")
	tenantID := f.admin.Tenant.ID

	signedUp := inRoyaltyZone(2026, time.January, 6, 9, 0, 0)
	env.setCreatedAt(t, f.admin.User.ID, signedUp)
	env.setCreatedAt(t, f.reader.ID, inRoyaltyZone(2026, time.January, 4, 23, 50, 0))
	tenthDay := env.signUp(t, tenantID, "FNLTENTH001", signedUp)
	secondDay := env.signUp(t, tenantID, "FNLSECOND01", signedUp)
	sandbox := env.signUp(t, tenantID, "FNLSANDBOX1", signedUp)
	reader := env.signUp(t, tenantID, "FNLACTIVE01", inRoyaltyZone(2026, time.January, 11, 23, 50, 0))
	env.signUp(t, tenantID, "FNLAFTER001", inRoyaltyZone(2026, time.January, 12, 0, 10, 0))

	purchase := func(buyer uuid.UUID, at time.Time, isTest bool) {
		t.Helper()
		if _, err := env.PG.DB.ExecContext(context.Background(), `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at, currency, is_test, provider, provider_checkout_id)
			VALUES ($1, $2, $3, $4, 500, $5, $6, $7, 'stripe', $8)
		`, uuid.Must(uuid.NewV7()), tenantID, buyer, f.episode.ID, at, env.PG.TenantCurrency(t, tenantID), isTest, "cs_"+uuid.NewString()); err != nil {
			t.Fatalf("insert a purchase: %v", err)
		}
	}
	purchase(tenthDay, signedUp.AddDate(0, 0, 10), false)
	purchase(tenthDay, signedUp.AddDate(0, 0, 12), false)
	purchase(secondDay, signedUp.AddDate(0, 0, 2), false)
	purchase(sandbox, signedUp.AddDate(0, 0, 1), true)
	for _, active := range []uuid.UUID{secondDay, reader} {
		if _, err := env.PG.DB.ExecContext(context.Background(), `
			INSERT INTO reader_daily_activity (tenant_id, stat_date, user_id, series_id)
			VALUES ($1, '2026-01-12', $2, $3)
		`, tenantID, active, f.series.ID); err != nil {
			t.Fatalf("seed an active day: %v", err)
		}
	}

	res := env.getSignUpFunnel(t, f.admin, &publiraadminv1.GetSignUpFunnelRequest{StartDate: "2026-01-05", EndDate: "2026-01-11"})
	got := []int64{res.SignedUpCount, res.ActiveCount, res.PurchasedWithinSevenDaysCount, res.PurchasedWithinThirtyDaysCount, res.PurchasedCount}
	if want := []int64{4, 2, 1, 2, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("signed up, active, bought within 7 days, within 30 days, at all = %v, want %v", got, want)
	}
	if res.MedianDaysToFirstPurchase != 6 {
		t.Fatalf("median days to the first purchase = %v, want 6", res.MedianDaysToFirstPurchase)
	}
	if res.StartDate != "2026-01-05" || res.EndDate != "2026-01-11" || res.TimeZone != royaltyZoneName {
		t.Fatalf("report = %s to %s in %q, want 2026-01-05 to 2026-01-11 in %q", res.StartDate, res.EndDate, res.TimeZone, royaltyZoneName)
	}

	quiet := env.getSignUpFunnel(t, f.admin, &publiraadminv1.GetSignUpFunnelRequest{StartDate: "2026-02-01", EndDate: "2026-02-28"})
	if quiet.SignedUpCount != 0 || quiet.PurchasedCount != 0 || quiet.MedianDaysToFirstPurchase != 0 {
		t.Fatalf("a period nobody signed up in = %+v, want every figure 0", quiet)
	}
}
