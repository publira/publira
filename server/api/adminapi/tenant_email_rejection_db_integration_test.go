package adminapi

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/emailrejection"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

func getDBEmailRejectionSettings(t *testing.T, env *adminDBEnv, tenant adminDBTenant) *publiraadminv1.GetTenantEmailRejectionSettingsResponse {
	t.Helper()
	resp, err := env.tenantSettingsClient().GetTenantEmailRejectionSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantEmailRejectionSettingsRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantEmailRejectionSettings: %v", err)
	}
	return resp.Msg
}

func updateDBEmailRejectionSettings(env *adminDBEnv, tenant adminDBTenant, settings *publiraadminv1.TenantEmailRejectionSettings) (*publiraadminv1.UpdateTenantEmailRejectionSettingsResponse, error) {
	resp, err := env.tenantSettingsClient().UpdateTenantEmailRejectionSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantEmailRejectionSettingsRequest{
		Tenant:   tenant.tenantContext(),
		Settings: settings,
	}))
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func TestDBEmailRejectionSettingsAreStoredNormalizedAndAudited(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	initial := getDBEmailRejectionSettings(t, env, tenant)
	if initial.Settings.RejectDisposableDomains || len(initial.Settings.Entries) != 0 {
		t.Fatalf("initial settings = %v, want nothing refused", initial.Settings)
	}

	saved, err := updateDBEmailRejectionSettings(env, tenant, &publiraadminv1.TenantEmailRejectionSettings{
		RejectDisposableDomains: true,
		Entries:                 []string{" John@Example.COM", "Blocked.Example", "blocked.example", ""},
	})
	if err != nil {
		t.Fatalf("UpdateTenantEmailRejectionSettings: %v", err)
	}
	want := []string{"blocked.example", "john@example.com"}
	if !saved.Settings.RejectDisposableDomains || !slices.Equal(saved.Settings.Entries, want) {
		t.Fatalf("saved = %v, want the switch on and entries %q", saved.Settings, want)
	}

	got := getDBEmailRejectionSettings(t, env, tenant)
	if !got.Settings.RejectDisposableDomains || !slices.Equal(got.Settings.Entries, want) {
		t.Fatalf("read back = %v, want the switch on and entries %q", got.Settings, want)
	}
	if audited := env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND reason = $3",
		tenant.Tenant.ID, emailrejection.ActionSettingsUpdated, "reject_disposable_domains=true, entries=2"); audited != 1 {
		t.Fatalf("audit entries = %d, want 1", audited)
	}

	// A save replaces the list rather than adding to it.
	cleared, err := updateDBEmailRejectionSettings(env, tenant, &publiraadminv1.TenantEmailRejectionSettings{
		Entries: []string{"other.example"},
	})
	if err != nil {
		t.Fatalf("UpdateTenantEmailRejectionSettings: %v", err)
	}
	if cleared.Settings.RejectDisposableDomains || !slices.Equal(cleared.Settings.Entries, []string{"other.example"}) {
		t.Fatalf("second save = %v, want the switch off and one entry", cleared.Settings)
	}
	if stored := env.countRows(t, "SELECT count(*) FROM tenant_email_rejection_entries WHERE tenant_id = $1", tenant.Tenant.ID); stored != 1 {
		t.Fatalf("stored entries = %d, want 1", stored)
	}
}

func TestDBEmailRejectionSettingsRefuseAnEntryThatIsNeitherAnAddressNorADomain(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	if _, err := updateDBEmailRejectionSettings(env, tenant, &publiraadminv1.TenantEmailRejectionSettings{
		Entries: []string{"blocked.example"},
	}); err != nil {
		t.Fatalf("UpdateTenantEmailRejectionSettings: %v", err)
	}

	_, err := updateDBEmailRejectionSettings(env, tenant, &publiraadminv1.TenantEmailRejectionSettings{
		RejectDisposableDomains: true,
		Entries:                 []string{"other.example", "not an address"},
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || violatedField(t, connectErr) != "settings.entries" {
		t.Fatalf("err = %v, want a violation on settings.entries", err)
	}
	if _, err := updateDBEmailRejectionSettings(env, tenant, nil); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("no settings: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	got := getDBEmailRejectionSettings(t, env, tenant)
	if got.Settings.RejectDisposableDomains || !slices.Equal(got.Settings.Entries, []string{"blocked.example"}) {
		t.Fatalf("settings after refused saves = %v, want the earlier save kept", got.Settings)
	}
}

func violatedField(t *testing.T, err *connect.Error) string {
	t.Helper()
	for _, detail := range err.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}
		if badRequest, ok := value.(*errdetails.BadRequest); ok && len(badRequest.FieldViolations) == 1 {
			return badRequest.FieldViolations[0].Field
		}
	}
	return ""
}

// The console says whether the switch refuses anything, which it does only
// while the platform policy names a list.
func TestDBEmailRejectionSettingsAnswerWhetherTheListIsAvailable(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	if getDBEmailRejectionSettings(t, env, tenant).DisposableDomainListAvailable {
		t.Fatal("a platform with no policy saved answered a list")
	}

	policy := platformpolicy.Defaults()
	policy.DisposableEmailDomainsURL = "https://lists.example.com/disposable.txt"
	env.PG.SavePlatformPolicy(t, policy)
	if !getDBEmailRejectionSettings(t, env, tenant).DisposableDomainListAvailable {
		t.Fatal("a platform whose policy names a list answered none")
	}
	saved, err := updateDBEmailRejectionSettings(env, tenant, &publiraadminv1.TenantEmailRejectionSettings{RejectDisposableDomains: true})
	if err != nil {
		t.Fatalf("UpdateTenantEmailRejectionSettings: %v", err)
	}
	if !saved.DisposableDomainListAvailable {
		t.Fatal("the update answered no list")
	}
}

func TestDBEmailRejectionSettingsRequireTenantAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor)

	if _, err := env.tenantSettingsClient().GetTenantEmailRejectionSettings(context.Background(), newAdminDBRequest(tenant.as(editor), &publiraadminv1.GetTenantEmailRejectionSettingsRequest{
		Tenant: tenant.tenantContext(),
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("get: code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := updateDBEmailRejectionSettings(env, tenant.as(editor), &publiraadminv1.TenantEmailRejectionSettings{
		Entries: []string{"blocked.example"},
	}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("update: code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	if stored := env.countRows(t, "SELECT count(*) FROM tenant_email_rejection_entries WHERE tenant_id = $1", tenant.Tenant.ID); stored != 0 {
		t.Fatalf("stored entries = %d, want 0", stored)
	}
}
