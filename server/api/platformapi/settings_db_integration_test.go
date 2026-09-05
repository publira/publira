package platformapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/internal/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/tenanttz"
	"github.com/publira/publira/server/internal/testutil"
)

// tenantTimezoneByPublicID reads tenants.timezone on the superuser connection,
// so assertions see the stored value rather than what the API resolves.
func tenantTimezoneByPublicID(t *testing.T, pg *testutil.PostgresEnv, publicID string) string {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var timezone string
	if err := pg.DB.QueryRowContext(ctx, `SELECT timezone FROM tenants WHERE public_id = $1`, publicID).Scan(&timezone); err != nil {
		t.Fatalf("select tenants.timezone for %s: %v", publicID, err)
	}
	return timezone
}

func tenantDefaultLocaleByPublicID(t *testing.T, pg *testutil.PostgresEnv, publicID string) string {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var locale string
	if err := pg.DB.QueryRowContext(ctx, `SELECT default_locale FROM tenants WHERE public_id = $1`, publicID).Scan(&locale); err != nil {
		t.Fatalf("select tenants.default_locale for %s: %v", publicID, err)
	}
	return locale
}

// A database that has only had the migration applied carries no settings row.
// Real bootstrap writes one with the first operator, so this state has no saved
// language to report and the read says so rather than naming one.
func TestDBGetPlatformSettingsFailsWithoutASettingsRow(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)

	_, err := client.GetPlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetPlatformSettingsRequest{}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetPlatformSettings code = %v, want internal (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBUpdatePlatformSettingsPersistsAndAudits(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)

	updateResp, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "America/Los_Angeles",
		DefaultLocale:   "ja",
	}))
	if err != nil {
		t.Fatalf("UpdatePlatformSettings: %v", err)
	}
	if updateResp.Msg.Settings.DefaultTimezone != "America/Los_Angeles" {
		t.Fatalf("default_timezone = %q, want America/Los_Angeles", updateResp.Msg.Settings.DefaultTimezone)
	}

	getResp, err := client.GetPlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetPlatformSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if getResp.Msg.Settings.DefaultTimezone != "America/Los_Angeles" {
		t.Fatalf("default_timezone after update = %q, want America/Los_Angeles", getResp.Msg.Settings.DefaultTimezone)
	}
	if getResp.Msg.Settings.DefaultLocale != "ja" {
		t.Fatalf("default_locale after update = %q, want ja", getResp.Msg.Settings.DefaultLocale)
	}

	// A second update goes through the same singleton row instead of adding one.
	if _, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "Europe/Berlin",
		DefaultLocale:   "ja",
	})); err != nil {
		t.Fatalf("UpdatePlatformSettings (second): %v", err)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_config`); got != 1 {
		t.Fatalf("platform_config rows = %d, want 1", got)
	}

	if got := countRows(
		t,
		pg,
		`SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_settings_updated' AND target_type = 'platform_config' AND outcome = 'success'`,
	); got != 2 {
		t.Fatalf("platform_settings_updated audit entries = %d, want 2", got)
	}
}

func TestDBUpdatePlatformSettingsRejectsInvalidTimezone(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)

	if _, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "America/Los_Angeles",
		DefaultLocale:   "ja",
	})); err != nil {
		t.Fatalf("UpdatePlatformSettings: %v", err)
	}

	for _, timezone := range []string{"Mars/Olympus_Mons", "", "   ", "Local", "+09:00"} {
		_, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
			DefaultTimezone: timezone,
			DefaultLocale:   "ja",
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("UpdatePlatformSettings(%q) code = %v, want invalid_argument", timezone, connect.CodeOf(err))
		}
	}

	// The rejected updates must leave the configured value untouched.
	resp, err := client.GetPlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetPlatformSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultTimezone != "America/Los_Angeles" {
		t.Fatalf("default_timezone = %q, want America/Los_Angeles", resp.Msg.Settings.DefaultTimezone)
	}
	if resp.Msg.Settings.DefaultLocale != "ja" {
		t.Fatalf("default_locale = %q, want ja", resp.Msg.Settings.DefaultLocale)
	}
}

func TestDBUpdatePlatformSettingsRequiresAuthentication(t *testing.T) {
	ts, _ := newDBIntegrationEnv(t)
	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)

	_, err := client.UpdatePlatformSettings(context.Background(), connect.NewRequest(&publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "America/Los_Angeles",
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("UpdatePlatformSettings code = %v, want unauthenticated", connect.CodeOf(err))
	}

	_, err = client.GetPlatformSettings(context.Background(), connect.NewRequest(&publirasplatformv1.GetPlatformSettingsRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetPlatformSettings code = %v, want unauthenticated", connect.CodeOf(err))
	}
}

// The platform default decides a tenant's time zone at creation time, and later
// changes to it must not reach tenants that already exist.
func TestDBCreateTenantAppliesPlatformDefaultTimezone(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	settings := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	beforeResp, err := tenants.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "ja",
		Name:          "Before Tenant",
		Domain:        "before.example.com",
	}))
	if err != nil {
		t.Fatalf("CreateTenant (before): %v", err)
	}
	if beforeResp.Msg.Tenant.Timezone != tenanttz.Default {
		t.Fatalf("tenant.timezone = %q, want %s", beforeResp.Msg.Tenant.Timezone, tenanttz.Default)
	}

	if _, err := settings.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "America/Los_Angeles",
		DefaultLocale:   "ja",
	})); err != nil {
		t.Fatalf("UpdatePlatformSettings: %v", err)
	}

	afterResp, err := tenants.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "ja",
		Name:          "After Tenant",
		Domain:        "after.example.com",
	}))
	if err != nil {
		t.Fatalf("CreateTenant (after): %v", err)
	}
	if afterResp.Msg.Tenant.Timezone != "America/Los_Angeles" {
		t.Fatalf("tenant.timezone = %q, want America/Los_Angeles", afterResp.Msg.Tenant.Timezone)
	}
	// The value is written to the tenant row, not just resolved on read.
	if got := tenantTimezoneByPublicID(t, pg, afterResp.Msg.Tenant.PublicId); got != "America/Los_Angeles" {
		t.Fatalf("stored tenants.timezone = %q, want America/Los_Angeles", got)
	}

	if got := tenantTimezoneByPublicID(t, pg, beforeResp.Msg.Tenant.PublicId); got != tenanttz.Default {
		t.Fatalf("stored tenants.timezone of the existing tenant = %q, want %s", got, tenanttz.Default)
	}
	getBefore, err := tenants.GetTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetTenantRequest{
		PublicId: beforeResp.Msg.Tenant.PublicId,
	}))
	if err != nil {
		t.Fatalf("GetTenant (before): %v", err)
	}
	if getBefore.Msg.Tenant.Timezone != tenanttz.Default {
		t.Fatalf("existing tenant.timezone = %q, want %s", getBefore.Msg.Tenant.Timezone, tenanttz.Default)
	}
}

func TestDBUpdatePlatformSettingsPersistsLocale(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)

	updateResp, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: tenanttz.Default,
		DefaultLocale:   "en",
	}))
	if err != nil {
		t.Fatalf("UpdatePlatformSettings: %v", err)
	}
	if updateResp.Msg.Settings.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", updateResp.Msg.Settings.DefaultLocale)
	}
	if updateResp.Msg.Settings.DefaultTimezone != tenanttz.Default {
		t.Fatalf("default_timezone = %q, want %s", updateResp.Msg.Settings.DefaultTimezone, tenanttz.Default)
	}

	getResp, err := client.GetPlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetPlatformSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if getResp.Msg.Settings.DefaultLocale != "en" {
		t.Fatalf("default_locale after update = %q, want en", getResp.Msg.Settings.DefaultLocale)
	}
}

func TestDBUpdatePlatformSettingsRejectsInvalidLocale(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)

	if _, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: "America/Los_Angeles",
		DefaultLocale:   "en",
	})); err != nil {
		t.Fatalf("UpdatePlatformSettings: %v", err)
	}

	for _, defaultLocale := range []string{"fr", "EN", "en-US", "", "   "} {
		_, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
			DefaultTimezone: "Europe/Berlin",
			DefaultLocale:   defaultLocale,
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("UpdatePlatformSettings(%q) code = %v, want invalid_argument", defaultLocale, connect.CodeOf(err))
		}
	}

	resp, err := client.GetPlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetPlatformSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultTimezone != "America/Los_Angeles" {
		t.Fatalf("default_timezone = %q, want America/Los_Angeles", resp.Msg.Settings.DefaultTimezone)
	}
	if resp.Msg.Settings.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.Settings.DefaultLocale)
	}
}

// The locale a tenant is created with is the one the request names. The
// platform default is deliberately the other supported code here, so a tenant
// that inherited it instead of reading the request would fail this.
func TestDBCreateTenantStoresRequestedLocale(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	settings := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	if _, err := settings.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: tenanttz.Default,
		DefaultLocale:   "ja",
	})); err != nil {
		t.Fatalf("UpdatePlatformSettings: %v", err)
	}

	englishResp, err := tenants.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "en",
		Name:          "English Tenant",
		Domain:        "en-locale.example.com",
	}))
	if err != nil {
		t.Fatalf("CreateTenant (en): %v", err)
	}
	if got := tenantDefaultLocaleByPublicID(t, pg, englishResp.Msg.Tenant.PublicId); got != "en" {
		t.Fatalf("stored tenants.default_locale = %q, want en", got)
	}

	japaneseResp, err := tenants.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
		DefaultLocale: "ja",
		Name:          "Japanese Tenant",
		Domain:        "ja-locale.example.com",
	}))
	if err != nil {
		t.Fatalf("CreateTenant (ja): %v", err)
	}
	if got := tenantDefaultLocaleByPublicID(t, pg, japaneseResp.Msg.Tenant.PublicId); got != "ja" {
		t.Fatalf("stored tenants.default_locale = %q, want ja", got)
	}
	if got := tenantDefaultLocaleByPublicID(t, pg, englishResp.Msg.Tenant.PublicId); got != "en" {
		t.Fatalf("stored tenants.default_locale of the existing tenant = %q, want en", got)
	}
}

// No locale in the request means no tenant: the column has no default left to
// land on. An unsupported code is rejected by the handler's allow-list, which
// is the generated locale.Supported rather than a constraint in the schema.
func TestDBCreateTenantRejectsMissingLocale(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	for _, defaultLocale := range []string{"", "   ", "fr", "EN", "en-US"} {
		_, err := tenants.CreateTenant(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantRequest{
			DefaultLocale: defaultLocale,
			Name:          "Rejected Tenant",
			Domain:        "rejected.example.com",
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("CreateTenant(%q) code = %v, want invalid_argument", defaultLocale, connect.CodeOf(err))
		}
	}

	if got := countRows(t, pg, `SELECT COUNT(*) FROM tenants`); got != 0 {
		t.Fatalf("tenants rows = %d, want 0", got)
	}
}
