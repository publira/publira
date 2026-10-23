package adminapi

import (
	"context"
	"reflect"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A tenant with no config row is compared against tenantConfigColumnDefaults
// to tell whether a save changes anything, so that row has to be the one the
// schema would store for it.
func TestDBTenantConfigColumnDefaults(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TCDTNNT1", "config-defaults.example.com", "Config Defaults", "TCDUSER1", "admin@config-defaults.example.com")

	if _, err := env.PG.DB.ExecContext(context.Background(),
		"INSERT INTO tenant_config (tenant_id) VALUES ($1)", tenant.Tenant.ID,
	); err != nil {
		t.Fatalf("insert a bare tenant_config row: %v", err)
	}
	stored, err := dbmodels.New(env.PG.DB).GetTenantConfigByTenantID(context.Background(), tenant.Tenant.ID)
	if err != nil {
		t.Fatalf("GetTenantConfigByTenantID: %v", err)
	}
	want := tenantConfigColumnDefaults(tenant.Tenant.ID)
	want.CreatedAt = stored.CreatedAt
	want.UpdatedAt = stored.UpdatedAt
	if !reflect.DeepEqual(stored, want) {
		t.Fatalf("bare tenant_config row = %+v, want %+v", stored, want)
	}
}

// tenantSettingAuditCount counts the entries recording action on the tenant,
// made by its admin and naming the setting the save changed.
func tenantSettingAuditCount(t *testing.T, env *adminDBEnv, tenant adminDBTenant, action, targetType string) int {
	t.Helper()
	return tenantSettingAuditCountOn(t, env, tenant, action, targetType, tenant.Tenant.PublicID)
}

// tenantSettingAuditCountOn is tenantSettingAuditCount for a setting kept once
// per targetID.
func tenantSettingAuditCountOn(t *testing.T, env *adminDBEnv, tenant adminDBTenant, action, targetType, targetID string) int {
	t.Helper()
	return env.countRows(t,
		`SELECT count(*) FROM audit_logs
		WHERE tenant_id = $1 AND action = $2 AND target_type = $3 AND target_id = $4
			AND actor_user_id = $5 AND outcome = 'success'`,
		tenant.Tenant.ID, action, targetType, targetID, tenant.User.ID,
	)
}

// Every save of a tenant setting names the member of staff who made it, and a
// save that leaves every value as it was leaves no entry: each step below saves
// the same values twice and expects one entry.
func TestDBTenantSettingSavesAreAuditedOncePerChange(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TSATNNT1", "settings-audit.example.com", "Settings Audit", "TSAUSER1", "admin@settings-audit.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	settings := env.tenantSettingsClient()
	themes := env.themeClient()

	termsPageID := createDBPage(t, env, tenant, "terms", "Terms of service", true)
	privacyPageID := createDBPage(t, env, tenant, "privacy", "Privacy policy", true)

	current, err := themes.GetTenantTheme(ctx, &publiraadminv1.GetTenantThemeRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantTheme: %v", err)
	}
	theme := current.Theme
	theme.PrimaryColor = "#1f3a6d"

	steps := []struct {
		name       string
		action     string
		targetType string
		save       func() error
	}{
		{
			name: "theme", action: "tenant_theme_updated", targetType: "tenant_branding",
			save: func() error {
				_, err := themes.UpsertTenantTheme(ctx, &publiraadminv1.UpsertTenantThemeRequest{Tenant: tenant.tenantContext(), Theme: theme})
				return err
			},
		},
		{
			name: "logo deleted", action: "tenant_logo_deleted", targetType: "tenant_branding",
			save: func() error {
				_, err := themes.DeleteTenantLogo(ctx, &publiraadminv1.DeleteTenantLogoRequest{Tenant: tenant.tenantContext()})
				return err
			},
		},
		{
			name: "icon deleted", action: "tenant_icon_deleted", targetType: "tenant_branding",
			save: func() error {
				_, err := themes.DeleteTenantIcon(ctx, &publiraadminv1.DeleteTenantIconRequest{Tenant: tenant.tenantContext()})
				return err
			},
		},
		{
			name: "time zone", action: "tenant_timezone_updated", targetType: "tenant_timezone",
			save: func() error {
				_, err := settings.UpdateTenantTimezone(ctx, &publiraadminv1.UpdateTenantTimezoneRequest{Tenant: tenant.tenantContext(), Timezone: "Europe/Berlin"})
				return err
			},
		},
		{
			name: "default language", action: "tenant_default_locale_updated", targetType: "tenant_default_locale",
			save: func() error {
				_, err := settings.UpdateTenantDefaultLocale(ctx, &publiraadminv1.UpdateTenantDefaultLocaleRequest{Tenant: tenant.tenantContext(), DefaultLocale: "ko", SupportedLocales: []string{"ja", "ko"}})
				return err
			},
		},
		{
			name: "reader comments", action: "tenant_comment_settings_updated", targetType: "tenant_comment_settings",
			save: func() error {
				_, err := settings.UpdateTenantCommentSettings(ctx, &publiraadminv1.UpdateTenantCommentSettingsRequest{
					Tenant:                  tenant.tenantContext(),
					CommentMode:             publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE,
					AutoHideReportThreshold: 5,
				})
				return err
			},
		},
		{
			name: "age verification", action: "tenant_age_verification_updated", targetType: "tenant_age_verification",
			save: func() error {
				_, err := settings.UpdateTenantAgeVerification(ctx, &publiraadminv1.UpdateTenantAgeVerificationRequest{
					Tenant:          tenant.tenantContext(),
					AgeVerification: publirattypesv1.AgeVerification_AGE_VERIFICATION_R18,
				})
				return err
			},
		},
		{
			name: "reader icons", action: "tenant_reader_icon_policy_updated", targetType: "tenant_reader_icon_policy",
			save: func() error {
				_, err := settings.UpdateTenantReaderIconPolicy(ctx, &publiraadminv1.UpdateTenantReaderIconPolicyRequest{
					Tenant: tenant.tenantContext(),
					Policy: publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_PRESET,
				})
				return err
			},
		},
		{
			name: "terms and privacy policy", action: "tenant_legal_pages_updated", targetType: "tenant_legal_pages",
			save: func() error {
				_, err := updateDBTenantLegalPages(env, tenant, termsPageID, privacyPageID)
				return err
			},
		},
		{
			name: "where episodes are sold", action: "tenant_purchase_settings_updated", targetType: "tenant_purchase_settings",
			save: func() error {
				_, err := settings.UpdateTenantPurchaseSettings(ctx, &publiraadminv1.UpdateTenantPurchaseSettingsRequest{
					Tenant: tenant.tenantContext(),
					Settings: &publiraadminv1.TenantPurchaseSettings{
						PurchaseAvailability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB,
						AppStoreUrl:          "https://apps.apple.com/app/id000000000",
					},
				})
				return err
			},
		},
		{
			name: "app links", action: "tenant_mobile_app_association_updated", targetType: "tenant_mobile_app_association",
			save: func() error {
				_, err := updateDBTenantMobileAppAssociation(env, tenant, &publiraadminv1.TenantMobileAppAssociation{
					Ios: &publiraadminv1.TenantIosAppAssociation{TeamId: "ABCDE12345", BundleIdentifier: "com.example.Reader"},
				})
				return err
			},
		},
		{
			name: "Google tag", action: "tenant_analytics_settings_updated", targetType: "tenant_analytics_settings",
			save: func() error {
				_, err := updateDBTenantAnalyticsSettings(env, tenant, &publiraadminv1.TenantAnalyticsSettings{
					GtmContainerId: "GTM-ABC1234",
					ServingMode:    publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_GATEWAY,
				}, false)
				return err
			},
		},
		{
			name: "site verification", action: "tenant_site_verification_updated", targetType: "tenant_site_verification",
			save: func() error {
				_, err := updateDBTenantSiteVerification(env, tenant, &publiraadminv1.TenantSiteVerification{
					GoogleSiteVerification: "AbC-123_xyzGoogleCode",
				})
				return err
			},
		},
	}

	// The logo and the icon start out empty, so deleting them changes nothing
	// until they have been uploaded.
	for _, step := range steps[1:3] {
		if err := step.save(); err != nil {
			t.Fatalf("%s before an upload: %v", step.name, err)
		}
		if got := tenantSettingAuditCount(t, env, tenant, step.action, step.targetType); got != 0 {
			t.Fatalf("%s before an upload: audit entries = %d, want 0", step.name, got)
		}
	}
	if _, err := themes.UploadTenantLogo(ctx, &publiraadminv1.UploadTenantLogoRequest{
		Tenant: tenant.tenantContext(), LogoData: brandingSourcePNG(t, 400, 100), LogoContentType: "image/png",
	}); err != nil {
		t.Fatalf("UploadTenantLogo: %v", err)
	}
	if _, err := themes.UploadTenantIcon(ctx, &publiraadminv1.UploadTenantIconRequest{
		Tenant: tenant.tenantContext(), IconData: brandingSourcePNG(t, 128, 128), IconContentType: "image/png",
	}); err != nil {
		t.Fatalf("UploadTenantIcon: %v", err)
	}
	for _, action := range []string{"tenant_logo_uploaded", "tenant_icon_uploaded"} {
		if got := tenantSettingAuditCount(t, env, tenant, action, "tenant_branding"); got != 1 {
			t.Fatalf("%s: audit entries = %d, want 1", action, got)
		}
	}

	for _, step := range steps {
		for range 2 {
			if err := step.save(); err != nil {
				t.Fatalf("save %s: %v", step.name, err)
			}
		}
		if got := tenantSettingAuditCount(t, env, tenant, step.action, step.targetType); got != 1 {
			t.Fatalf("%s saved twice: audit entries = %d, want 1", step.name, got)
		}
	}
}

// The public site's copy is saved one locale at a time, so its entry names the
// locale the save changed: a save of each locale leaves an entry of its own,
// and saving the same copy again leaves none.
func TestDBTenantSiteCopySavesAreAuditedUnderTheirLocale(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TSCTNNT1", "site-copy-audit.example.com", "Site Copy Audit", "TSCUSER1", "admin@site-copy-audit.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	client := env.authClient()

	for _, code := range []string{"ja", "en"} {
		for range 2 {
			if _, err := client.UpdateTenantConfig(ctx, &publiraadminv1.AdminAuthServiceUpdateTenantConfigRequest{
				Tenant:        tenant.tenantContext(),
				Locale:        code,
				CopyrightText: "© Site Copy Audit (" + code + ")",
			}); err != nil {
				t.Fatalf("UpdateTenantConfig(%q): %v", code, err)
			}
		}
		if got := tenantSettingAuditCountOn(t, env, tenant, "tenant_site_copy_updated", "tenant_site_copy", code); got != 1 {
			t.Fatalf("%s copy saved twice: audit entries = %d, want 1", code, got)
		}
	}
	if got := env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1", tenant.Tenant.ID); got != 2 {
		t.Fatalf("audit entries = %d, want one per locale saved", got)
	}
}

// The first save of a tenant without a config row is compared against the
// defaults the console showed, so saving those defaults is no change either.
func TestDBTenantSettingSaveOfTheDefaultsWithoutAConfigRowIsNotAudited(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TSDTNNT1", "settings-defaults.example.com", "Settings Defaults", "TSDUSER1", "admin@settings-defaults.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	if _, err := env.tenantSettingsClient().UpdateTenantAgeVerification(ctx, &publiraadminv1.UpdateTenantAgeVerificationRequest{
		Tenant:          tenant.tenantContext(),
		AgeVerification: publirattypesv1.AgeVerification_AGE_VERIFICATION_NONE,
	}); err != nil {
		t.Fatalf("UpdateTenantAgeVerification: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("audit entries = %d, want 0", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_config WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("tenant_config rows = %d, want none written for a save that changes nothing", got)
	}
}
