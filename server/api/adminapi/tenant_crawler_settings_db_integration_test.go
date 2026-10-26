package adminapi

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/crawlersettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func getDBCrawlerSettings(env *adminDBEnv, tenant adminDBTenant) (*publiraadminv1.GetTenantCrawlerSettingsResponse, error) {
	return env.tenantSettingsClient().GetTenantCrawlerSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetTenantCrawlerSettingsRequest{
		Tenant: tenant.tenantContext(),
	})
}

func updateDBCrawlerSettings(env *adminDBEnv, tenant adminDBTenant, settings *publiraadminv1.TenantCrawlerSettings) (*publiraadminv1.UpdateTenantCrawlerSettingsResponse, error) {
	return env.tenantSettingsClient().UpdateTenantCrawlerSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateTenantCrawlerSettingsRequest{
		Tenant:   tenant.tenantContext(),
		Settings: settings,
	})
}

func TestDBCrawlerSettingsAreStoredNormalizedAndAudited(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	initial, err := getDBCrawlerSettings(env, tenant)
	if err != nil {
		t.Fatalf("GetTenantCrawlerSettings: %v", err)
	}
	if len(initial.Settings.ExcludedUserAgents) != 0 || len(initial.Settings.ExcludedPaths) != 0 {
		t.Fatalf("initial settings = %v, want nothing excluded", initial.Settings)
	}
	if len(initial.KnownCrawlers) != len(crawlersettings.Known()) {
		t.Fatalf("known crawlers = %d, want %d", len(initial.KnownCrawlers), len(crawlersettings.Known()))
	}
	for _, crawler := range initial.KnownCrawlers {
		if crawler.UserAgent == "" || crawler.Operator == "" || crawler.Purpose == publiraadminv1.CrawlerPurpose_CRAWLER_PURPOSE_UNSPECIFIED {
			t.Fatalf("known crawler = %v, want a token, an operator, and a purpose", crawler)
		}
	}

	saved, err := updateDBCrawlerSettings(env, tenant, &publiraadminv1.TenantCrawlerSettings{
		ExcludedUserAgents: []string{"Googlebot-Image", "GPTBot", "GPTBot"},
		ExcludedPaths:      []string{" /drafts/ ", "/campaigns/preview", "/drafts"},
	})
	if err != nil {
		t.Fatalf("UpdateTenantCrawlerSettings: %v", err)
	}
	wantUserAgents := []string{"GPTBot", "Googlebot-Image"}
	wantPaths := []string{"/campaigns/preview", "/drafts"}
	if !slices.Equal(saved.Settings.ExcludedUserAgents, wantUserAgents) || !slices.Equal(saved.Settings.ExcludedPaths, wantPaths) {
		t.Fatalf("saved = %v, want user agents %q and paths %q", saved.Settings, wantUserAgents, wantPaths)
	}

	got, err := getDBCrawlerSettings(env, tenant)
	if err != nil {
		t.Fatalf("GetTenantCrawlerSettings: %v", err)
	}
	if !slices.Equal(got.Settings.ExcludedUserAgents, wantUserAgents) || !slices.Equal(got.Settings.ExcludedPaths, wantPaths) {
		t.Fatalf("read back = %v, want user agents %q and paths %q", got.Settings, wantUserAgents, wantPaths)
	}
	auditQuery := "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND target_type = $3"
	if audited := env.countRows(t, auditQuery, tenant.Tenant.ID, crawlersettings.ActionSettingsUpdated, crawlersettings.AuditTargetType); audited != 1 {
		t.Fatalf("audit entries = %d, want 1", audited)
	}

	// The same settings again change nothing, so nothing is audited.
	if _, err := updateDBCrawlerSettings(env, tenant, &publiraadminv1.TenantCrawlerSettings{
		ExcludedUserAgents: []string{"GPTBot", "Googlebot-Image"},
		ExcludedPaths:      []string{"/drafts", "/campaigns/preview"},
	}); err != nil {
		t.Fatalf("UpdateTenantCrawlerSettings: %v", err)
	}
	if audited := env.countRows(t, auditQuery, tenant.Tenant.ID, crawlersettings.ActionSettingsUpdated, crawlersettings.AuditTargetType); audited != 1 {
		t.Fatalf("audit entries after an unchanged save = %d, want 1", audited)
	}

	// A save replaces both lists rather than adding to them.
	cleared, err := updateDBCrawlerSettings(env, tenant, &publiraadminv1.TenantCrawlerSettings{
		ExcludedPaths: []string{"/drafts"},
	})
	if err != nil {
		t.Fatalf("UpdateTenantCrawlerSettings: %v", err)
	}
	if len(cleared.Settings.ExcludedUserAgents) != 0 || !slices.Equal(cleared.Settings.ExcludedPaths, []string{"/drafts"}) {
		t.Fatalf("second save = %v, want no user agent and one path", cleared.Settings)
	}
	if audited := env.countRows(t, auditQuery, tenant.Tenant.ID, crawlersettings.ActionSettingsUpdated, crawlersettings.AuditTargetType); audited != 2 {
		t.Fatalf("audit entries = %d, want 2", audited)
	}
}

func TestDBCrawlerSettingsRefuseAnInvalidEntry(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	if _, err := updateDBCrawlerSettings(env, tenant, &publiraadminv1.TenantCrawlerSettings{
		ExcludedUserAgents: []string{"GPTBot"},
		ExcludedPaths:      []string{"/drafts"},
	}); err != nil {
		t.Fatalf("UpdateTenantCrawlerSettings: %v", err)
	}

	for _, tc := range []struct {
		name     string
		settings *publiraadminv1.TenantCrawlerSettings
		field    string
	}{
		{"unknown user agent", &publiraadminv1.TenantCrawlerSettings{ExcludedUserAgents: []string{"ClaudeBot", "Googlebot"}}, "settings.excluded_user_agents[1]"},
		{"no leading slash", &publiraadminv1.TenantCrawlerSettings{ExcludedPaths: []string{"drafts"}}, "settings.excluded_paths[0]"},
		{"whitespace", &publiraadminv1.TenantCrawlerSettings{ExcludedPaths: []string{"/my drafts"}}, "settings.excluded_paths[0]"},
		{"robots.txt", &publiraadminv1.TenantCrawlerSettings{ExcludedPaths: []string{"/drafts", "/robots.txt"}}, "settings.excluded_paths[1]"},
		{"sitemap index", &publiraadminv1.TenantCrawlerSettings{ExcludedPaths: []string{"/sitemap.xml"}}, "settings.excluded_paths[0]"},
		{"sitemap directory", &publiraadminv1.TenantCrawlerSettings{ExcludedPaths: []string{"/sitemap/"}}, "settings.excluded_paths[0]"},
	} {
		_, err := updateDBCrawlerSettings(env, tenant, tc.settings)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: code = %v, want invalid_argument (err=%v)", tc.name, connect.CodeOf(err), err)
		}
		var connectErr *connect.Error
		if !errors.As(err, &connectErr) || violatedField(t, connectErr) != tc.field {
			t.Fatalf("%s: err = %v, want a violation on %s", tc.name, err, tc.field)
		}
	}
	if _, err := updateDBCrawlerSettings(env, tenant, nil); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("no settings: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	got, err := getDBCrawlerSettings(env, tenant)
	if err != nil {
		t.Fatalf("GetTenantCrawlerSettings: %v", err)
	}
	if !slices.Equal(got.Settings.ExcludedUserAgents, []string{"GPTBot"}) || !slices.Equal(got.Settings.ExcludedPaths, []string{"/drafts"}) {
		t.Fatalf("settings after refused saves = %v, want the earlier save kept", got.Settings)
	}
}

// Every member of staff may see the setting, as the console's read-only form
// shows it, and only a tenant admin may change it.
func TestDBCrawlerSettingsAreWrittenByATenantAdminAlone(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor)
	auditor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER03", "auditor@tenant-a.example.com", "Tenant A Auditor", auth.RoleTenantAuditor)

	for _, member := range []adminDBTenant{tenant.as(editor), tenant.as(auditor)} {
		if _, err := getDBCrawlerSettings(env, member); err != nil {
			t.Fatalf("get as %s: %v", member.User.Email, err)
		}
		if _, err := updateDBCrawlerSettings(env, member, &publiraadminv1.TenantCrawlerSettings{
			ExcludedUserAgents: []string{"GPTBot"},
		}); connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("update as %s: code = %v, want permission_denied (err=%v)", member.User.Email, connect.CodeOf(err), err)
		}
	}
	if stored := env.countRows(t, "SELECT count(*) FROM tenant_crawler_settings WHERE tenant_id = $1", tenant.Tenant.ID); stored != 0 {
		t.Fatalf("stored settings = %d, want 0", stored)
	}
}
