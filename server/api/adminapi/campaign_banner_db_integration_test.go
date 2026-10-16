package adminapi

import (
	"context"
	"database/sql"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/campaignbanners"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) campaignBannerClient() publiraadminv1connect.AdminCampaignBannerServiceClient {
	return publiraadminv1connect.NewAdminCampaignBannerServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

// openWindow is a window that has started and has an hour to run, in the
// RFC 3339 the console sends.
func openWindow() (string, string) {
	now := time.Now().UTC().Truncate(time.Second)
	return now.Add(-time.Hour).Format(time.RFC3339), now.Add(time.Hour).Format(time.RFC3339)
}

// createCampaignBanner creates a banner over a window open now, with the
// smallest image every ratio accepts.
func createCampaignBanner(
	t *testing.T,
	client publiraadminv1connect.AdminCampaignBannerServiceClient,
	tenant adminDBTenant,
	link string,
	published bool,
) *publiraadminv1.AdminCampaignBanner {
	t.Helper()

	startsAt, endsAt := openWindow()
	created, err := client.CreateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		LinkUrl:          link,
		StartsAt:         startsAt,
		EndsAt:           endsAt,
		Published:        published,
		ImageData:        aspectJPEG(t, 2400, 3200),
		ImageContentType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("CreateCampaignBanner(%q): %v", link, err)
	}
	return created.Banner
}

func listCampaignBanners(t *testing.T, client publiraadminv1connect.AdminCampaignBannerServiceClient, tenant adminDBTenant) []*publiraadminv1.AdminCampaignBanner {
	t.Helper()

	listed, err := client.ListCampaignBanners(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListCampaignBannersRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListCampaignBanners: %v", err)
	}
	return listed.Banners
}

func campaignBannerLinks(banners []*publiraadminv1.AdminCampaignBanner) []string {
	links := make([]string, 0, len(banners))
	for _, banner := range banners {
		links = append(links, banner.LinkUrl)
	}
	return links
}

func TestDBCreateCampaignBannerStoresTheBannerAndEveryRatioOfItsImage(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.campaignBannerClient()

	startsAt, endsAt := openWindow()
	created, err := client.CreateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		LinkUrl:          "  /series/SERIES000001  ",
		StartsAt:         startsAt,
		EndsAt:           endsAt,
		Published:        true,
		ImageData:        aspectJPEG(t, 2400, 3200),
		ImageContentType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("CreateCampaignBanner: %v", err)
	}
	banner := created.Banner
	if banner.LinkUrl != "/series/SERIES000001" {
		t.Fatalf("link_url = %q, want the trimmed path", banner.LinkUrl)
	}
	if banner.StartsAt != startsAt || banner.EndsAt != endsAt {
		t.Fatalf("window = [%s, %s), want [%s, %s)", banner.StartsAt, banner.EndsAt, startsAt, endsAt)
	}
	if !banner.Published {
		t.Fatal("published = false, want the flag the request set")
	}
	if banner.PublicId == "" || banner.ImageUpdatedAt == "" {
		t.Fatalf("banner = %v, want a public id and an image", banner)
	}
	if got := len(banner.ImageVariants); got != eyeCatchVariantCount {
		t.Fatalf("image variants = %d, want %d", got, eyeCatchVariantCount)
	}
	for _, variant := range banner.ImageVariants {
		if !strings.HasPrefix(variant.Url, "/images/campaign-banners/") {
			t.Fatalf("variant url = %q, want it under /images/campaign-banners/", variant.Url)
		}
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM campaign_banner_image_variants WHERE tenant_id = $1", tenant.Tenant.ID,
	); count != eyeCatchVariantCount {
		t.Fatalf("campaign_banner_image_variants rows = %d, want %d", count, eyeCatchVariantCount)
	}

	got, err := client.GetCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		CampaignBannerId: banner.Id,
	})
	if err != nil {
		t.Fatalf("GetCampaignBanner: %v", err)
	}
	if got.Banner.LinkUrl != banner.LinkUrl || len(got.Banner.ImageVariants) != eyeCatchVariantCount {
		t.Fatalf("got banner = %v, want the created one", got.Banner)
	}
	if listed := listCampaignBanners(t, client, tenant); len(listed) != 1 || listed[0].Id != banner.Id {
		t.Fatalf("listed banners = %v, want the created one", listed)
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'campaign_banner_created' AND target_id = $2",
		tenant.Tenant.ID, banner.PublicId,
	); count != 1 {
		t.Fatalf("audit entries for the create = %d, want 1", count)
	}
}

func TestDBCreateCampaignBannerRefusesWhatWouldShowNothingOrLeadNowhere(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.campaignBannerClient()

	startsAt, endsAt := openWindow()
	now := time.Now().UTC().Truncate(time.Second)
	valid := func() *publiraadminv1.CreateCampaignBannerRequest {
		return &publiraadminv1.CreateCampaignBannerRequest{
			Tenant:           tenant.tenantContext(),
			LinkUrl:          "https://campaign.example.com/autumn",
			StartsAt:         startsAt,
			EndsAt:           endsAt,
			Published:        true,
			ImageData:        aspectJPEG(t, 2400, 3200),
			ImageContentType: "image/jpeg",
		}
	}
	cases := []struct {
		name   string
		change func(*publiraadminv1.CreateCampaignBannerRequest)
		field  string
	}{
		{name: "no image", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.ImageData = nil }, field: "image_data"},
		{name: "an image too small to cut", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.ImageData = aspectJPEG(t, 600, 800) }, field: "image_data"},
		{name: "no link", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.LinkUrl = "  " }, field: "link_url"},
		{name: "a protocol-relative link", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.LinkUrl = "//attacker.example/" }, field: "link_url"},
		{name: "a backslash link", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.LinkUrl = `/\attacker.example/` }, field: "link_url"},
		{name: "a script link", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.LinkUrl = "javascript:alert(1)" }, field: "link_url"},
		{name: "a relative link", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.LinkUrl = "series/SERIES000001" }, field: "link_url"},
		{name: "a link with no host", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.LinkUrl = "https:///path" }, field: "link_url"},
		{name: "a link past the bound", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.LinkUrl = "/" + strings.Repeat("a", 2048) }, field: "link_url"},
		{name: "a start that is not RFC 3339", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.StartsAt = "2026-10-16 09:00" }, field: "starts_at"},
		{name: "an end before the start", change: func(r *publiraadminv1.CreateCampaignBannerRequest) { r.StartsAt, r.EndsAt = r.EndsAt, r.StartsAt }, field: "ends_at"},
		{name: "a window already over", change: func(r *publiraadminv1.CreateCampaignBannerRequest) {
			r.StartsAt = now.Add(-2 * time.Hour).Format(time.RFC3339)
			r.EndsAt = now.Add(-time.Hour).Format(time.RFC3339)
		}, field: "ends_at"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := valid()
			tc.change(req)
			_, err := client.CreateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("CreateCampaignBanner error = %v, want invalid_argument", err)
			}
			assertBadRequestField(t, err, tc.field)
		})
	}
	if count := env.countRows(t, "SELECT count(*) FROM campaign_banners WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("banners after the refused creates = %d, want none", count)
	}
}

// A create whose image the object store refuses part-way must not leave a
// banner behind to count against the cap.
func TestDBCreateCampaignBannerWhoseImageTheStoreRefusesLeavesNoBanner(t *testing.T) {
	store := &refusingStorageProvider{}
	store.refuse.Store(true)
	env := newAdminDBEnvWithStorage(t, store)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.campaignBannerClient()

	startsAt, endsAt := openWindow()
	_, err := client.CreateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		LinkUrl:          "/series",
		StartsAt:         startsAt,
		EndsAt:           endsAt,
		ImageData:        aspectJPEG(t, 2400, 3200),
		ImageContentType: "image/jpeg",
	})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("CreateCampaignBanner with the store refusing error = %v, want internal", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM campaign_banners WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("banners after the refused create = %d, want 0", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM campaign_banner_images WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("campaign_banner_images after the refused create = %d, want 0", count)
	}
}

func TestDBCreateCampaignBannerRefusesATenantAtTheCap(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.campaignBannerClient()

	for index := range maxCampaignBanners {
		env.PG.SeedCampaignBanner(t, tenant.Tenant.ID, testutil.CampaignBannerSeed{DisplayOrder: int32(index + 1)})
	}

	startsAt, endsAt := openWindow()
	_, err := client.CreateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		LinkUrl:          "/series",
		StartsAt:         startsAt,
		EndsAt:           endsAt,
		ImageData:        aspectJPEG(t, 2400, 3200),
		ImageContentType: "image/jpeg",
	})
	if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonCampaignBannerLimit {
		t.Fatalf("CreateCampaignBanner past the cap = %v (reason %q), want failed_precondition %s", err, reason, rpcerrors.ReasonCampaignBannerLimit)
	}
	if listed := listCampaignBanners(t, client, tenant); len(listed) != maxCampaignBanners {
		t.Fatalf("listed banners = %d, want the %d the cap allows, every one of them in one answer", len(listed), maxCampaignBanners)
	}

	// The cap is the tenant's own: another tenant's banners count for nothing.
	createCampaignBanner(t, client, other, "/series", true)
}

func TestDBUpdateCampaignBannerKeepsTheImageAndReplacesItWhenGivenOne(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.campaignBannerClient()

	created := createCampaignBanner(t, client, tenant, "/series", false)
	startsAt := time.Now().UTC().Truncate(time.Second).Add(24 * time.Hour).Format(time.RFC3339)
	endsAt := time.Now().UTC().Truncate(time.Second).Add(48 * time.Hour).Format(time.RFC3339)

	updated, err := client.UpdateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		CampaignBannerId: created.Id,
		LinkUrl:          "https://campaign.example.com/winter",
		StartsAt:         startsAt,
		EndsAt:           endsAt,
		Published:        true,
	})
	if err != nil {
		t.Fatalf("UpdateCampaignBanner: %v", err)
	}
	banner := updated.Banner
	if banner.LinkUrl != "https://campaign.example.com/winter" || banner.StartsAt != startsAt || banner.EndsAt != endsAt || !banner.Published {
		t.Fatalf("updated banner = %v, want the new link, window, and flag", banner)
	}
	if !slices.Equal(variantURLs(banner.ImageVariants), variantURLs(created.ImageVariants)) {
		t.Fatal("image variants changed on an update that carried no image")
	}

	replaced, err := client.UpdateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		CampaignBannerId: created.Id,
		LinkUrl:          banner.LinkUrl,
		StartsAt:         banner.StartsAt,
		EndsAt:           banner.EndsAt,
		Published:        true,
		ImageData:        aspectJPEG(t, 2400, 3200),
		ImageContentType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("UpdateCampaignBanner with an image: %v", err)
	}
	if got := len(replaced.Banner.ImageVariants); got != eyeCatchVariantCount {
		t.Fatalf("variants after the replacement = %d, want %d", got, eyeCatchVariantCount)
	}
	if slices.Equal(eyeCatchPaths(t, variantURLs(replaced.Banner.ImageVariants)), eyeCatchPaths(t, variantURLs(created.ImageVariants))) {
		t.Fatal("image routes unchanged after the replacement, want the new image's")
	}
	// The image the banner let go of is left for the orphan sweep.
	if count := env.countRows(t, "SELECT count(*) FROM campaign_banner_images WHERE tenant_id = $1", tenant.Tenant.ID); count != 2 {
		t.Fatalf("campaign_banner_images rows = %d, want the replaced one and the new one", count)
	}
}

// An expired banner keeps its window, so an editor taking it down or fixing its
// link is not asked to reschedule it first; a new window is held to the future.
func TestDBUpdateCampaignBannerAcceptsAnExpiredWindowItAlreadyHas(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.campaignBannerClient()

	now := time.Now().UTC().Truncate(time.Second)
	expired := env.PG.SeedCampaignBanner(t, tenant.Tenant.ID, testutil.CampaignBannerSeed{
		StartsAt:  now.Add(-48 * time.Hour),
		EndsAt:    now.Add(-24 * time.Hour),
		Published: true,
	})

	if _, err := client.UpdateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		CampaignBannerId: expired.ID.String(),
		LinkUrl:          "/labels",
		StartsAt:         now.Add(-48 * time.Hour).Format(time.RFC3339),
		EndsAt:           now.Add(-24 * time.Hour).Format(time.RFC3339),
		Published:        false,
	}); err != nil {
		t.Fatalf("UpdateCampaignBanner keeping the expired window: %v", err)
	}

	_, err := client.UpdateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		CampaignBannerId: expired.ID.String(),
		LinkUrl:          "/labels",
		StartsAt:         now.Add(-72 * time.Hour).Format(time.RFC3339),
		EndsAt:           now.Add(-time.Hour).Format(time.RFC3339),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateCampaignBanner to another expired window error = %v, want invalid_argument", err)
	}
}

// A save drops the band itself, so it writes both boundary marks: a boundary
// stored in the past is applied already, and one in the future is owed to the
// ticker again, even when the ticker had applied it for the previous window.
func TestDBUpdateCampaignBannerOwesTheTickerOnlyTheBoundariesAhead(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.campaignBannerClient()

	created := createCampaignBanner(t, client, tenant, "/series", true)
	marks := func() (sql.NullTime, sql.NullTime) {
		t.Helper()
		var start, end sql.NullTime
		if err := env.PG.DB.QueryRowContext(context.Background(),
			"SELECT start_revalidated_at, end_revalidated_at FROM campaign_banners WHERE id = $1", created.Id,
		).Scan(&start, &end); err != nil {
			t.Fatalf("read the boundary marks: %v", err)
		}
		return start, end
	}
	if start, end := marks(); !start.Valid || end.Valid {
		t.Fatalf("marks after creating an open window = (%v, %v), want the start applied and the end owed", start, end)
	}

	now := time.Now().UTC().Truncate(time.Second)
	if _, err := client.UpdateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		CampaignBannerId: created.Id,
		LinkUrl:          created.LinkUrl,
		StartsAt:         now.Add(time.Hour).Format(time.RFC3339),
		EndsAt:           now.Add(2 * time.Hour).Format(time.RFC3339),
		Published:        true,
	}); err != nil {
		t.Fatalf("UpdateCampaignBanner: %v", err)
	}
	if start, end := marks(); start.Valid || end.Valid {
		t.Fatalf("marks after moving the window ahead = (%v, %v), want both owed", start, end)
	}
}

func TestDBReorderCampaignBannersWritesTheOrderAndRefusesAStaleOne(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.campaignBannerClient()

	first := createCampaignBanner(t, client, tenant, "/first", true)
	second := createCampaignBanner(t, client, tenant, "/second", true)
	third := createCampaignBanner(t, client, tenant, "/third", true)

	reordered, err := client.ReorderCampaignBanners(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ReorderCampaignBannersRequest{
		Tenant:                    tenant.tenantContext(),
		CampaignBannerIds:         []string{third.Id, first.Id, second.Id},
		ExpectedCampaignBannerIds: []string{first.Id, second.Id, third.Id},
	})
	if err != nil {
		t.Fatalf("ReorderCampaignBanners: %v", err)
	}
	want := []string{"/third", "/first", "/second"}
	if got := campaignBannerLinks(reordered.Banners); !slices.Equal(got, want) {
		t.Fatalf("reordered = %v, want %v", got, want)
	}
	if got := campaignBannerLinks(listCampaignBanners(t, client, tenant)); !slices.Equal(got, want) {
		t.Fatalf("listed after the reorder = %v, want %v", got, want)
	}
	for _, banner := range reordered.Banners {
		if len(banner.ImageVariants) != eyeCatchVariantCount {
			t.Fatalf("reordered banner %s carries %d variants, want its image", banner.LinkUrl, len(banner.ImageVariants))
		}
	}

	_, err = client.ReorderCampaignBanners(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ReorderCampaignBannersRequest{
		Tenant:                    tenant.tenantContext(),
		CampaignBannerIds:         []string{second.Id, first.Id, third.Id},
		ExpectedCampaignBannerIds: []string{first.Id, second.Id, third.Id},
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ReorderCampaignBanners from a stale order error = %v, want failed_precondition", err)
	}
}

func TestDBDeleteCampaignBannerTakesItsImageWithIt(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.campaignBannerClient()

	created := createCampaignBanner(t, client, tenant, "/series", true)
	if _, err := client.DeleteCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		CampaignBannerId: created.Id,
	}); err != nil {
		t.Fatalf("DeleteCampaignBanner: %v", err)
	}
	if listed := listCampaignBanners(t, client, tenant); len(listed) != 0 {
		t.Fatalf("listed after the delete = %v, want none", campaignBannerLinks(listed))
	}
	if count := env.countRows(t, "SELECT count(*) FROM campaign_banner_image_variants WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("campaign_banner_image_variants after the delete = %d, want 0", count)
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'campaign_banner_deleted' AND target_id = $2",
		tenant.Tenant.ID, created.PublicId,
	); count != 1 {
		t.Fatalf("audit entries for the delete = %d, want 1", count)
	}

	_, err := client.DeleteCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteCampaignBannerRequest{
		Tenant:           tenant.tenantContext(),
		CampaignBannerId: created.Id,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("deleting the banner again error = %v, want not_found", err)
	}
}

// A banner of another tenant is one that does not exist, whichever RPC names
// it.
func TestDBCampaignBannerOfAnotherTenantIsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.campaignBannerClient()

	foreign := createCampaignBanner(t, client, other, "/series", true)
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	startsAt, endsAt := openWindow()

	_, getErr := client.GetCampaignBanner(ctx, &publiraadminv1.GetCampaignBannerRequest{Tenant: tenant.tenantContext(), CampaignBannerId: foreign.Id})
	_, updateErr := client.UpdateCampaignBanner(ctx, &publiraadminv1.UpdateCampaignBannerRequest{
		Tenant: tenant.tenantContext(), CampaignBannerId: foreign.Id, LinkUrl: "/series", StartsAt: startsAt, EndsAt: endsAt,
	})
	_, deleteErr := client.DeleteCampaignBanner(ctx, &publiraadminv1.DeleteCampaignBannerRequest{Tenant: tenant.tenantContext(), CampaignBannerId: foreign.Id})
	_, uploadErr := client.UploadCampaignBannerAspectImage(ctx, &publiraadminv1.UploadCampaignBannerAspectImageRequest{
		Tenant: tenant.tenantContext(), CampaignBannerId: foreign.Id, VariantType: "landscape", ImageData: aspectJPEG(t, 1600, 900), ImageContentType: "image/jpeg",
	})
	for name, err := range map[string]error{"get": getErr, "update": updateErr, "delete": deleteErr, "upload": uploadErr} {
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("%s of another tenant's banner error = %v, want not_found", name, err)
		}
	}
	if listed := listCampaignBanners(t, client, other); len(listed) != 1 || listed[0].LinkUrl != "/series" {
		t.Fatalf("the other tenant's banners = %v, want its one banner untouched", campaignBannerLinks(listed))
	}
}

func TestDBUploadCampaignBannerAspectImageReplacesOnlyThatRatio(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.campaignBannerClient()

	created := createCampaignBanner(t, client, tenant, "/series", true)
	uploaded, err := client.UploadCampaignBannerAspectImage(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UploadCampaignBannerAspectImageRequest{
		Tenant:           tenant.tenantContext(),
		CampaignBannerId: created.Id,
		VariantType:      "landscape",
		ImageData:        aspectJPEG(t, 1600, 900),
		ImageContentType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("UploadCampaignBannerAspectImage: %v", err)
	}
	if got := len(uploaded.Banner.ImageVariants); got != eyeCatchVariantCount {
		t.Fatalf("variants after replacing landscape = %d, want %d", got, eyeCatchVariantCount)
	}
	ratioURLs := func(banner *publiraadminv1.AdminCampaignBanner, ratio string) []string {
		urls := make([]string, 0)
		for _, variant := range banner.ImageVariants {
			if variant.VariantType == ratio {
				urls = append(urls, variant.Url)
			}
		}
		return urls
	}
	if slices.Equal(ratioURLs(uploaded.Banner, "landscape"), ratioURLs(created, "landscape")) {
		t.Fatal("landscape urls unchanged, want the replaced ratio's new versions")
	}
	for _, ratio := range []string{"portrait", "square", "og"} {
		if got, want := ratioURLs(uploaded.Banner, ratio), ratioURLs(created, ratio); !slices.Equal(got, want) {
			t.Fatalf("%s urls = %v, want the urls from before the replacement %v", ratio, got, want)
		}
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'campaign_banner_aspect_image_uploaded' AND target_id = $2",
		tenant.Tenant.ID, created.PublicId+"/landscape",
	); count != 1 {
		t.Fatalf("audit entries for the ratio upload = %d, want 1", count)
	}
}

// The band a site caches holds published banners only, so a write owes it a
// drop when the banner was published before it or is after it, and only then.
func TestDBCampaignBannerWritesDropTheBandOnlyForAPublishedBanner(t *testing.T) {
	env := newReaderIconDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.campaignBannerClient()
	tag := campaignbanners.RevalidateTags(tenant.Tenant.ID)[0]
	drops := func() int {
		t.Helper()
		count := 0
		for _, recorded := range env.revalidatedTags(t, tenant.Tenant) {
			if recorded == tag {
				count++
			}
		}
		return count
	}

	draft := createCampaignBanner(t, client, tenant, "/draft", false)
	if got := drops(); got != 0 {
		t.Fatalf("drops after creating an unpublished banner = %d, want 0", got)
	}
	if _, err := client.UpdateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCampaignBannerRequest{
		Tenant: tenant.tenantContext(), CampaignBannerId: draft.Id, LinkUrl: "/draft-2", StartsAt: draft.StartsAt, EndsAt: draft.EndsAt,
	}); err != nil {
		t.Fatalf("UpdateCampaignBanner of the draft: %v", err)
	}
	if got := drops(); got != 0 {
		t.Fatalf("drops after editing an unpublished banner = %d, want 0", got)
	}

	if _, err := client.UpdateCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCampaignBannerRequest{
		Tenant: tenant.tenantContext(), CampaignBannerId: draft.Id, LinkUrl: "/draft-2", StartsAt: draft.StartsAt, EndsAt: draft.EndsAt, Published: true,
	}); err != nil {
		t.Fatalf("UpdateCampaignBanner publishing the draft: %v", err)
	}
	if got := drops(); got != 1 {
		t.Fatalf("drops after publishing the banner = %d, want 1", got)
	}
	if _, err := client.DeleteCampaignBanner(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteCampaignBannerRequest{
		Tenant: tenant.tenantContext(), CampaignBannerId: draft.Id,
	}); err != nil {
		t.Fatalf("DeleteCampaignBanner: %v", err)
	}
	if got := drops(); got != 2 {
		t.Fatalf("drops after deleting the published banner = %d, want 2", got)
	}
}

func variantURLs[T interface{ GetUrl() string }](variants []T) []string {
	urls := make([]string, 0, len(variants))
	for _, variant := range variants {
		urls = append(urls, variant.GetUrl())
	}
	return urls
}
