package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/ageverification"
	"github.com/publira/publira/server/internal/auth"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// seedReaderWithRole seeds a reader account of the tenant and, unless role is
// empty, stores that role for it in tenant_user_roles.
func seedReaderWithRole(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, publicID, role string) testutil.TenantUser {
	t.Helper()

	user := env.PG.SeedEndUser(t, tenant.ID, publicID, publicID+"@"+tenant.Domain, publicID)
	if role != "" {
		env.PG.SeedTenantUserRole(t, tenant.ID, user.ID, role)
	}
	return user
}

// Each of the three staff roles opens a paid episode as an entitled one, with
// images whose token names the member of staff, and the series' episode
// access says the same. No role, or a role string outside the three, opens
// nothing.
func TestDBGetEpisodeDetailOpensEveryEpisodeToTenantStaff(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid Chapter",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)

	client := env.catalogClient()
	read := func(t *testing.T, user testutil.TenantUser) (*publirav1.GetEpisodeDetailResponse, *publirav1.SeriesEpisodeAccess) {
		t.Helper()
		ctx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, user))
		detail, err := client.GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID})
		if err != nil {
			t.Fatalf("GetEpisodeDetail: %v", err)
		}
		access, err := client.GetSeriesEpisodeAccess(ctx, &publirav1.GetSeriesEpisodeAccessRequest{Tenant: tenantContext(tenant), SeriesId: series.ID.String()})
		if err != nil {
			t.Fatalf("GetSeriesEpisodeAccess: %v", err)
		}
		if len(access.Episodes) != 1 {
			t.Fatalf("series episode access = %v, want one episode", access.Episodes)
		}
		return detail, access.Episodes[0]
	}

	for _, tt := range []struct {
		publicID string
		role     string
	}{
		{publicID: "STAFFADMIN01", role: auth.RoleTenantAdmin},
		{publicID: "STAFFEDITR01", role: auth.RoleTenantEditor},
		{publicID: "STAFFAUDIT01", role: auth.RoleTenantAuditor},
	} {
		t.Run(tt.role, func(t *testing.T) {
			staff := seedReaderWithRole(t, env, tenant, tt.publicID, tt.role)
			detail, inSeries := read(t, staff)
			if detail.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
				t.Fatalf("access = %v, want entitled", detail.Access)
			}
			if detail.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_STAFF {
				t.Fatalf("entitlement source = %v, want staff", detail.EntitlementSource)
			}
			if len(detail.Images) != 1 {
				t.Fatalf("images = %d, want 1", len(detail.Images))
			}
			if subject := mediaTokenSubject(t, detail.Images[0].ImageUrl); subject != staff.PublicID {
				t.Fatalf("media token subject = %q, want the member of staff %q", subject, staff.PublicID)
			}
			if inSeries.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED ||
				inSeries.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_STAFF ||
				inSeries.Owned {
				t.Fatalf("series episode access = %v, want entitled by staff and not owned", inSeries)
			}
		})
	}

	for _, tt := range []struct {
		name     string
		publicID string
		role     string
	}{
		{name: "no role", publicID: "ENDUSERREA01"},
		{name: "a role string outside the three", publicID: "ENDUSERUNK01", role: "tenant_owner"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			detail, inSeries := read(t, seedReaderWithRole(t, env, tenant, tt.publicID, tt.role))
			if detail.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
				t.Fatalf("access = %v, want locked", detail.Access)
			}
			if detail.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
				t.Fatalf("entitlement source = %v, want unspecified", detail.EntitlementSource)
			}
			if len(detail.Images) != 0 {
				t.Fatalf("images = %d, want none", len(detail.Images))
			}
			if inSeries.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED ||
				inSeries.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
				t.Fatalf("series episode access = %v, want locked", inSeries)
			}
		})
	}
}

// The release before reads episode_content_grants and fails a read whose grant
// kind it does not know, so the staff grant opens nothing there while it opens
// the episode here.
func TestDBStaffGrantStaysOutOfThePreviousReleasesView(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid Chapter",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	staff := seedReaderWithRole(t, env, tenant, "STAFFADMIN01", auth.RoleTenantAdmin)

	ctx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, staff))
	detail, err := env.catalogClient().GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if detail.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_STAFF {
		t.Fatalf("entitlement source = %v, want staff", detail.EntitlementSource)
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_content_grants WHERE tenant_id = $1 AND user_id = $2", tenant.ID, staff.ID); got != 0 {
		t.Fatalf("episode_content_grants rows of a member of staff = %d, want none", got)
	}
}

// A purchase is reported as the purchase whoever made it: a member of staff
// who bought an episode to try the checkout sees what a reader would, and a
// reader's purchase is unaffected by the staff grant.
func TestDBGetEpisodeDetailReportsAPurchaseOverTheStaffGrant(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid Chapter",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	staff := seedReaderWithRole(t, env, tenant, "STAFFEDITR01", auth.RoleTenantEditor)
	env.PG.SeedPurchase(t, tenant.ID, staff.ID, episode.ID, 500)
	reader := seedReaderWithRole(t, env, tenant, "ENDUSERREA01", "")
	env.PG.SeedPurchase(t, tenant.ID, reader.ID, episode.ID, 500)

	client := env.catalogClient()
	for _, user := range []testutil.TenantUser{staff, reader} {
		ctx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, user))
		detail, err := client.GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID})
		if err != nil {
			t.Fatalf("GetEpisodeDetail by %s: %v", user.PublicID, err)
		}
		if detail.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED ||
			detail.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_PURCHASE {
			t.Fatalf("GetEpisodeDetail by %s = %v from %v, want entitled by the purchase", user.PublicID, detail.Access, detail.EntitlementSource)
		}
		access, err := client.GetSeriesEpisodeAccess(ctx, &publirav1.GetSeriesEpisodeAccessRequest{Tenant: tenantContext(tenant), SeriesId: series.ID.String()})
		if err != nil {
			t.Fatalf("GetSeriesEpisodeAccess by %s: %v", user.PublicID, err)
		}
		if len(access.Episodes) != 1 ||
			access.Episodes[0].EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_PURCHASE ||
			!access.Episodes[0].Owned {
			t.Fatalf("series episode access by %s = %v, want owned through the purchase", user.PublicID, access.Episodes)
		}
	}
}

// A staff role is not proof of an age any more than a purchase is.
func TestDBGetEpisodeDetailAgeRuleOutranksTheStaffGrant(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	setTenantAgeVerification(t, env, tenant.ID, ageverification.R18)
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Rated Series",
		Published: true,
		AgeRating: ageverification.RatingR18,
	})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEAGE01",
		Title:    "Rated Episode",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
	staff := seedReaderWithRole(t, env, tenant, "STAFFADMIN01", auth.RoleTenantAdmin)

	ctx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, staff))
	resp, err := env.catalogClient().GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if resp.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED {
		t.Fatalf("access = %v, want age restricted", resp.Access)
	}
	if resp.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
		t.Fatalf("entitlement source = %v, want unspecified", resp.EntitlementSource)
	}
	if len(resp.Images) != 0 {
		t.Fatalf("images = %d, want none", len(resp.Images))
	}
	access, err := env.catalogClient().GetSeriesEpisodeAccess(ctx, &publirav1.GetSeriesEpisodeAccessRequest{Tenant: tenantContext(tenant), SeriesId: series.ID.String()})
	if err != nil {
		t.Fatalf("GetSeriesEpisodeAccess: %v", err)
	}
	if len(access.Episodes) != 1 ||
		access.Episodes[0].Access != publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED ||
		access.Episodes[0].EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
		t.Fatalf("series episode access = %v, want age restricted", access.Episodes)
	}
}

// The staff grant opens every episode, so it would otherwise let the tenant's
// own staff rate their catalogue into the figures the storefront ranks by. A
// member of staff is refused on a free episode and on one they bought, too.
func TestDBRateEpisodeRefusesTenantStaff(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Rated Series", Published: true})
	free := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEFRE01", Title: "Free", Status: testutil.EpisodeStatusPublished})
	paid := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPAY01", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500})

	client := env.ratingClient()
	for _, tt := range []struct {
		publicID string
		role     string
	}{
		{publicID: "STAFFADMIN01", role: auth.RoleTenantAdmin},
		{publicID: "STAFFEDITR01", role: auth.RoleTenantEditor},
		{publicID: "STAFFAUDIT01", role: auth.RoleTenantAuditor},
	} {
		t.Run(tt.role, func(t *testing.T) {
			staff := seedReaderWithRole(t, env, tenant, tt.publicID, tt.role)
			env.PG.SeedPurchase(t, tenant.ID, staff.ID, paid.ID, 500)
			for _, episode := range []testutil.Episode{free, paid} {
				_, err := client.RateEpisode(testutil.WithBearer(context.Background(), tokenFor(t, tenant, staff)), rateEpisodeRequest(tenant, episode.ID.String(), 1))
				assertPermissionDeniedReason(t, err, rpcerrors.ReasonReaderIsTenantStaff)
			}
			if got := env.countRows(t, "SELECT COUNT(*) FROM episode_ratings WHERE tenant_id = $1 AND user_id = $2", tenant.ID, staff.ID); got != 0 {
				t.Fatalf("the member of staff's stored ratings = %d, want none", got)
			}
		})
	}

	reader := seedReaderWithRole(t, env, tenant, "ENDUSERREA01", "")
	unknown := seedReaderWithRole(t, env, tenant, "ENDUSERUNK01", "tenant_owner")
	env.PG.SeedPurchase(t, tenant.ID, unknown.ID, paid.ID, 500)
	for _, user := range []testutil.TenantUser{reader, unknown} {
		if _, err := client.RateEpisode(testutil.WithBearer(context.Background(), tokenFor(t, tenant, user)), rateEpisodeRequest(tenant, free.ID.String(), 1)); err != nil {
			t.Fatalf("RateEpisode free by %s: %v", user.PublicID, err)
		}
	}
	if _, err := client.RateEpisode(testutil.WithBearer(context.Background(), tokenFor(t, tenant, unknown)), rateEpisodeRequest(tenant, paid.ID.String(), 1)); err != nil {
		t.Fatalf("RateEpisode paid by %s: %v", unknown.PublicID, err)
	}
}

// Trying the checkout is one reason staff use the storefront, so the grant
// that opens the episode does not refuse its sale the way a credit does.
func TestDBStartEpisodeCheckoutStaysOpenToTenantStaff(t *testing.T) {
	env := newPurchaseSurfaceEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "PAYSTAFFSR01", Title: "Staff Series", Published: true})
	episode := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYSTAFFEP01", Status: testutil.EpisodeStatusPublished, Price: 500})
	env.pg.SeedTenantUserRole(t, env.tenant.ID, env.user.ID, auth.RoleTenantEditor)

	if code, started := env.startCheckout(t, episode.ID.String(), checkoutFromWeb); code != checkoutSucceeded || !started {
		t.Fatalf("checkout by a member of staff = %v (started %v), want it started", code, started)
	}
	client := publirav1connect.NewPurchaseServiceClient(connect.NewClient(connecthttp.NewTransport(env.ts.Client(), env.ts.URL)))
	if _, err := client.StartEpisodeCheckout(testutil.WithBearer(context.Background(), env.token), &publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: episode.ID.String(),
		Tenant:    tenantContext(env.tenant),
		Client:    checkoutFromApp,
	}); err != nil {
		t.Fatalf("checkout by a member of staff from the app: %v", err)
	}
}

// The reaction control is built from GetMyEpisodeRating, so the role that
// refuses a rating is reported there, on a free episode as on a paid one. A
// role string outside the three reads as no role.
func TestDBGetMyEpisodeRatingReportsTenantStaff(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Rated Series", Published: true})
	free := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEFRE01", Title: "Free", Status: testutil.EpisodeStatusPublished})
	paid := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPAY01", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500})

	client := env.ratingClient()
	for _, tc := range []struct {
		user testutil.TenantUser
		want bool
	}{
		{user: seedReaderWithRole(t, env, tenant, "STAFFADMIN01", auth.RoleTenantAdmin), want: true},
		{user: seedReaderWithRole(t, env, tenant, "STAFFEDITR01", auth.RoleTenantEditor), want: true},
		{user: seedReaderWithRole(t, env, tenant, "STAFFAUDIT01", auth.RoleTenantAuditor), want: true},
		{user: seedReaderWithRole(t, env, tenant, "ENDUSERREA01", ""), want: false},
		{user: seedReaderWithRole(t, env, tenant, "ENDUSERUNK01", "tenant_owner"), want: false},
	} {
		for _, episode := range []testutil.Episode{free, paid} {
			res, err := client.GetMyEpisodeRating(testutil.WithBearer(context.Background(), tokenFor(t, tenant, tc.user)), myEpisodeRatingRequest(tenant, episode.ID.String()))
			if err != nil {
				t.Fatalf("GetMyEpisodeRating %s by %s: %v", episode.PublicID, tc.user.PublicID, err)
			}
			if res.ReaderIsStaff != tc.want || res.ReaderCredited {
				t.Fatalf("GetMyEpisodeRating %s by %s = reader_is_staff %v, reader_credited %v; want %v, false", episode.PublicID, tc.user.PublicID, res.ReaderIsStaff, res.ReaderCredited, tc.want)
			}
		}
	}
}
