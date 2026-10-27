package adminapi

import (
	"context"
	"testing"

	"google.golang.org/protobuf/proto"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBTenantDarkThemeSaveReadAndDelete(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TDTTNNT1", "dark-theme.example.com", "Dark Theme", "TDTUSER1", "admin@dark-theme.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	themes := env.themeClient()

	unset, err := themes.GetTenantDarkTheme(ctx, &publiraadminv1.GetTenantDarkThemeRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantDarkTheme: %v", err)
	}
	if unset.DarkTheme != nil {
		t.Fatalf("dark_theme before a save = %+v, want none", unset.DarkTheme)
	}

	sent := testDarkThemePalette()
	sent.PrimaryColor = " #8FB0F0 "
	saved, err := themes.UpsertTenantDarkTheme(ctx, &publiraadminv1.UpsertTenantDarkThemeRequest{Tenant: tenant.tenantContext(), DarkTheme: sent})
	if err != nil {
		t.Fatalf("UpsertTenantDarkTheme: %v", err)
	}
	if want := testDarkThemePalette(); !proto.Equal(saved.DarkTheme, want) {
		t.Fatalf("saved dark_theme = %+v, want %+v", saved.DarkTheme, want)
	}

	fetched, err := themes.GetTenantDarkTheme(ctx, &publiraadminv1.GetTenantDarkThemeRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantDarkTheme: %v", err)
	}
	if !proto.Equal(fetched.DarkTheme, saved.DarkTheme) {
		t.Fatalf("read dark_theme = %+v, want the saved one %+v", fetched.DarkTheme, saved.DarkTheme)
	}

	// The light palette is a palette of its own, and a dark save leaves it as
	// it was.
	light, err := themes.GetTenantTheme(ctx, &publiraadminv1.GetTenantThemeRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantTheme: %v", err)
	}
	if light.Theme.PrimaryColor != "#2b4c8c" || light.Theme.BackgroundColor != "#f5f5f2" {
		t.Fatalf("light theme after a dark save = %s on %s, want the defaults", light.Theme.PrimaryColor, light.Theme.BackgroundColor)
	}

	for range 2 {
		if _, err := themes.DeleteTenantDarkTheme(ctx, &publiraadminv1.DeleteTenantDarkThemeRequest{Tenant: tenant.tenantContext()}); err != nil {
			t.Fatalf("DeleteTenantDarkTheme: %v", err)
		}
	}
	deleted, err := themes.GetTenantDarkTheme(ctx, &publiraadminv1.GetTenantDarkThemeRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantDarkTheme: %v", err)
	}
	if deleted.DarkTheme != nil {
		t.Fatalf("dark_theme after a delete = %+v, want none", deleted.DarkTheme)
	}
}

func TestDBTenantDarkThemeIsPerTenant(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	first := env.seedTenantWithAdmin(t, "TDTTNNTA", "dark-theme-a.example.com", "Dark Theme A", "TDTUSERA", "admin@dark-theme-a.example.com")
	second := env.seedTenantWithAdmin(t, "TDTTNNTB", "dark-theme-b.example.com", "Dark Theme B", "TDTUSERB", "admin@dark-theme-b.example.com")
	themes := env.themeClient()

	if _, err := themes.UpsertTenantDarkTheme(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.UpsertTenantDarkThemeRequest{
		Tenant:    first.tenantContext(),
		DarkTheme: testDarkThemePalette(),
	}); err != nil {
		t.Fatalf("UpsertTenantDarkTheme: %v", err)
	}

	other, err := themes.GetTenantDarkTheme(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.GetTenantDarkThemeRequest{
		Tenant: second.tenantContext(),
	})
	if err != nil {
		t.Fatalf("GetTenantDarkTheme: %v", err)
	}
	if other.DarkTheme != nil {
		t.Fatalf("second tenant dark_theme = %+v, want none", other.DarkTheme)
	}
}
