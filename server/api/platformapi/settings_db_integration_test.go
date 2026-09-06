package platformapi

import (
	"context"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
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

// seedPlatformSettings saves the settings row a test starts from and returns the
// revision the next save has to state. A migrated database carries no row, so
// the first save is the one that states revision zero.
func seedPlatformSettings(
	t *testing.T,
	client publirasplatformv1connect.PlatformSettingsServiceClient,
	operator testutil.PlatformOperator,
	defaultTimezone, defaultLocale string,
) int64 {
	t.Helper()

	resp, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone: defaultTimezone,
		DefaultLocale:   defaultLocale,
	}))
	if err != nil {
		t.Fatalf("UpdatePlatformSettings (seed): %v", err)
	}
	return resp.Msg.Settings.Revision
}

// platformConfigRevision reads platform_config.revision on the superuser
// connection, so assertions see what the row actually carries.
func platformConfigRevision(t *testing.T, pg *testutil.PostgresEnv) int64 {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var revision int64
	if err := pg.DB.QueryRowContext(ctx, `SELECT revision FROM platform_config WHERE singleton = TRUE`).Scan(&revision); err != nil {
		t.Fatalf("select platform_config.revision: %v", err)
	}
	return revision
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

	// No settings row yet, so the first save states revision zero and creates one.
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
	if updateResp.Msg.Settings.Revision != 1 {
		t.Fatalf("revision of the created row = %d, want 1", updateResp.Msg.Settings.Revision)
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
	secondResp, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "Europe/Berlin",
		DefaultLocale:    "ja",
		ExpectedRevision: getResp.Msg.Settings.Revision,
	}))
	if err != nil {
		t.Fatalf("UpdatePlatformSettings (second): %v", err)
	}
	if secondResp.Msg.Settings.Revision != 2 {
		t.Fatalf("revision after the second save = %d, want 2", secondResp.Msg.Settings.Revision)
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

	revision := seedPlatformSettings(t, client, operator, "America/Los_Angeles", "ja")

	for _, timezone := range []string{"Mars/Olympus_Mons", "", "   ", "Local", "+09:00"} {
		_, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
			DefaultTimezone:  timezone,
			DefaultLocale:    "ja",
			ExpectedRevision: revision,
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

	seedPlatformSettings(t, settings, operator, "America/Los_Angeles", "ja")

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

	revision := seedPlatformSettings(t, client, operator, "America/Los_Angeles", "en")

	for _, defaultLocale := range []string{"fr", "EN", "en-US", "", "   "} {
		_, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
			DefaultTimezone:  "Europe/Berlin",
			DefaultLocale:    defaultLocale,
			ExpectedRevision: revision,
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

	seedPlatformSettings(t, settings, operator, tenanttz.Default, "ja")

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

// The window this closes: a language save and a time zone save both read the
// row, and whichever writes second would otherwise post its stale copy of the
// other field back over the first save.
func TestDBUpdatePlatformSettingsRejectsAStaleRevision(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)

	// Both sessions read this revision.
	stale := seedPlatformSettings(t, client, operator, "Asia/Tokyo", "ja")

	// The language session saves first and moves the row on.
	if _, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "Asia/Tokyo",
		DefaultLocale:    "en",
		ExpectedRevision: stale,
	})); err != nil {
		t.Fatalf("UpdatePlatformSettings (locale): %v", err)
	}

	// The time zone session now saves the zone it chose along with the language
	// it read before the save above.
	_, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
		DefaultTimezone:  "Europe/Berlin",
		DefaultLocale:    "ja",
		ExpectedRevision: stale,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdatePlatformSettings (timezone) code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	// Neither field moved: not the language the first save wrote, and not the
	// zone the refused save wanted.
	resp, err := client.GetPlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetPlatformSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.Settings.DefaultLocale)
	}
	if resp.Msg.Settings.DefaultTimezone != "Asia/Tokyo" {
		t.Fatalf("default_timezone = %q, want Asia/Tokyo", resp.Msg.Settings.DefaultTimezone)
	}
	if got := platformConfigRevision(t, pg); got != stale+1 {
		t.Fatalf("platform_config.revision = %d, want %d", got, stale+1)
	}
}

// Two saves from the same revision at the same time. The lock serializes them,
// so exactly one applies and the other is told the row moved.
func TestDBUpdatePlatformSettingsConcurrentSavesOneWins(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)

	shared := seedPlatformSettings(t, client, operator, "Asia/Tokyo", "ja")

	type outcome struct {
		settings *publirasplatformv1.PlatformSettings
		err      error
	}
	// One session saves a zone, the other a language, both from `shared`.
	candidates := []struct {
		timezone      string
		defaultLocale string
	}{
		{timezone: "Europe/Berlin", defaultLocale: "ja"},
		{timezone: "Asia/Tokyo", defaultLocale: "en"},
	}
	outcomes := make(chan outcome, len(candidates))
	var wg sync.WaitGroup
	for _, candidate := range candidates {
		wg.Add(1)
		go func(timezone, defaultLocale string) {
			defer wg.Done()
			resp, err := client.UpdatePlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformSettingsRequest{
				DefaultTimezone:  timezone,
				DefaultLocale:    defaultLocale,
				ExpectedRevision: shared,
			}))
			if err != nil {
				outcomes <- outcome{err: err}
				return
			}
			outcomes <- outcome{settings: resp.Msg.Settings}
		}(candidate.timezone, candidate.defaultLocale)
	}
	wg.Wait()
	close(outcomes)

	var winner *publirasplatformv1.PlatformSettings
	failures := 0
	for result := range outcomes {
		if result.err == nil {
			if winner != nil {
				t.Fatal("both saves succeeded, want exactly one to apply")
			}
			winner = result.settings
			continue
		}
		if connect.CodeOf(result.err) != connect.CodeFailedPrecondition {
			t.Fatalf("losing UpdatePlatformSettings code = %v, want failed_precondition (err=%v)", connect.CodeOf(result.err), result.err)
		}
		failures++
	}
	if winner == nil {
		t.Fatal("both saves failed, want exactly one to apply")
	}
	if failures != 1 {
		t.Fatalf("failed_precondition count = %d, want 1", failures)
	}

	// The stored row is the winner's, whole: the loser wrote neither of its two
	// fields.
	resp, err := client.GetPlatformSettings(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetPlatformSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultTimezone != winner.DefaultTimezone {
		t.Fatalf("default_timezone = %q, want %q", resp.Msg.Settings.DefaultTimezone, winner.DefaultTimezone)
	}
	if resp.Msg.Settings.DefaultLocale != winner.DefaultLocale {
		t.Fatalf("default_locale = %q, want %q", resp.Msg.Settings.DefaultLocale, winner.DefaultLocale)
	}
	if got := platformConfigRevision(t, pg); got != shared+1 {
		t.Fatalf("platform_config.revision = %d, want %d", got, shared+1)
	}
}
