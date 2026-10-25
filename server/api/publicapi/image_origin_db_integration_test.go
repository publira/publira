package publicapi

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/testutil"
)

// imageHostCatalog is what one tenant's catalog answers about its images: an
// episode's pages and eye-catch, a series credit's icon, and a banner.
type imageHostCatalog struct {
	pageURL     string
	eyeCatchURL string
	creatorURL  string
	bannerURL   string
}

// seedImageHostCatalog gives the tenant one published series credited to a
// creator with an icon, one free episode with a page and an eye-catch, and one
// banner, and reads what the public API answers for them as a guest.
func seedImageHostCatalog(t *testing.T, env *publicDBEnv, tenant testutil.Tenant) imageHostCatalog {
	t.Helper()
	ctx := context.Background()

	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: tenant.PublicID + "SERIE", Title: "Serialized Story", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: tenant.PublicID + "EPISO", Title: "Chapter One", Status: testutil.EpisodeStatusPublished})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
	seedEpisodeEyeCatch(t, env, tenant.ID, episode)
	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: tenant.PublicID + "CREAT", Name: "Creator"})
	iconID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx, `INSERT INTO creator_images (id, tenant_id, creator_id) VALUES ($1, $2, $3)`, iconID, tenant.ID, creator.ID); err != nil {
		t.Fatalf("seed creator icon: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `UPDATE creators SET icon_image_id = $1 WHERE id = $2`, iconID, creator.ID); err != nil {
		t.Fatalf("point the creator at its icon: %v", err)
	}
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")
	env.PG.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{PublicID: tenant.PublicID + "BANNE", DisplayOrder: 1, Published: true})

	detail, err := env.catalogClient().GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if len(detail.Images) != 1 || len(detail.Episode.EyeCatchImageVariants) != 1 {
		t.Fatalf("episode detail = %d pages and %v, want one page and one eye-catch", len(detail.Images), detail.Episode.EyeCatchImageVariants)
	}
	seriesDetail, err := env.catalogClient().GetSeriesDetail(ctx, &publirav1.GetSeriesDetailRequest{Tenant: tenantContext(tenant), PublicId: series.PublicID})
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if len(seriesDetail.Series.Creators) != 1 {
		t.Fatalf("series credits = %v, want the one creator", seriesDetail.Series.Creators)
	}
	banners := listCampaignBanners(t, env, tenant)
	if len(banners) != 1 || len(banners[0].ImageVariants) != 1 {
		t.Fatalf("banners = %v, want one with its variant", banners)
	}
	return imageHostCatalog{
		pageURL:     detail.Images[0].ImageUrl,
		eyeCatchURL: detail.Episode.EyeCatchImageVariants[0].Url,
		creatorURL:  seriesDetail.Series.Creators[0].IconImageUrl,
		bannerURL:   banners[0].ImageVariants[0].Url,
	}
}

// A tenant with an image host is answered image URLs on it, so the storefront
// loads them from there; a tenant without one keeps paths on its own domain.
func TestDBImageURLsAreAbsoluteOnTheTenantsImageHost(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	env := newPublicDBEnv(t)
	withHost, withoutHost := env.seedTwoTenants(t)
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE tenants SET image_domain = 'images.tenant-a.example.com' WHERE id = $1`, withHost.ID); err != nil {
		t.Fatalf("set image_domain: %v", err)
	}

	for _, tc := range []struct {
		name   string
		tenant testutil.Tenant
		prefix string
	}{
		{"a tenant with an image host", withHost, "https://images.tenant-a.example.com/images/"},
		{"a tenant without one", withoutHost, "/images/"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			catalog := seedImageHostCatalog(t, env, tc.tenant)
			for name, url := range map[string]string{
				"page":      catalog.pageURL,
				"eye-catch": catalog.eyeCatchURL,
				"creator":   catalog.creatorURL,
				"banner":    catalog.bannerURL,
			} {
				if !strings.HasPrefix(url, tc.prefix) {
					t.Errorf("%s url = %q, want it under %q", name, url, tc.prefix)
				}
			}
			// The page keeps the media token its reader decrypts it with.
			if !strings.Contains(catalog.pageURL, "?"+auth.MediaTokenQueryParam+"=") {
				t.Errorf("page url = %q, want it to carry the media token", catalog.pageURL)
			}
		})
	}
}
