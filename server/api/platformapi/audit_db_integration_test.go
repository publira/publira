package platformapi

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// The same address can be invited to several tenants, so an invitation entry
// has to say which tenant it was for, whichever way the log is paged.
func TestDBListAuditLogsNamesTheTenantAndAddressOfAnInvitation(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	first := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	second := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	audit := publirasplatformv1connect.NewPlatformAuditLogServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	ctx := context.Background()
	const email = "invitee@example.com"

	created, err := tenants.CreateTenantAdminInvitation(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantId: first.ID.String(), Email: email,
	})
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation for tenant A: %v", err)
	}
	if _, err := tenants.ResendTenantAdminInvitation(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.ResendTenantAdminInvitationRequest{
		TenantId: first.ID.String(), InvitationId: created.Invitation.Id,
	}); err != nil {
		t.Fatalf("ResendTenantAdminInvitation: %v", err)
	}
	if _, err := tenants.CancelTenantAdminInvitation(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.CancelTenantAdminInvitationRequest{
		TenantId: first.ID.String(), InvitationId: created.Invitation.Id,
	}); err != nil {
		t.Fatalf("CancelTenantAdminInvitation: %v", err)
	}
	if _, err := tenants.CreateTenantAdminInvitation(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantId: second.ID.String(), Email: email,
	}); err != nil {
		t.Fatalf("CreateTenantAdminInvitation for tenant B: %v", err)
	}

	list := func(limit int32, token, tenantID string) *publirasplatformv1.ListAuditLogsResponse {
		t.Helper()
		res, err := audit.ListAuditLogs(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.ListAuditLogsRequest{
			Limit: limit, Token: token, TenantId: tenantID,
		})
		if err != nil {
			t.Fatalf("ListAuditLogs: %v", err)
		}
		return res
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

	filtered := list(0, "", second.ID.String())
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
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	email := strings.Repeat("a", 64) + "@tenant-a.example.com"

	if _, err := tenants.CreateTenantAdminInvitation(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantId: tenant.ID.String(), Email: email,
	}); err != nil {
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
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	audit := publirasplatformv1connect.NewPlatformAuditLogServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	ctx := context.Background()

	for _, tenant := range []string{first.ID.String(), second.ID.String()} {
		created, err := tenants.CreateTenantAdminInvitation(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantAdminInvitationRequest{
			TenantId: tenant, Email: email,
		})
		if err != nil {
			t.Fatalf("CreateTenantAdminInvitation for %s: %v", tenant, err)
		}
		if !created.RoleGrantedImmediately {
			t.Fatalf("CreateTenantAdminInvitation for %s = %+v, want the role granted", tenant, created)
		}
	}

	list := func(tenantID string) string {
		t.Helper()
		res, err := audit.ListAuditLogs(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.ListAuditLogsRequest{TenantId: tenantID})
		if err != nil {
			t.Fatalf("ListAuditLogs: %v", err)
		}
		entries := make([]string, 0, len(res.AuditLogs))
		for _, log := range res.AuditLogs {
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
	if got, want := list(first.ID.String()), "tenant_admin_invited user TAREADER Reader A TENANTA Tenant A"; got != want {
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
	tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	created, err := tenants.CreateTenantAdminInvitation(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantId: tenant.ID.String(), Email: reader.Email,
	})
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	if !created.RoleGrantedImmediately {
		t.Fatalf("CreateTenantAdminInvitation = %+v, want the role granted", created)
	}
}

// Deleting a reader takes the users row an entry would have found its tenant
// through, so the entries about the reader, the deletion's own included, keep
// the tenant they were written for.
func TestDBListAuditLogsKeepsTheTenantOfADeletedReader(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	first := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	second := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	reader := pg.SeedEndUser(t, first.ID, "TAREADER", "reader@example.com", "Reader A")
	pg.SeedEndUser(t, second.ID, "TBREADER", "reader@example.com", "Reader B")
	users := publirasplatformv1connect.NewPlatformUserServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	audit := publirasplatformv1connect.NewPlatformAuditLogServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	ctx := context.Background()

	if _, err := users.SuspendEndUser(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.SuspendEndUserRequest{UserId: reader.ID.String()}); err != nil {
		t.Fatalf("SuspendEndUser: %v", err)
	}
	if _, err := users.DeleteEndUser(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.DeleteEndUserRequest{UserId: reader.ID.String()}); err != nil {
		t.Fatalf("DeleteEndUser: %v", err)
	}

	list := func(tenantID string) string {
		t.Helper()
		res, err := audit.ListAuditLogs(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.ListAuditLogsRequest{TenantId: tenantID})
		if err != nil {
			t.Fatalf("ListAuditLogs: %v", err)
		}
		entries := make([]string, 0, len(res.AuditLogs))
		for _, log := range res.AuditLogs {
			entries = append(entries, strings.Join([]string{log.GetAction(), log.GetTargetType(), log.GetTenantPublicId(), log.GetTenantName()}, " "))
		}
		return strings.Join(entries, "\n")
	}
	want := strings.Join([]string{
		"user_deleted user TENANTA Tenant A",
		"user_suspended user TENANTA Tenant A",
	}, "\n")
	if got := list(first.ID.String()); got != want {
		t.Fatalf("entries for tenant A =\n%s\nwant\n%s", got, want)
	}
	if got := list(second.ID.String()); got != "" {
		t.Fatalf("entries for tenant B =\n%s\nwant none", got)
	}
}

// The processes of the previous release keep serving between db migrate and
// their restart, and write their entries without tenant_id. The database fills
// it from the target, as the platform role, so those entries are in the
// tenant's log too.
func TestDBListAuditLogsFillsTheTenantOfAnEntryWrittenWithoutOne(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	reader := pg.SeedEndUser(t, tenant.ID, "TAREADER", "reader@example.com", "Reader A")
	audit := publirasplatformv1connect.NewPlatformAuditLogServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	ctx := context.Background()

	for _, entry := range []struct{ action, targetType, targetID string }{
		{"tenant_suspended", "tenant", tenant.ID.String()},
		{"user_suspended", "user", reader.ID.String()},
		{"operator_updated", "operator", operator.ID.String()},
	} {
		if _, err := pg.OpenPlatformDB(t).ExecContext(ctx, `
			INSERT INTO platform_audit_logs (id, actor_platform_user_id, actor_role, action, target_type, target_id, outcome)
			VALUES (gen_random_uuid(), $1, 'platform_operator', $2, $3, $4, 'success')
		`, operator.ID, entry.action, entry.targetType, entry.targetID); err != nil {
			t.Fatalf("insert %s without tenant_id: %v", entry.action, err)
		}
	}

	res, err := audit.ListAuditLogs(testutil.WithBearer(ctx, issueDBIntegrationToken(operator)), &publirasplatformv1.ListAuditLogsRequest{TenantId: tenant.ID.String()})
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	actions := make([]string, 0, len(res.AuditLogs))
	for _, log := range res.AuditLogs {
		actions = append(actions, log.GetAction()+" "+log.GetTenantName())
	}
	got := strings.Join(actions, "\n")
	for _, want := range []string{"tenant_suspended Tenant A", "user_suspended Tenant A"} {
		if !strings.Contains(got, want) {
			t.Fatalf("entries for tenant A =\n%s\nwant %q among them", got, want)
		}
	}
	if strings.Contains(got, "operator_updated") {
		t.Fatalf("entries for tenant A =\n%s\nwant no operator entry", got)
	}
}
