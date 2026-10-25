package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// subscriptionAccessFixture is a tenant with three series of one paid episode
// each: one under the label a plan can name, one under another label, and one
// under none.
type subscriptionAccessFixture struct {
	env          *publicDBEnv
	tenant       testutil.Tenant
	label        testutil.Label
	labelled     testutil.Series
	otherLabel   testutil.Series
	unlabelled   testutil.Series
	episodeOf    map[uuid.UUID]testutil.Episode
	readerNumber int
}

func newSubscriptionAccessFixture(t *testing.T) *subscriptionAccessFixture {
	t.Helper()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	label := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELPLAN001", Name: "Plan label"})
	other := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELOTHER01", Name: "Other label"})
	f := &subscriptionAccessFixture{
		env:        env,
		tenant:     tenant,
		label:      label,
		labelled:   env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESLABEL1", Title: "Labelled", Published: true, LabelID: label.ID}),
		otherLabel: env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESOTHER1", Title: "Other label", Published: true, LabelID: other.ID}),
		unlabelled: env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESNOLAB1", Title: "Unlabelled", Published: true}),
		episodeOf:  map[uuid.UUID]testutil.Episode{},
	}
	for i, series := range []testutil.Series{f.labelled, f.otherLabel, f.unlabelled} {
		episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
			PublicID: "EPISODEPAY0" + string(rune('1'+i)),
			Title:    "Paid " + series.PublicID,
			Status:   testutil.EpisodeStatusPublished,
			Price:    500,
		})
		env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
		f.episodeOf[series.ID] = episode
	}
	return f
}

// newReader seeds a reader account of its own for each case, so one case's
// subscription opens nothing in another's.
func (f *subscriptionAccessFixture) newReader(t *testing.T) testutil.TenantUser {
	t.Helper()

	f.readerNumber++
	publicID := "SUBREADER" + string(rune('A'+f.readerNumber/26)) + string(rune('A'+f.readerNumber%26)) + "1"
	return f.env.PG.SeedEndUser(t, f.tenant.ID, publicID, publicID+"@tenant-a.example.com", publicID)
}

// read answers what GetEpisodeDetail and GetSeriesEpisodeAccess say the
// reader may do with the series' one episode.
func (f *subscriptionAccessFixture) read(t *testing.T, user testutil.TenantUser, series testutil.Series) (*publirav1.GetEpisodeDetailResponse, *publirav1.SeriesEpisodeAccess) {
	t.Helper()

	client := f.env.catalogClient()
	ctx := testutil.WithBearer(context.Background(), tokenFor(t, f.tenant, user))
	detail, err := client.GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(f.tenant), PublicId: f.episodeOf[series.ID].PublicID})
	if err != nil {
		t.Fatalf("GetEpisodeDetail of %s: %v", series.PublicID, err)
	}
	access, err := client.GetSeriesEpisodeAccess(ctx, &publirav1.GetSeriesEpisodeAccessRequest{Tenant: tenantContext(f.tenant), SeriesId: series.ID.String()})
	if err != nil {
		t.Fatalf("GetSeriesEpisodeAccess of %s: %v", series.PublicID, err)
	}
	if len(access.Episodes) != 1 {
		t.Fatalf("series episode access of %s = %v, want one episode", series.PublicID, access.Episodes)
	}
	return detail, access.Episodes[0]
}

// assertSubscribed checks that the subscription, and nothing the reader owns,
// opens the series' episode, with images whose token names the reader.
func (f *subscriptionAccessFixture) assertSubscribed(t *testing.T, user testutil.TenantUser, series testutil.Series) {
	t.Helper()

	detail, inSeries := f.read(t, user, series)
	if detail.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED ||
		detail.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION {
		t.Fatalf("episode of %s = %v from %v, want entitled by the subscription", series.PublicID, detail.Access, detail.EntitlementSource)
	}
	if len(detail.Images) != 1 {
		t.Fatalf("images of %s = %d, want 1", series.PublicID, len(detail.Images))
	}
	if subject := mediaTokenSubject(t, detail.Images[0].ImageUrl); subject != user.PublicID {
		t.Fatalf("media token subject = %q, want the subscriber %q", subject, user.PublicID)
	}
	if inSeries.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED ||
		inSeries.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION ||
		inSeries.Owned {
		t.Fatalf("series episode access of %s = %v, want entitled by the subscription and not owned", series.PublicID, inSeries)
	}
}

func (f *subscriptionAccessFixture) assertLocked(t *testing.T, user testutil.TenantUser, series testutil.Series) {
	t.Helper()

	detail, inSeries := f.read(t, user, series)
	if detail.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED ||
		detail.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
		t.Fatalf("episode of %s = %v from %v, want locked", series.PublicID, detail.Access, detail.EntitlementSource)
	}
	if len(detail.Images) != 0 {
		t.Fatalf("images of %s = %d, want none", series.PublicID, len(detail.Images))
	}
	if inSeries.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("series episode access of %s = %v, want locked", series.PublicID, inSeries)
	}
}

// Each scope opens the series it covers and none of the others: `all` every
// series of the tenant, `label` the series under the labels it names, and
// `series` the series it names. A target that does not match its plan's scope
// opens nothing, and neither does a plan of another reader.
func TestDBGetEpisodeDetailOpensThePlanScopeToASubscriber(t *testing.T) {
	f := newSubscriptionAccessFixture(t)
	env, tenant := f.env, f.tenant

	for _, tt := range []struct {
		name  string
		plan  testutil.SubscriptionPlanSeed
		opens []testutil.Series
	}{
		{
			name:  "all",
			plan:  testutil.SubscriptionPlanSeed{Scope: "all"},
			opens: []testutil.Series{f.labelled, f.otherLabel, f.unlabelled},
		},
		{
			name:  "label",
			plan:  testutil.SubscriptionPlanSeed{Scope: "label", LabelIDs: []uuid.UUID{f.label.ID}},
			opens: []testutil.Series{f.labelled},
		},
		{
			name:  "series",
			plan:  testutil.SubscriptionPlanSeed{Scope: "series", SeriesIDs: []uuid.UUID{f.unlabelled.ID}},
			opens: []testutil.Series{f.unlabelled},
		},
		{
			name: "a series target on a label plan",
			plan: testutil.SubscriptionPlanSeed{Scope: "label", SeriesIDs: []uuid.UUID{f.unlabelled.ID}},
		},
		{
			name: "a label target on a series plan",
			plan: testutil.SubscriptionPlanSeed{Scope: "series", LabelIDs: []uuid.UUID{f.label.ID}},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			plan := env.PG.SeedSubscriptionPlan(t, tenant.ID, tt.plan)
			subscriber := f.newReader(t)
			env.PG.SeedSubscription(t, tenant.ID, subscriber.ID, plan.ID, testutil.SubscriptionSeed{})
			bystander := f.newReader(t)

			opened := map[uuid.UUID]bool{}
			for _, series := range tt.opens {
				opened[series.ID] = true
			}
			for _, series := range []testutil.Series{f.labelled, f.otherLabel, f.unlabelled} {
				if opened[series.ID] {
					f.assertSubscribed(t, subscriber, series)
				} else {
					f.assertLocked(t, subscriber, series)
				}
				f.assertLocked(t, bystander, series)
			}
		})
	}
}

// A subscription opens its scope while Stripe reports it trialing, active, or
// past due, and only until the period it bills for ends: a subscription set to
// cancel at the period end stops there even before Stripe's notification of
// its end arrives. One with no period recorded opens nothing.
func TestDBGetEpisodeDetailEndsSubscriberAccessWithTheSubscription(t *testing.T) {
	f := newSubscriptionAccessFixture(t)
	env, tenant := f.env, f.tenant
	plan := env.PG.SeedSubscriptionPlan(t, tenant.ID, testutil.SubscriptionPlanSeed{Scope: "all"})

	inAMonth := time.Now().AddDate(0, 1, 0)
	anHourAgo := time.Now().Add(-time.Hour)
	for _, tt := range []struct {
		status    string
		periodEnd time.Time
		noPeriod  bool
		opens     bool
	}{
		{status: "trialing", periodEnd: inAMonth, opens: true},
		{status: "active", periodEnd: inAMonth, opens: true},
		{status: "past_due", periodEnd: inAMonth, opens: true},
		{status: "active", periodEnd: anHourAgo},
		{status: "past_due", periodEnd: anHourAgo},
		{status: "active", noPeriod: true},
		{status: "canceled", periodEnd: inAMonth},
		{status: "unpaid", periodEnd: inAMonth},
		{status: "paused", periodEnd: inAMonth},
		{status: "incomplete", periodEnd: inAMonth},
		{status: "incomplete_expired", periodEnd: inAMonth},
	} {
		name := tt.status + " with the period ahead"
		switch {
		case tt.noPeriod:
			name = tt.status + " with no period"
		case tt.periodEnd.Before(time.Now()):
			name = tt.status + " past the period end"
		}
		t.Run(name, func(t *testing.T) {
			reader := f.newReader(t)
			id := env.PG.SeedSubscription(t, tenant.ID, reader.ID, plan.ID, testutil.SubscriptionSeed{Status: tt.status, CurrentPeriodEnd: tt.periodEnd})
			if tt.noPeriod {
				if _, err := env.PG.DB.ExecContext(context.Background(), "UPDATE subscriptions SET current_period_end = NULL WHERE id = $1", id); err != nil {
					t.Fatalf("clear the period end: %v", err)
				}
			}
			if tt.opens {
				f.assertSubscribed(t, reader, f.labelled)
			} else {
				f.assertLocked(t, reader, f.labelled)
			}
		})
	}
}

// A subscription opens many episodes at once, so a purchase the same reader
// holds is reported over it and is still the reader's own copy. It is reported
// over the staff grant, which opens even more.
func TestDBGetEpisodeDetailReportsSubscriptionUnderOtherGrants(t *testing.T) {
	f := newSubscriptionAccessFixture(t)
	env, tenant := f.env, f.tenant
	plan := env.PG.SeedSubscriptionPlan(t, tenant.ID, testutil.SubscriptionPlanSeed{Scope: "all"})
	episode := f.episodeOf[f.labelled.ID]

	buyer := f.newReader(t)
	env.PG.SeedSubscription(t, tenant.ID, buyer.ID, plan.ID, testutil.SubscriptionSeed{})
	env.PG.SeedPurchase(t, tenant.ID, buyer.ID, episode.ID, 500)
	detail, inSeries := f.read(t, buyer, f.labelled)
	if detail.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_PURCHASE ||
		inSeries.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_PURCHASE ||
		!inSeries.Owned {
		t.Fatalf("a subscriber's bought episode = %v / %v, want entitled and owned by the purchase", detail.EntitlementSource, inSeries)
	}

	staff := seedReaderWithRole(t, env, tenant, "STAFFEDITR01", auth.RoleTenantEditor)
	env.PG.SeedSubscription(t, tenant.ID, staff.ID, plan.ID, testutil.SubscriptionSeed{})
	f.assertSubscribed(t, staff, f.labelled)
}

// The comment permission check reads the same grants, so a subscriber may
// comment on an episode of the plan's scope and on none outside it.
func TestDBPostEpisodeCommentOpensThePlanScopeToASubscriber(t *testing.T) {
	fixture := newCommentFixture(t, "SUB")
	env, tenant, member := fixture.env, fixture.tenant, fixture.member
	env.setCommentMode(t, tenant.ID, "immediate")

	inScope := env.PG.SeedEpisode(t, tenant.ID, fixture.series.ID, testutil.EpisodeSeed{PublicID: "SUBINSCOPE", Title: "In scope", Price: 500, Status: testutil.EpisodeStatusPublished})
	other := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SUBOTHERSER", Title: "Outside the plan", Published: true})
	outOfScope := env.PG.SeedEpisode(t, tenant.ID, other.ID, testutil.EpisodeSeed{PublicID: "SUBOUTSCOPE", Title: "Out of scope", Price: 500, Status: testutil.EpisodeStatusPublished})
	plan := env.PG.SeedSubscriptionPlan(t, tenant.ID, testutil.SubscriptionPlanSeed{Scope: "series", SeriesIDs: []uuid.UUID{fixture.series.ID}})
	env.PG.SeedSubscription(t, tenant.ID, member.ID, plan.ID, testutil.SubscriptionSeed{})

	env.mustPostComment(t, tenant, member, inScope.ID.String(), "Read through my plan.")
	if _, err := env.postComment(t, tenant, member, outOfScope.ID.String(), "Not in my plan."); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("PostEpisodeComment outside the plan error = %v, want permission_denied", err)
	}
}

// The release before reads episode_content_grants and fails a read whose grant
// kind it does not know, so a subscription opens nothing there while it opens
// the episode here.
func TestDBSubscriptionGrantStaysOutOfThePreviousReleasesView(t *testing.T) {
	f := newSubscriptionAccessFixture(t)
	env, tenant := f.env, f.tenant
	plan := env.PG.SeedSubscriptionPlan(t, tenant.ID, testutil.SubscriptionPlanSeed{Scope: "all"})
	reader := f.newReader(t)
	env.PG.SeedSubscription(t, tenant.ID, reader.ID, plan.ID, testutil.SubscriptionSeed{})

	f.assertSubscribed(t, reader, f.labelled)
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_content_grants WHERE tenant_id = $1 AND user_id = $2", tenant.ID, reader.ID); got != 0 {
		t.Fatalf("episode_content_grants rows of a subscriber = %d, want none", got)
	}
}
