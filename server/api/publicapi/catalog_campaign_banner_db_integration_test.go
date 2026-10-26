package publicapi

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// listCampaignBanners reads the banners as a guest: the request carries no
// session at all, which is how the storefront asks for them.
func listCampaignBanners(t *testing.T, env *publicDBEnv, tenant testutil.Tenant) []*publirav1.CampaignBanner {
	t.Helper()

	res, err := env.catalogClient().ListCampaignBanners(context.Background(), &publirav1.ListCampaignBannersRequest{
		Tenant: tenantContext(tenant),
	})
	if err != nil {
		t.Fatalf("ListCampaignBanners: %v", err)
	}
	return res.Banners
}

func campaignBannerPublicIDs(banners []*publirav1.CampaignBanner) []string {
	ids := make([]string, 0, len(banners))
	for _, banner := range banners {
		ids = append(ids, banner.PublicId)
	}
	return ids
}

func TestDBListCampaignBannersAnswersOnlyThePublishedBannersShowingNow(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant, other := env.seedTwoTenants(t)
	now := time.Now()

	second := env.PG.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		PublicID: "BANNERSECOND", LinkURL: "https://campaign.example.com/autumn", AltText: "Autumn sale", DisplayOrder: 2, Published: true,
	})
	first := env.PG.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		PublicID: "BANNERFIRST1", LinkURL: "/series/SERIES000001", DisplayOrder: 1, Published: true,
	})
	env.PG.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		PublicID: "BANNERDRAFT1", DisplayOrder: 3, Published: false,
	})
	env.PG.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		PublicID: "BANNERAHEAD1", DisplayOrder: 4, Published: true,
		StartsAt: now.Add(time.Hour), EndsAt: now.Add(2 * time.Hour),
	})
	env.PG.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		PublicID: "BANNEROVER01", DisplayOrder: 5, Published: true,
		StartsAt: now.Add(-2 * time.Hour), EndsAt: now.Add(-time.Hour),
	})
	env.PG.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		PublicID: "BANNERNOIMG1", DisplayOrder: 6, Published: true, WithoutImage: true,
	})
	env.PG.SeedCampaignBanner(t, other.ID, testutil.CampaignBannerSeed{
		PublicID: "BANNEROTHER1", DisplayOrder: 1, Published: true,
	})

	banners := listCampaignBanners(t, env, tenant)
	// An unpublished banner, one whose window has not opened or has closed, and
	// one with no image to draw are all left out, and so is another tenant's.
	if got, want := campaignBannerPublicIDs(banners), []string{first.PublicID, second.PublicID}; !slices.Equal(got, want) {
		t.Fatalf("banners = %v, want %v in the console's order", got, want)
	}
	if banners[0].LinkUrl != "/series/SERIES000001" || banners[1].LinkUrl != "https://campaign.example.com/autumn" {
		t.Fatalf("links = %q, %q, want each banner's own", banners[0].LinkUrl, banners[1].LinkUrl)
	}
	// A banner nobody has described answers no text, which the client replaces
	// with its own generic name.
	if banners[0].AltText != "" || banners[1].AltText != "Autumn sale" {
		t.Fatalf("alternative texts = %q, %q, want each banner's own", banners[0].AltText, banners[1].AltText)
	}
	for _, banner := range banners {
		if banner.ImageUpdatedAt == "" || len(banner.ImageVariants) != 1 {
			t.Fatalf("banner %s image = (%q, %v), want its stored variant", banner.PublicId, banner.ImageUpdatedAt, banner.ImageVariants)
		}
		variant := banner.ImageVariants[0]
		if !strings.HasPrefix(variant.Url, "/images/campaign-banners/") || variant.VariantType != "landscape" || variant.Width != 800 {
			t.Fatalf("banner %s variant = %v, want the landscape 800 served under /images/campaign-banners/", banner.PublicId, variant)
		}
	}
	if got := campaignBannerPublicIDs(listCampaignBanners(t, env, other)); !slices.Equal(got, []string{"BANNEROTHER1"}) {
		t.Fatalf("the other tenant's banners = %v, want its own", got)
	}
}

// The console turns the dates an operator enters into instants in the tenant's
// own time zone, and the read compares those instants, so a banner scheduled
// from the tenant's midnight is up from that midnight wherever the reader is —
// here a tenant fourteen hours ahead of UTC, whose day starts while UTC's
// previous one is still running.
func TestDBListCampaignBannersJudgesTheWindowByTheTenantsCalendar(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE tenants SET timezone = 'Pacific/Kiritimati' WHERE id = $1", tenant.ID,
	); err != nil {
		t.Fatalf("set the tenant time zone: %v", err)
	}
	zone, err := time.LoadLocation("Pacific/Kiritimati")
	if err != nil {
		t.Fatalf("load the tenant time zone: %v", err)
	}
	local := time.Now().In(zone)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, zone)
	tomorrow := today.AddDate(0, 0, 1)

	env.PG.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		PublicID: "BANNERTODAY1", Published: true, StartsAt: today, EndsAt: tomorrow,
	})
	env.PG.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		PublicID: "BANNERTOMOR1", Published: true, StartsAt: tomorrow, EndsAt: tomorrow.AddDate(0, 0, 1),
	})

	if got := campaignBannerPublicIDs(listCampaignBanners(t, env, tenant)); !slices.Equal(got, []string{"BANNERTODAY1"}) {
		t.Fatalf("banners = %v, want only the one scheduled for the tenant's today", got)
	}
}

// A tenant with nothing scheduled gets an empty answer rather than an error,
// which a storefront draws as no band at all.
func TestDBListCampaignBannersIsEmptyWithNothingScheduled(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	if banners := listCampaignBanners(t, env, tenant); len(banners) != 0 {
		t.Fatalf("banners = %v, want none", campaignBannerPublicIDs(banners))
	}
}
