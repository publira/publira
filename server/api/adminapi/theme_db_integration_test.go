package adminapi

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
)

func faviconSourcePNG(t *testing.T, width, height int) []byte {
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

func TestDBTenantFaviconUploadReplaceAndDelete(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	themes := env.themeClient()

	uploaded, err := themes.UploadTenantFavicon(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadTenantFaviconRequest{
		Tenant:             tenant.tenantContext(),
		FaviconData:        faviconSourcePNG(t, 128, 96),
		FaviconContentType: "image/png",
	}))
	if err != nil {
		t.Fatalf("UploadTenantFavicon: %v", err)
	}
	firstURL := uploaded.Msg.Theme.FaviconUrl
	if !strings.HasPrefix(firstURL, "/images/tenants/") {
		t.Fatalf("favicon_url = %q, want a /images/tenants/ URL", firstURL)
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
	if fetched.Msg.Theme.FaviconUrl != firstURL {
		t.Fatalf("reloaded favicon_url = %q, want %q", fetched.Msg.Theme.FaviconUrl, firstURL)
	}
	if fetched.Msg.Theme.PrimaryColor != "#0f7c82" {
		t.Fatalf("primary_color = %q, want the column default #0f7c82", fetched.Msg.Theme.PrimaryColor)
	}

	replaced, err := themes.UploadTenantFavicon(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadTenantFaviconRequest{
		Tenant:             tenant.tenantContext(),
		FaviconData:        faviconSourcePNG(t, 64, 64),
		FaviconContentType: "image/png",
	}))
	if err != nil {
		t.Fatalf("UploadTenantFavicon (replace): %v", err)
	}
	if replaced.Msg.Theme.FaviconUrl == firstURL {
		t.Fatalf("favicon_url did not change on replace: %q", replaced.Msg.Theme.FaviconUrl)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_images rows after replace = %d, want 1", got)
	}

	deleted, err := themes.DeleteTenantFavicon(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteTenantFaviconRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("DeleteTenantFavicon: %v", err)
	}
	if deleted.Msg.Theme.FaviconUrl != "" {
		t.Fatalf("favicon_url after delete = %q, want empty", deleted.Msg.Theme.FaviconUrl)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("tenant_images rows after delete = %d, want 0", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_image_variants WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("tenant_image_variants rows after delete = %d, want 0", got)
	}
}

func TestDBTenantFaviconIsPerTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	themes := env.themeClient()

	if _, err := themes.UploadTenantFavicon(context.Background(), newAdminDBRequest(first, &publiraadminv1.UploadTenantFaviconRequest{
		Tenant:             first.tenantContext(),
		FaviconData:        faviconSourcePNG(t, 64, 64),
		FaviconContentType: "image/png",
	})); err != nil {
		t.Fatalf("UploadTenantFavicon: %v", err)
	}

	other, err := themes.GetTenantTheme(context.Background(), newAdminDBRequest(second, &publiraadminv1.GetTenantThemeRequest{
		Tenant: second.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantTheme: %v", err)
	}
	if other.Msg.Theme.FaviconUrl != "" {
		t.Fatalf("second tenant favicon_url = %q, want empty", other.Msg.Theme.FaviconUrl)
	}
}
