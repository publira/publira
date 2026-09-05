package adminapi

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"strings"
	"sync"
	"testing"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

func brandingSourcePNG(t *testing.T, width, height int) []byte {
	t.Helper()

	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			img.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 0x40, A: 0xff})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

func TestDBTenantIconUploadReplaceAndDelete(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	themes := env.themeClient()

	uploaded, err := themes.UploadTenantIcon(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadTenantIconRequest{
		Tenant:          tenant.tenantContext(),
		IconData:        brandingSourcePNG(t, 128, 96),
		IconContentType: "image/png",
	}))
	if err != nil {
		t.Fatalf("UploadTenantIcon: %v", err)
	}
	firstURL := brandingImageURL(uploaded.Msg.Theme.IconImageVariants)
	if !strings.HasPrefix(firstURL, "/images/tenants/") {
		t.Fatalf("icon variant url = %q, want a /images/tenants/ URL", firstURL)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_images rows = %d, want 1", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_image_variants WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_image_variants rows = %d, want 1", got)
	}

	// A tenant that never saved a color still gets its theme row created by the
	// upload, and the colors keep their defaults.
	fetched, err := themes.GetTenantTheme(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantThemeRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantTheme: %v", err)
	}
	if brandingImageURL(fetched.Msg.Theme.IconImageVariants) != firstURL {
		t.Fatalf("reloaded icon variant url = %q, want %q", brandingImageURL(fetched.Msg.Theme.IconImageVariants), firstURL)
	}
	if fetched.Msg.Theme.PrimaryColor != "#0f7c82" {
		t.Fatalf("primary_color = %q, want the column default #0f7c82", fetched.Msg.Theme.PrimaryColor)
	}

	replaced, err := themes.UploadTenantIcon(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadTenantIconRequest{
		Tenant:          tenant.tenantContext(),
		IconData:        brandingSourcePNG(t, 64, 64),
		IconContentType: "image/png",
	}))
	if err != nil {
		t.Fatalf("UploadTenantIcon (replace): %v", err)
	}
	if brandingImageURL(replaced.Msg.Theme.IconImageVariants) == firstURL {
		t.Fatalf("icon variant url did not change on replace: %q", brandingImageURL(replaced.Msg.Theme.IconImageVariants))
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_images rows after replace = %d, want 1", got)
	}

	deleted, err := themes.DeleteTenantIcon(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteTenantIconRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("DeleteTenantIcon: %v", err)
	}
	if brandingImageURL(deleted.Msg.Theme.IconImageVariants) != "" {
		t.Fatalf("icon variant url after delete = %q, want empty", brandingImageURL(deleted.Msg.Theme.IconImageVariants))
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("tenant_images rows after delete = %d, want 0", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_image_variants WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("tenant_image_variants rows after delete = %d, want 0", got)
	}
}

func TestDBTenantIconIsPerTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	themes := env.themeClient()

	if _, err := themes.UploadTenantIcon(context.Background(), newAdminDBRequest(first, &publiraadminv1.UploadTenantIconRequest{
		Tenant:          first.tenantContext(),
		IconData:        brandingSourcePNG(t, 64, 64),
		IconContentType: "image/png",
	})); err != nil {
		t.Fatalf("UploadTenantIcon: %v", err)
	}

	other, err := themes.GetTenantTheme(context.Background(), newAdminDBRequest(second, &publiraadminv1.GetTenantThemeRequest{
		Tenant: second.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantTheme: %v", err)
	}
	if brandingImageURL(other.Msg.Theme.IconImageVariants) != "" {
		t.Fatalf("second tenant icon variant url = %q, want empty", brandingImageURL(other.Msg.Theme.IconImageVariants))
	}
}

// Concurrent changes must not each read the same previous icon: the one that
// commits last would then leave the image the other stored behind with nothing
// pointing at it.
func TestDBTenantIconConcurrentChangesLeaveOneImage(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	themes := env.themeClient()

	const concurrentUploads = 4
	var wg sync.WaitGroup
	errs := make([]error, concurrentUploads)
	for i := range concurrentUploads {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = themes.UploadTenantIcon(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadTenantIconRequest{
				Tenant:          tenant.tenantContext(),
				IconData:        brandingSourcePNG(t, 64, 64),
				IconContentType: "image/png",
			}))
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("UploadTenantIcon[%d]: %v", i, err)
		}
	}

	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_images rows = %d, want 1", got)
	}

	fetched, err := themes.GetTenantTheme(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantThemeRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantTheme: %v", err)
	}
	surviving := env.countRows(t,
		"SELECT count(*) FROM tenant_images WHERE tenant_id = $1 AND '/images/tenants/' || id::text || '/icon' = $2",
		tenant.Tenant.ID, brandingImageURL(fetched.Msg.Theme.IconImageVariants))
	if surviving != 1 {
		t.Fatalf("icon variant url %q does not point at the surviving tenant image", brandingImageURL(fetched.Msg.Theme.IconImageVariants))
	}
}

func TestDBTenantLogoUploadReplaceAndDelete(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	themes := env.themeClient()

	uploaded, err := themes.UploadTenantLogo(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadTenantLogoRequest{
		Tenant:          tenant.tenantContext(),
		LogoData:        brandingSourcePNG(t, 320, 80),
		LogoContentType: "image/png",
	}))
	if err != nil {
		t.Fatalf("UploadTenantLogo: %v", err)
	}
	firstURL := brandingImageURL(uploaded.Msg.Theme.LogoImageVariants)
	if !strings.HasPrefix(firstURL, "/images/tenants/") {
		t.Fatalf("logo variant url = %q, want a /images/tenants/ URL", firstURL)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_images rows = %d, want 1", got)
	}

	// The stored variant keeps the source aspect ratio: a wordmark that came
	// back square would mean the icon's center crop leaked into this path.
	if got := env.countRows(t,
		"SELECT count(*) FROM tenant_image_variants WHERE tenant_id = $1 AND width = 320 AND height = 80",
		tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_image_variants rows at 320x80 = %d, want 1", got)
	}

	// A tenant that never saved a color still gets its theme row created by the
	// upload, and the colors keep their defaults.
	fetched, err := themes.GetTenantTheme(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantThemeRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantTheme: %v", err)
	}
	if brandingImageURL(fetched.Msg.Theme.LogoImageVariants) != firstURL {
		t.Fatalf("reloaded logo variant url = %q, want %q", brandingImageURL(fetched.Msg.Theme.LogoImageVariants), firstURL)
	}
	if fetched.Msg.Theme.PrimaryColor != "#0f7c82" {
		t.Fatalf("primary_color = %q, want the column default #0f7c82", fetched.Msg.Theme.PrimaryColor)
	}

	replaced, err := themes.UploadTenantLogo(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadTenantLogoRequest{
		Tenant:          tenant.tenantContext(),
		LogoData:        brandingSourcePNG(t, 240, 120),
		LogoContentType: "image/png",
	}))
	if err != nil {
		t.Fatalf("UploadTenantLogo (replace): %v", err)
	}
	if brandingImageURL(replaced.Msg.Theme.LogoImageVariants) == firstURL {
		t.Fatalf("logo variant url did not change on replace: %q", brandingImageURL(replaced.Msg.Theme.LogoImageVariants))
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_images rows after replace = %d, want 1", got)
	}

	deleted, err := themes.DeleteTenantLogo(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteTenantLogoRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("DeleteTenantLogo: %v", err)
	}
	if brandingImageURL(deleted.Msg.Theme.LogoImageVariants) != "" {
		t.Fatalf("logo variant url after delete = %q, want empty", brandingImageURL(deleted.Msg.Theme.LogoImageVariants))
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("tenant_images rows after delete = %d, want 0", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_image_variants WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("tenant_image_variants rows after delete = %d, want 0", got)
	}
}

// The icon and the logo share tenant_images, so each write has to leave the
// other slot alone — including the delete, which drops the image the theme
// pointed at.
func TestDBTenantLogoAndIconAreIndependent(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	themes := env.themeClient()

	iconUploaded, err := themes.UploadTenantIcon(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadTenantIconRequest{
		Tenant:          tenant.tenantContext(),
		IconData:        brandingSourcePNG(t, 64, 64),
		IconContentType: "image/png",
	}))
	if err != nil {
		t.Fatalf("UploadTenantIcon: %v", err)
	}
	iconURL := brandingImageURL(iconUploaded.Msg.Theme.IconImageVariants)

	logoUploaded, err := themes.UploadTenantLogo(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadTenantLogoRequest{
		Tenant:          tenant.tenantContext(),
		LogoData:        brandingSourcePNG(t, 320, 80),
		LogoContentType: "image/png",
	}))
	if err != nil {
		t.Fatalf("UploadTenantLogo: %v", err)
	}
	if brandingImageURL(logoUploaded.Msg.Theme.IconImageVariants) != iconURL {
		t.Fatalf("icon variant url changed on a logo upload: %q, want %q", brandingImageURL(logoUploaded.Msg.Theme.IconImageVariants), iconURL)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 2 {
		t.Fatalf("tenant_images rows = %d, want 2", got)
	}

	deleted, err := themes.DeleteTenantLogo(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteTenantLogoRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("DeleteTenantLogo: %v", err)
	}
	if brandingImageURL(deleted.Msg.Theme.LogoImageVariants) != "" {
		t.Fatalf("logo variant url after delete = %q, want empty", brandingImageURL(deleted.Msg.Theme.LogoImageVariants))
	}
	if brandingImageURL(deleted.Msg.Theme.IconImageVariants) != iconURL {
		t.Fatalf("icon variant url after a logo delete = %q, want %q", brandingImageURL(deleted.Msg.Theme.IconImageVariants), iconURL)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_images rows after the logo delete = %d, want 1", got)
	}
}
