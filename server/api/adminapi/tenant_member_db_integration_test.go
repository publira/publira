package adminapi

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) tenantMemberClient() publiraadminv1connect.AdminTenantMemberServiceClient {
	return publiraadminv1connect.NewAdminTenantMemberServiceClient(e.Server.Client(), e.Server.URL)
}

// seedMember adds a console member to the tenant in the given role.
func (e *adminDBEnv) seedMember(t *testing.T, tenant adminDBTenant, publicID, email, role string) testutil.TenantUser {
	t.Helper()
	return e.PG.SeedTenantUser(t, tenant.Tenant.ID, publicID, email, publicID, role)
}

func (e *adminDBEnv) roleOf(t *testing.T, user testutil.TenantUser) string {
	t.Helper()

	var role string
	err := e.PG.DB.QueryRowContext(context.Background(), `
		SELECT COALESCE(string_agg(role, ',' ORDER BY role), '')
		FROM tenant_user_roles
		WHERE user_id = $1
	`, user.ID).Scan(&role)
	if err != nil {
		t.Fatalf("load roles of %s: %v", user.PublicID, err)
	}
	return role
}

func requireLastTenantAdminRefusal(t *testing.T, err error) {
	t.Helper()

	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want failed_precondition (err = %v)", connect.CodeOf(err), err)
	}
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("error is not a connect error: %v", err)
	}
	for _, detail := range connectErr.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}
		if info, ok := value.(*errdetails.ErrorInfo); ok &&
			info.GetDomain() == rpcerrors.ErrorInfoDomain &&
			info.GetReason() == rpcerrors.ReasonLastTenantAdmin {
			return
		}
	}
	t.Fatalf("missing %s ErrorInfo on %v", rpcerrors.ReasonLastTenantAdmin, err)
}

func TestDBTenantMemberRPCsRefuseSessionsThatAreNotTenantAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.seedMember(t, tenant, "TAEDITOR", "editor@tenant-a.example.com", auth.RoleTenantEditor)
	auditor := env.seedMember(t, tenant, "TAAUDITOR", "auditor@tenant-a.example.com", auth.RoleTenantAuditor)
	client := env.tenantMemberClient()
	ctx := context.Background()

	for _, seat := range []testutil.TenantUser{editor, auditor} {
		as := tenant.as(seat)
		calls := map[string]func() error{
			"ListTenantMembers": func() error {
				_, err := client.ListTenantMembers(ctx, newAdminDBRequest(as, &publiraadminv1.ListTenantMembersRequest{Tenant: as.tenantContext()}))
				return err
			},
			"UpdateTenantMemberRole": func() error {
				_, err := client.UpdateTenantMemberRole(ctx, newAdminDBRequest(as, &publiraadminv1.UpdateTenantMemberRoleRequest{Tenant: as.tenantContext(), UserPublicId: seat.PublicID, Role: auth.RoleTenantAdmin}))
				return err
			},
			"RemoveTenantMember": func() error {
				_, err := client.RemoveTenantMember(ctx, newAdminDBRequest(as, &publiraadminv1.RemoveTenantMemberRequest{Tenant: as.tenantContext(), UserPublicId: tenant.User.PublicID}))
				return err
			},
			"ListTenantAdminInvitations": func() error {
				_, err := client.ListTenantAdminInvitations(ctx, newAdminDBRequest(as, &publiraadminv1.ListTenantAdminInvitationsRequest{Tenant: as.tenantContext()}))
				return err
			},
			"CreateTenantAdminInvitation": func() error {
				_, err := client.CreateTenantAdminInvitation(ctx, newAdminDBRequest(as, &publiraadminv1.CreateTenantAdminInvitationRequest{Tenant: as.tenantContext(), Email: "new@tenant-a.example.com"}))
				return err
			},
			"ResendTenantAdminInvitation": func() error {
				_, err := client.ResendTenantAdminInvitation(ctx, newAdminDBRequest(as, &publiraadminv1.ResendTenantAdminInvitationRequest{Tenant: as.tenantContext(), InvitationId: "0190c0de-0000-7000-8000-000000000000"}))
				return err
			},
			"CancelTenantAdminInvitation": func() error {
				_, err := client.CancelTenantAdminInvitation(ctx, newAdminDBRequest(as, &publiraadminv1.CancelTenantAdminInvitationRequest{Tenant: as.tenantContext(), InvitationId: "0190c0de-0000-7000-8000-000000000000"}))
				return err
			},
		}
		for name, call := range calls {
			t.Run(seat.Role+"/"+name, func(t *testing.T) {
				if code := connect.CodeOf(call()); code != connect.CodePermissionDenied {
					t.Fatalf("code = %v, want permission_denied", code)
				}
			})
		}
	}

	if role := env.roleOf(t, tenant.User); role != auth.RoleTenantAdmin {
		t.Fatalf("admin roles = %q after refused calls, want %q", role, auth.RoleTenantAdmin)
	}
	if count := env.countRows(t, "SELECT count(*) FROM tenant_admin_invitations"); count != 0 {
		t.Fatalf("invitations = %d after refused calls, want 0", count)
	}
}

func TestDBTenantMemberRPCsStayInsideTheCallingTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	secondEditor := env.seedMember(t, second, "TBEDITOR", "editor@tenant-b.example.com", auth.RoleTenantEditor)
	client := env.tenantMemberClient()
	ctx := context.Background()

	invited, err := client.CreateTenantAdminInvitation(ctx, newAdminDBRequest(second, &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: second.tenantContext(),
		Email:  "invitee@tenant-b.example.com",
	}))
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation for tenant B: %v", err)
	}
	secondInvitationID := invited.Msg.Invitation.Id

	members, err := client.ListTenantMembers(ctx, newAdminDBRequest(first, &publiraadminv1.ListTenantMembersRequest{Tenant: first.tenantContext()}))
	if err != nil {
		t.Fatalf("ListTenantMembers: %v", err)
	}
	if len(members.Msg.Members) != 1 || members.Msg.Members[0].UserPublicId != first.User.PublicID {
		t.Fatalf("tenant A members = %+v, want only its own admin", members.Msg.Members)
	}
	invitations, err := client.ListTenantAdminInvitations(ctx, newAdminDBRequest(first, &publiraadminv1.ListTenantAdminInvitationsRequest{Tenant: first.tenantContext()}))
	if err != nil {
		t.Fatalf("ListTenantAdminInvitations: %v", err)
	}
	if len(invitations.Msg.Invitations) != 0 {
		t.Fatalf("tenant A invitations = %+v, want none", invitations.Msg.Invitations)
	}

	_, err = client.UpdateTenantMemberRole(ctx, newAdminDBRequest(first, &publiraadminv1.UpdateTenantMemberRoleRequest{
		Tenant: first.tenantContext(), UserPublicId: secondEditor.PublicID, Role: auth.RoleTenantAdmin,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateTenantMemberRole on tenant B's member: code = %v, want not_found", connect.CodeOf(err))
	}
	_, err = client.RemoveTenantMember(ctx, newAdminDBRequest(first, &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: first.tenantContext(), UserPublicId: secondEditor.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("RemoveTenantMember on tenant B's member: code = %v, want not_found", connect.CodeOf(err))
	}
	_, err = client.ResendTenantAdminInvitation(ctx, newAdminDBRequest(first, &publiraadminv1.ResendTenantAdminInvitationRequest{
		Tenant: first.tenantContext(), InvitationId: secondInvitationID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ResendTenantAdminInvitation on tenant B's invitation: code = %v, want not_found", connect.CodeOf(err))
	}
	_, err = client.CancelTenantAdminInvitation(ctx, newAdminDBRequest(first, &publiraadminv1.CancelTenantAdminInvitationRequest{
		Tenant: first.tenantContext(), InvitationId: secondInvitationID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("CancelTenantAdminInvitation on tenant B's invitation: code = %v, want not_found", connect.CodeOf(err))
	}

	if role := env.roleOf(t, secondEditor); role != auth.RoleTenantEditor {
		t.Fatalf("tenant B editor roles = %q, want %q", role, auth.RoleTenantEditor)
	}
	if count := env.countRows(t, "SELECT count(*) FROM tenant_admin_invitations WHERE canceled_at IS NULL"); count != 1 {
		t.Fatalf("open invitations = %d, want tenant B's one", count)
	}
}

func TestDBTenantMemberRPCsKeepAnActiveTenantAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.tenantMemberClient()
	ctx := context.Background()

	_, err := client.UpdateTenantMemberRole(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantMemberRoleRequest{
		Tenant: tenant.tenantContext(), UserPublicId: tenant.User.PublicID, Role: auth.RoleTenantEditor,
	}))
	requireLastTenantAdminRefusal(t, err)
	_, err = client.RemoveTenantMember(ctx, newAdminDBRequest(tenant, &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserPublicId: tenant.User.PublicID,
	}))
	requireLastTenantAdminRefusal(t, err)

	// A suspended administrator cannot sign in, so it does not keep the tenant
	// reachable.
	suspended := env.seedMember(t, tenant, "TASUSPENDED", "suspended@tenant-a.example.com", auth.RoleTenantAdmin)
	if _, err := env.PG.DB.ExecContext(ctx, "UPDATE users SET status = 'suspended' WHERE id = $1", suspended.ID); err != nil {
		t.Fatalf("suspend second admin: %v", err)
	}
	_, err = client.RemoveTenantMember(ctx, newAdminDBRequest(tenant, &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserPublicId: tenant.User.PublicID,
	}))
	requireLastTenantAdminRefusal(t, err)

	second := env.seedMember(t, tenant, "TASECOND", "second@tenant-a.example.com", auth.RoleTenantAdmin)
	updated, err := client.UpdateTenantMemberRole(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantMemberRoleRequest{
		Tenant: tenant.tenantContext(), UserPublicId: second.PublicID, Role: auth.RoleTenantAuditor,
	}))
	if err != nil {
		t.Fatalf("demote the second admin: %v", err)
	}
	if updated.Msg.Member.Role != auth.RoleTenantAuditor {
		t.Fatalf("member.role = %q, want %q", updated.Msg.Member.Role, auth.RoleTenantAuditor)
	}
	_, err = client.RemoveTenantMember(ctx, newAdminDBRequest(tenant, &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserPublicId: tenant.User.PublicID,
	}))
	requireLastTenantAdminRefusal(t, err)

	// With another active administrator left, the caller may step down.
	if _, err := client.UpdateTenantMemberRole(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantMemberRoleRequest{
		Tenant: tenant.tenantContext(), UserPublicId: second.PublicID, Role: auth.RoleTenantAdmin,
	})); err != nil {
		t.Fatalf("promote the second admin back: %v", err)
	}
	if _, err := client.RemoveTenantMember(ctx, newAdminDBRequest(tenant, &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserPublicId: tenant.User.PublicID,
	})); err != nil {
		t.Fatalf("remove self with another admin left: %v", err)
	}
	if role := env.roleOf(t, tenant.User); role != "" {
		t.Fatalf("removed admin roles = %q, want none", role)
	}
	if role := env.roleOf(t, second); role != auth.RoleTenantAdmin {
		t.Fatalf("second admin roles = %q, want %q", role, auth.RoleTenantAdmin)
	}
}

func TestDBTenantMemberChangesAreAuditedUnderTheActingAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.seedMember(t, tenant, "TAEDITOR", "editor@tenant-a.example.com", auth.RoleTenantEditor)
	client := env.tenantMemberClient()
	ctx := context.Background()

	if _, err := client.UpdateTenantMemberRole(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantMemberRoleRequest{
		Tenant: tenant.tenantContext(), UserPublicId: editor.PublicID, Role: auth.RoleTenantAuditor,
	})); err != nil {
		t.Fatalf("UpdateTenantMemberRole: %v", err)
	}
	if _, err := client.RemoveTenantMember(ctx, newAdminDBRequest(tenant, &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserPublicId: editor.PublicID,
	})); err != nil {
		t.Fatalf("RemoveTenantMember: %v", err)
	}
	created, err := client.CreateTenantAdminInvitation(ctx, newAdminDBRequest(tenant, &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: " Invitee@Tenant-A.example.com ",
	}))
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	if _, err := client.ResendTenantAdminInvitation(ctx, newAdminDBRequest(tenant, &publiraadminv1.ResendTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), InvitationId: created.Msg.Invitation.Id,
	})); err != nil {
		t.Fatalf("ResendTenantAdminInvitation: %v", err)
	}
	canceled, err := client.CancelTenantAdminInvitation(ctx, newAdminDBRequest(tenant, &publiraadminv1.CancelTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), InvitationId: created.Msg.Invitation.Id,
	}))
	if err != nil {
		t.Fatalf("CancelTenantAdminInvitation: %v", err)
	}
	if canceled.Msg.Invitation.Status != "canceled" {
		t.Fatalf("invitation status = %q, want canceled", canceled.Msg.Invitation.Status)
	}

	for _, want := range []struct{ action, targetType, targetID string }{
		{"tenant_member_role_updated", "user", editor.PublicID},
		{"tenant_member_removed", "user", editor.PublicID},
		{"tenant_admin_invited", "tenant_admin_invitation", "invitee@tenant-a.example.com"},
		{"tenant_admin_invite_resent", "tenant_admin_invitation", "invitee@tenant-a.example.com"},
		{"tenant_admin_invite_canceled", "tenant_admin_invitation", "invitee@tenant-a.example.com"},
	} {
		if count := env.countRows(t, `
			SELECT count(*) FROM audit_logs
			WHERE tenant_id = $1 AND action = $2 AND target_type = $3 AND target_id = $4
				AND actor_user_id = $5 AND actor_role = $6 AND outcome = 'success'
		`, tenant.Tenant.ID, want.action, want.targetType, want.targetID, tenant.User.ID, auth.RoleTenantAdmin); count != 1 {
			t.Errorf("%s audit rows for %s = %d, want 1", want.action, want.targetID, count)
		}
	}
}

// An invitation from the console is the platform's invitation: the same mail
// on the outbox, and the same acceptance flow at the other end of its link.
func TestDBCreateTenantAdminInvitationQueuesTheMailTheAcceptanceFlowTakes(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := context.Background()

	created, err := env.tenantMemberClient().CreateTenantAdminInvitation(ctx, newAdminDBRequest(tenant, &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: "invitee@tenant-a.example.com",
	}))
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	if created.Msg.RoleGrantedImmediately || created.Msg.Invitation.GetStatus() != "pending" {
		t.Fatalf("response = %+v, want a pending invitation", created.Msg)
	}

	var eventType string
	var payload []byte
	if err := env.PG.DB.QueryRowContext(ctx, `
		SELECT event_type, payload FROM outbox_events WHERE tenant_id = $1
	`, tenant.Tenant.ID).Scan(&eventType, &payload); err != nil {
		t.Fatalf("load outbox event: %v", err)
	}
	if eventType != outbox.EventTypeTenantAdminInvitationEmail {
		t.Fatalf("event type = %q, want %q", eventType, outbox.EventTypeTenantAdminInvitationEmail)
	}
	var body outbox.TenantAdminInvitationPayload
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatalf("decode outbox payload: %v", err)
	}
	if body.InvitationID != created.Msg.Invitation.Id || body.TenantID != tenant.Tenant.ID.String() {
		t.Fatalf("outbox payload = %+v, want the invitation of tenant %s", body, tenant.Tenant.ID)
	}

	accepted, err := env.authClient().AcceptTenantAdminInvitation(ctx, connect.NewRequest(&publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
		Tenant:   tenant.tenantContext(),
		Token:    body.Token,
		Name:     "Invitee",
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("AcceptTenantAdminInvitation: %v", err)
	}
	if !accepted.Msg.Accepted || !accepted.Msg.AccountCreated {
		t.Fatalf("accept response = %+v, want an accepted invitation with a new account", accepted.Msg)
	}
	if count := env.countRows(t, `
		SELECT count(*) FROM tenant_user_roles tur JOIN users u ON u.id = tur.user_id
		WHERE u.tenant_id = $1 AND u.email = $2 AND tur.role = $3
	`, tenant.Tenant.ID, "invitee@tenant-a.example.com", auth.RoleTenantAdmin); count != 1 {
		t.Fatalf("invitee tenant_admin roles = %d, want 1", count)
	}
}

func TestDBCreateTenantAdminInvitationGrantsAnExistingUserAtOnce(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TAREADER", "reader@tenant-a.example.com", "Reader")

	created, err := env.tenantMemberClient().CreateTenantAdminInvitation(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: reader.Email,
	}))
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	if !created.Msg.RoleGrantedImmediately || created.Msg.Invitation != nil {
		t.Fatalf("response = %+v, want the role granted with no invitation", created.Msg)
	}
	if role := env.roleOf(t, reader); role != auth.RoleTenantAdmin {
		t.Fatalf("reader roles = %q, want %q", role, auth.RoleTenantAdmin)
	}
	if count := env.countRows(t, "SELECT count(*) FROM outbox_events WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("outbox events = %d, want none for a granted role", count)
	}
}
