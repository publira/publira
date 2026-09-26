package platformapi

import (
	"context"
	"strings"
	"testing"

	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
)

// The same address can be invited to several tenants, so an invitation entry
// has to say which tenant it was for, whichever way the log is paged.
func TestDBListAuditLogsNamesTheTenantAndAddressOfAnInvitation(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	first := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	second := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	audit := publirasplatformv1connect.NewPlatformAuditLogServiceClient(ts.Client(), ts.URL)
	ctx := context.Background()
	const email = "invitee@example.com"

	created, err := tenants.CreateTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantPublicId: first.PublicID, Email: email,
	}))
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation for tenant A: %v", err)
	}
	if _, err := tenants.ResendTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.ResendTenantAdminInvitationRequest{
		TenantPublicId: first.PublicID, InvitationId: created.Msg.Invitation.Id,
	})); err != nil {
		t.Fatalf("ResendTenantAdminInvitation: %v", err)
	}
	if _, err := tenants.CancelTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.CancelTenantAdminInvitationRequest{
		TenantPublicId: first.PublicID, InvitationId: created.Msg.Invitation.Id,
	})); err != nil {
		t.Fatalf("CancelTenantAdminInvitation: %v", err)
	}
	if _, err := tenants.CreateTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantPublicId: second.PublicID, Email: email,
	})); err != nil {
		t.Fatalf("CreateTenantAdminInvitation for tenant B: %v", err)
	}

	list := func(limit int32, token, tenantPublicID string) *publirasplatformv1.ListAuditLogsResponse {
		t.Helper()
		res, err := audit.ListAuditLogs(ctx, newDBAuthedRequest(operator, publirasplatformv1.ListAuditLogsRequest{
			Limit: limit, Token: token, TenantPublicId: tenantPublicID,
		}))
		if err != nil {
			t.Fatalf("ListAuditLogs: %v", err)
		}
		return res.Msg
	}
	summarize := func(logs []*publirasplatformv1.PlatformAuditLog) string {
		t.Helper()
		entries := make([]string, 0, len(logs))
		for _, log := range logs {
			if log.GetTargetType() != "tenant_admin_invitation" {
				t.Fatalf("entry = %+v, want an invitation", log)
			}
			entries = append(entries, strings.Join([]string{log.GetAction(), log.GetTenantPublicId(), log.GetTenantName(), log.GetTargetName()}, " "))
		}
		return strings.Join(entries, "\n")
	}
	want := strings.Join([]string{
		"tenant_admin_invited TENANTB Tenant B " + email,
		"tenant_admin_invite_canceled TENANTA Tenant A " + email,
		"tenant_admin_invite_resent TENANTA Tenant A " + email,
		"tenant_admin_invited TENANTA Tenant A " + email,
	}, "\n")

	if got := summarize(list(0, "", "").GetAuditLogs()); got != want {
		t.Fatalf("entries =\n%s\nwant\n%s", got, want)
	}

	firstPage := list(2, "", "")
	secondPage := list(2, firstPage.GetNextToken(), "")
	backward := list(2, secondPage.GetPreviousToken(), "")
	if got, want := summarize(backward.GetAuditLogs()), summarize(firstPage.GetAuditLogs()); got != want {
		t.Fatalf("page read backward =\n%s\nwant\n%s", got, want)
	}

	filtered := list(0, "", second.PublicID)
	if got, want := summarize(filtered.GetAuditLogs()), "tenant_admin_invited TENANTB Tenant B "+email; got != want {
		t.Fatalf("entries for tenant B =\n%s\nwant\n%s", got, want)
	}
}

// target_id holds 64 characters and an address may hold 255, so an invitation
// entry naming the address would refuse the invitation it records.
func TestDBCreateTenantAdminInvitationTakesAnAddressLongerThanAnAuditTarget(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	email := strings.Repeat("a", 64) + "@tenant-a.example.com"

	if _, err := tenants.CreateTenantAdminInvitation(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantPublicId: tenant.PublicID, Email: email,
	})); err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
}

// An address that already belongs to a user of the tenant is granted the role
// with no invitation, and the same address can belong to users of several
// tenants, so the entry names the user and takes the tenant from its row.
func TestDBListAuditLogsNamesTheTenantOfARoleGrantedToAnExistingUser(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	first := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	second := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	const email = "reader@example.com"
	pg.SeedEndUser(t, first.ID, "TAREADER", email, "Reader A")
	pg.SeedEndUser(t, second.ID, "TBREADER", email, "Reader B")
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	audit := publirasplatformv1connect.NewPlatformAuditLogServiceClient(ts.Client(), ts.URL)
	ctx := context.Background()

	for _, tenant := range []string{first.PublicID, second.PublicID} {
		created, err := tenants.CreateTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.CreateTenantAdminInvitationRequest{
			TenantPublicId: tenant, Email: email,
		}))
		if err != nil {
			t.Fatalf("CreateTenantAdminInvitation for %s: %v", tenant, err)
		}
		if !created.Msg.RoleGrantedImmediately {
			t.Fatalf("CreateTenantAdminInvitation for %s = %+v, want the role granted", tenant, created.Msg)
		}
	}

	list := func(tenantPublicID string) string {
		t.Helper()
		res, err := audit.ListAuditLogs(ctx, newDBAuthedRequest(operator, publirasplatformv1.ListAuditLogsRequest{TenantPublicId: tenantPublicID}))
		if err != nil {
			t.Fatalf("ListAuditLogs: %v", err)
		}
		entries := make([]string, 0, len(res.Msg.AuditLogs))
		for _, log := range res.Msg.AuditLogs {
			entries = append(entries, strings.Join([]string{log.GetAction(), log.GetTargetType(), log.GetTargetPublicId(), log.GetTargetName(), log.GetTenantPublicId(), log.GetTenantName()}, " "))
		}
		return strings.Join(entries, "\n")
	}
	want := strings.Join([]string{
		"tenant_admin_invited user TBREADER Reader B TENANTB Tenant B",
		"tenant_admin_invited user TAREADER Reader A TENANTA Tenant A",
	}, "\n")
	if got := list(""); got != want {
		t.Fatalf("entries =\n%s\nwant\n%s", got, want)
	}
	if got, want := list(first.PublicID), "tenant_admin_invited user TAREADER Reader A TENANTA Tenant A"; got != want {
		t.Fatalf("entries for tenant A =\n%s\nwant\n%s", got, want)
	}
}

// The entry for a role granted to an existing user names the user rather than
// the address, which target_id could not hold past 64 characters.
func TestDBCreateTenantAdminInvitationGrantsTheRoleToAnAddressLongerThanAnAuditTarget(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := pg.SeedEndUser(t, tenant.ID, "TAREADER", strings.Repeat("a", 64)+"@tenant-a.example.com", "Reader")
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	created, err := tenants.CreateTenantAdminInvitation(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantPublicId: tenant.PublicID, Email: reader.Email,
	}))
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	if !created.Msg.RoleGrantedImmediately {
		t.Fatalf("CreateTenantAdminInvitation = %+v, want the role granted", created.Msg)
	}
}
