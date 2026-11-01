package adminapi

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func getDBCreatorPageSettings(env *adminDBEnv, tenant adminDBTenant) (*publiraadminv1.GetTenantCreatorPageSettingsResponse, error) {
	return env.tenantSettingsClient().GetTenantCreatorPageSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetTenantCreatorPageSettingsRequest{
		Tenant: tenant.tenantContext(),
	})
}

func updateDBCreatorPageSettings(env *adminDBEnv, tenant adminDBTenant, enabled, showSales bool) (*publiraadminv1.UpdateTenantCreatorPageSettingsResponse, error) {
	return env.tenantSettingsClient().UpdateTenantCreatorPageSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateTenantCreatorPageSettingsRequest{
		CreatorPagesEnabled:   enabled,
		CreatorPagesShowSales: showSales,
		Tenant:                tenant.tenantContext(),
	})
}

func assertCreatorPageSettings(t *testing.T, got *publiraadminv1.GetTenantCreatorPageSettingsResponse, enabled, showSales bool) {
	t.Helper()
	if got.CreatorPagesEnabled != enabled || got.CreatorPagesShowSales != showSales {
		t.Fatalf("creator pages = enabled %v, show sales %v, want enabled %v, show sales %v", got.CreatorPagesEnabled, got.CreatorPagesShowSales, enabled, showSales)
	}
}

// A tenant that has saved nothing is told both switches are off, which is
// what the columns would store, and a save that turns sales on while the
// pages stay off is kept.
func TestDBTenantCreatorPageSettingsRoundTrip(t *testing.T) {
	// newReaderIconDBEnv sets the revalidation URL, which is process-wide, so
	// this test stays serial.
	env := newReaderIconDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TCPTNNT1", "creator-pages.example.com", "Creator Pages", "TCPUSER1", "admin@creator-pages.example.com")

	reported, err := getDBCreatorPageSettings(env, tenant)
	if err != nil {
		t.Fatalf("GetTenantCreatorPageSettings: %v", err)
	}
	assertCreatorPageSettings(t, reported, false, false)

	saved, err := updateDBCreatorPageSettings(env, tenant, false, true)
	if err != nil {
		t.Fatalf("UpdateTenantCreatorPageSettings: %v", err)
	}
	if saved.CreatorPagesEnabled || !saved.CreatorPagesShowSales {
		t.Fatalf("saved creator pages = enabled %v, show sales %v, want the pages off and sales on", saved.CreatorPagesEnabled, saved.CreatorPagesShowSales)
	}
	if audits := tenantSettingAuditCount(t, env, tenant, "tenant_creator_page_settings_updated", "tenant_creator_page_settings"); audits != 1 {
		t.Fatalf("audit entries = %d, want 1", audits)
	}
	if tags := env.revalidatedTags(t, tenant.Tenant); !slices.Contains(tags, fmt.Sprintf("tenant:%s:site", tenant.Tenant.ID)) {
		t.Fatalf("invalidations = %v, want the public site cache dropped", tags)
	}

	// Saving the stored pair again changes nothing, so it adds no entry and
	// owes no further drop.
	if _, err := updateDBCreatorPageSettings(env, tenant, false, true); err != nil {
		t.Fatalf("second UpdateTenantCreatorPageSettings: %v", err)
	}
	if audits := tenantSettingAuditCount(t, env, tenant, "tenant_creator_page_settings_updated", "tenant_creator_page_settings"); audits != 1 {
		t.Fatalf("audit entries after an unchanged save = %d, want 1", audits)
	}

	read, err := getDBCreatorPageSettings(env, tenant)
	if err != nil {
		t.Fatalf("GetTenantCreatorPageSettings: %v", err)
	}
	assertCreatorPageSettings(t, read, false, true)

	if _, err := updateDBCreatorPageSettings(env, tenant, true, false); err != nil {
		t.Fatalf("UpdateTenantCreatorPageSettings pages on: %v", err)
	}
	read, err = getDBCreatorPageSettings(env, tenant)
	if err != nil {
		t.Fatalf("GetTenantCreatorPageSettings after turning the pages on: %v", err)
	}
	assertCreatorPageSettings(t, read, true, false)
	if audits := tenantSettingAuditCount(t, env, tenant, "tenant_creator_page_settings_updated", "tenant_creator_page_settings"); audits != 2 {
		t.Fatalf("audit entries = %d, want 2", audits)
	}
}

// Every member of staff may see the switches, and only a tenant admin may
// change them.
func TestDBTenantCreatorPageSettingsAreWrittenByATenantAdminAlone(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TCPTNNT2", "creator-pages-role.example.com", "Creator Page Roles", "TCPUSER2", "admin@creator-pages-role.example.com")
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TCPUSER3", "editor@creator-pages-role.example.com", "Creator Page Editor", auth.RoleTenantEditor)
	auditor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TCPUSER4", "auditor@creator-pages-role.example.com", "Creator Page Auditor", auth.RoleTenantAuditor)

	for _, member := range []adminDBTenant{tenant.as(editor), tenant.as(auditor)} {
		got, err := getDBCreatorPageSettings(env, member)
		if err != nil {
			t.Fatalf("get as %s: %v", member.User.Email, err)
		}
		assertCreatorPageSettings(t, got, false, false)
		if _, err := updateDBCreatorPageSettings(env, member, true, true); connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("update as %s: code = %v, want permission_denied (err=%v)", member.User.Email, connect.CodeOf(err), err)
		}
	}
	if stored := env.countRows(t, "SELECT count(*) FROM tenant_config WHERE tenant_id = $1", tenant.Tenant.ID); stored != 0 {
		t.Fatalf("stored config rows = %d, want 0", stored)
	}
	if audits := tenantSettingAuditCount(t, env, tenant, "tenant_creator_page_settings_updated", "tenant_creator_page_settings"); audits != 0 {
		t.Fatalf("audit entries = %d, want 0", audits)
	}
}
