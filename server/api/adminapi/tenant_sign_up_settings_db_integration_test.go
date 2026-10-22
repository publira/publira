package adminapi

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/signupsettings"
	"github.com/publira/publira/server/internal/testutil"
)

func getDBSignUpSettings(env *adminDBEnv, tenant adminDBTenant) (*publiraadminv1.GetTenantSignUpSettingsResponse, error) {
	return env.tenantSettingsClient().GetTenantSignUpSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetTenantSignUpSettingsRequest{
		Tenant: tenant.tenantContext(),
	})
}

func updateDBSignUpSettings(env *adminDBEnv, tenant adminDBTenant, settings *publiraadminv1.TenantSignUpSettings) (*publiraadminv1.UpdateTenantSignUpSettingsResponse, error) {
	return env.tenantSettingsClient().UpdateTenantSignUpSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateTenantSignUpSettingsRequest{
		Tenant:   tenant.tenantContext(),
		Settings: settings,
	})
}

func TestDBSignUpSettingsAreStoredTrimmedAuditedAndRevalidated(t *testing.T) {
	env := newReaderIconDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	initial, err := getDBSignUpSettings(env, tenant)
	if err != nil {
		t.Fatalf("GetTenantSignUpSettings: %v", err)
	}
	if !initial.Settings.SignUpOpen || initial.Settings.ClosedMessage != "" {
		t.Fatalf("initial settings = %v, want sign-up open with no message", initial.Settings)
	}

	saved, err := updateDBSignUpSettings(env, tenant, &publiraadminv1.TenantSignUpSettings{
		SignUpOpen:    false,
		ClosedMessage: "  Sign-up reopens at launch.\n",
	})
	if err != nil {
		t.Fatalf("UpdateTenantSignUpSettings: %v", err)
	}
	want := "Sign-up reopens at launch."
	if saved.Settings.SignUpOpen || saved.Settings.ClosedMessage != want {
		t.Fatalf("saved = %v, want sign-up closed with %q", saved.Settings, want)
	}
	got, err := getDBSignUpSettings(env, tenant)
	if err != nil {
		t.Fatalf("GetTenantSignUpSettings: %v", err)
	}
	if got.Settings.SignUpOpen || got.Settings.ClosedMessage != want {
		t.Fatalf("read back = %v, want sign-up closed with %q", got.Settings, want)
	}

	auditQuery := "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND target_type = $3 AND target_id = $4"
	audited := func() int {
		return env.countRows(t, auditQuery, tenant.Tenant.ID, signupsettings.ActionSettingsUpdated, signupsettings.AuditTargetType, tenant.Tenant.PublicID)
	}
	if n := audited(); n != 1 {
		t.Fatalf("audit entries = %d, want 1", n)
	}
	siteTag := fmt.Sprintf("tenant:%s:site", tenant.Tenant.ID)
	revalidations := func() int {
		count := 0
		for _, tag := range env.revalidatedTags(t, tenant.Tenant) {
			if tag == siteTag {
				count++
			}
		}
		return count
	}
	if n := revalidations(); n != 1 {
		t.Fatalf("invalidations of %s = %d, want 1", siteTag, n)
	}

	// The same settings again change nothing, so nothing is audited and no
	// cache is dropped.
	if _, err := updateDBSignUpSettings(env, tenant, &publiraadminv1.TenantSignUpSettings{
		SignUpOpen:    false,
		ClosedMessage: want,
	}); err != nil {
		t.Fatalf("UpdateTenantSignUpSettings: %v", err)
	}
	if n := audited(); n != 1 {
		t.Fatalf("audit entries after an unchanged save = %d, want 1", n)
	}
	if n := revalidations(); n != 1 {
		t.Fatalf("invalidations after an unchanged save = %d, want 1", n)
	}

	// Reopening keeps the message, so closing again does not have to retype it.
	reopened, err := updateDBSignUpSettings(env, tenant, &publiraadminv1.TenantSignUpSettings{
		SignUpOpen:    true,
		ClosedMessage: want,
	})
	if err != nil {
		t.Fatalf("UpdateTenantSignUpSettings: %v", err)
	}
	if !reopened.Settings.SignUpOpen || reopened.Settings.ClosedMessage != want {
		t.Fatalf("reopened = %v, want sign-up open with %q kept", reopened.Settings, want)
	}
	if n := audited(); n != 2 {
		t.Fatalf("audit entries = %d, want 2", n)
	}
	if n := revalidations(); n != 2 {
		t.Fatalf("invalidations of %s = %d, want 2", siteTag, n)
	}
}

func TestDBSignUpSettingsRefuseALongMessage(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	if _, err := updateDBSignUpSettings(env, tenant, &publiraadminv1.TenantSignUpSettings{
		SignUpOpen:    true,
		ClosedMessage: strings.Repeat("a", signupsettings.MaxClosedMessageLength),
	}); err != nil {
		t.Fatalf("UpdateTenantSignUpSettings at the limit: %v", err)
	}

	_, err := updateDBSignUpSettings(env, tenant, &publiraadminv1.TenantSignUpSettings{
		ClosedMessage: strings.Repeat("a", signupsettings.MaxClosedMessageLength+1),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || violatedField(t, connectErr) != "settings.closed_message" {
		t.Fatalf("err = %v, want a violation on settings.closed_message", err)
	}
	if _, err := updateDBSignUpSettings(env, tenant, nil); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("no settings: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	got, err := getDBSignUpSettings(env, tenant)
	if err != nil {
		t.Fatalf("GetTenantSignUpSettings: %v", err)
	}
	if !got.Settings.SignUpOpen || len(got.Settings.ClosedMessage) != signupsettings.MaxClosedMessageLength {
		t.Fatalf("settings after refused saves = open %v with a %d-character message, want the earlier save kept", got.Settings.SignUpOpen, len(got.Settings.ClosedMessage))
	}
}

// Every member of staff may see the setting, and only a tenant admin may change
// it.
func TestDBSignUpSettingsAreWrittenByATenantAdminAlone(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor)
	auditor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER03", "auditor@tenant-a.example.com", "Tenant A Auditor", auth.RoleTenantAuditor)

	for _, member := range []adminDBTenant{tenant.as(editor), tenant.as(auditor)} {
		if _, err := getDBSignUpSettings(env, member); err != nil {
			t.Fatalf("get as %s: %v", member.User.Email, err)
		}
		if _, err := updateDBSignUpSettings(env, member, &publiraadminv1.TenantSignUpSettings{
			SignUpOpen: false,
		}); connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("update as %s: code = %v, want permission_denied (err=%v)", member.User.Email, connect.CodeOf(err), err)
		}
	}
	if stored := env.countRows(t, "SELECT count(*) FROM tenant_sign_up_settings WHERE tenant_id = $1", tenant.Tenant.ID); stored != 0 {
		t.Fatalf("stored settings = %d, want 0", stored)
	}
	if tags := env.revalidatedTags(t, tenant.Tenant); slices.Contains(tags, fmt.Sprintf("tenant:%s:site", tenant.Tenant.ID)) {
		t.Fatalf("invalidations = %v, want none for a refused save", tags)
	}
}
