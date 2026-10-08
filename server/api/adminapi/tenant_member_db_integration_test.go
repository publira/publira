package adminapi

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/connect/v2/connectproto"
	"github.com/google/uuid"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantlock"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) tenantMemberClient() publiraadminv1connect.AdminTenantMemberServiceClient {
	return publiraadminv1connect.NewAdminTenantMemberServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
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
		value, valueErr := connectproto.UnmarshalErrorDetail(detail)
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
				_, err := client.ListTenantMembers(testutil.WithBearer(ctx, as.token()), &publiraadminv1.ListTenantMembersRequest{Tenant: as.tenantContext()})
				return err
			},
			"AddTenantMember": func() error {
				_, err := client.AddTenantMember(testutil.WithBearer(ctx, as.token()), &publiraadminv1.AddTenantMemberRequest{Tenant: as.tenantContext(), Email: "reader@tenant-a.example.com", Role: auth.RoleTenantEditor})
				return err
			},
			"UpdateTenantMemberRole": func() error {
				_, err := client.UpdateTenantMemberRole(testutil.WithBearer(ctx, as.token()), &publiraadminv1.UpdateTenantMemberRoleRequest{Tenant: as.tenantContext(), UserId: seat.ID.String(), Role: auth.RoleTenantAdmin})
				return err
			},
			"RemoveTenantMember": func() error {
				_, err := client.RemoveTenantMember(testutil.WithBearer(ctx, as.token()), &publiraadminv1.RemoveTenantMemberRequest{Tenant: as.tenantContext(), UserId: tenant.User.ID.String()})
				return err
			},
			"ListTenantAdminInvitations": func() error {
				_, err := client.ListTenantAdminInvitations(testutil.WithBearer(ctx, as.token()), &publiraadminv1.ListTenantAdminInvitationsRequest{Tenant: as.tenantContext()})
				return err
			},
			"CreateTenantAdminInvitation": func() error {
				_, err := client.CreateTenantAdminInvitation(testutil.WithBearer(ctx, as.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{Tenant: as.tenantContext(), Email: "new@tenant-a.example.com"})
				return err
			},
			"ResendTenantAdminInvitation": func() error {
				_, err := client.ResendTenantAdminInvitation(testutil.WithBearer(ctx, as.token()), &publiraadminv1.ResendTenantAdminInvitationRequest{Tenant: as.tenantContext(), InvitationId: "0190c0de-0000-7000-8000-000000000000"})
				return err
			},
			"CancelTenantAdminInvitation": func() error {
				_, err := client.CancelTenantAdminInvitation(testutil.WithBearer(ctx, as.token()), &publiraadminv1.CancelTenantAdminInvitationRequest{Tenant: as.tenantContext(), InvitationId: "0190c0de-0000-7000-8000-000000000000"})
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

	invited, err := client.CreateTenantAdminInvitation(testutil.WithBearer(ctx, second.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: second.tenantContext(),
		Email:  "invitee@tenant-b.example.com",
	})
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation for tenant B: %v", err)
	}
	secondInvitationID := invited.Invitation.Id

	members, err := client.ListTenantMembers(testutil.WithBearer(ctx, first.token()), &publiraadminv1.ListTenantMembersRequest{Tenant: first.tenantContext()})
	if err != nil {
		t.Fatalf("ListTenantMembers: %v", err)
	}
	if len(members.Members) != 1 || members.Members[0].UserPublicId != first.User.PublicID {
		t.Fatalf("tenant A members = %+v, want only its own admin", members.Members)
	}
	invitations, err := client.ListTenantAdminInvitations(testutil.WithBearer(ctx, first.token()), &publiraadminv1.ListTenantAdminInvitationsRequest{Tenant: first.tenantContext()})
	if err != nil {
		t.Fatalf("ListTenantAdminInvitations: %v", err)
	}
	if len(invitations.Invitations) != 0 {
		t.Fatalf("tenant A invitations = %+v, want none", invitations.Invitations)
	}

	_, err = client.UpdateTenantMemberRole(testutil.WithBearer(ctx, first.token()), &publiraadminv1.UpdateTenantMemberRoleRequest{
		Tenant: first.tenantContext(), UserId: secondEditor.ID.String(), Role: auth.RoleTenantAdmin,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateTenantMemberRole on tenant B's member: code = %v, want not_found", connect.CodeOf(err))
	}
	_, err = client.RemoveTenantMember(testutil.WithBearer(ctx, first.token()), &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: first.tenantContext(), UserId: secondEditor.ID.String(),
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("RemoveTenantMember on tenant B's member: code = %v, want not_found", connect.CodeOf(err))
	}
	_, err = client.ResendTenantAdminInvitation(testutil.WithBearer(ctx, first.token()), &publiraadminv1.ResendTenantAdminInvitationRequest{
		Tenant: first.tenantContext(), InvitationId: secondInvitationID,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ResendTenantAdminInvitation on tenant B's invitation: code = %v, want not_found", connect.CodeOf(err))
	}
	_, err = client.CancelTenantAdminInvitation(testutil.WithBearer(ctx, first.token()), &publiraadminv1.CancelTenantAdminInvitationRequest{
		Tenant: first.tenantContext(), InvitationId: secondInvitationID,
	})
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

	_, err := client.UpdateTenantMemberRole(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateTenantMemberRoleRequest{
		Tenant: tenant.tenantContext(), UserId: tenant.User.ID.String(), Role: auth.RoleTenantEditor,
	})
	requireLastTenantAdminRefusal(t, err)
	_, err = client.RemoveTenantMember(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserId: tenant.User.ID.String(),
	})
	requireLastTenantAdminRefusal(t, err)

	// A suspended administrator cannot sign in, so it does not keep the tenant
	// reachable.
	suspended := env.seedMember(t, tenant, "TASUSPENDED", "suspended@tenant-a.example.com", auth.RoleTenantAdmin)
	if _, err := env.PG.DB.ExecContext(ctx, "UPDATE users SET status = 'suspended' WHERE id = $1", suspended.ID); err != nil {
		t.Fatalf("suspend second admin: %v", err)
	}
	_, err = client.RemoveTenantMember(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserId: tenant.User.ID.String(),
	})
	requireLastTenantAdminRefusal(t, err)

	second := env.seedMember(t, tenant, "TASECOND", "second@tenant-a.example.com", auth.RoleTenantAdmin)
	updated, err := client.UpdateTenantMemberRole(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateTenantMemberRoleRequest{
		Tenant: tenant.tenantContext(), UserId: second.ID.String(), Role: auth.RoleTenantAuditor,
	})
	if err != nil {
		t.Fatalf("demote the second admin: %v", err)
	}
	if updated.Member.Role != auth.RoleTenantAuditor {
		t.Fatalf("member.role = %q, want %q", updated.Member.Role, auth.RoleTenantAuditor)
	}
	_, err = client.RemoveTenantMember(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserId: tenant.User.ID.String(),
	})
	requireLastTenantAdminRefusal(t, err)

	// With another active administrator left, the caller may step down.
	if _, err := client.UpdateTenantMemberRole(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateTenantMemberRoleRequest{
		Tenant: tenant.tenantContext(), UserId: second.ID.String(), Role: auth.RoleTenantAdmin,
	}); err != nil {
		t.Fatalf("promote the second admin back: %v", err)
	}
	if _, err := client.RemoveTenantMember(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserId: tenant.User.ID.String(),
	}); err != nil {
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

	if _, err := client.UpdateTenantMemberRole(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateTenantMemberRoleRequest{
		Tenant: tenant.tenantContext(), UserId: editor.ID.String(), Role: auth.RoleTenantAuditor,
	}); err != nil {
		t.Fatalf("UpdateTenantMemberRole: %v", err)
	}
	if _, err := client.RemoveTenantMember(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserId: editor.ID.String(),
	}); err != nil {
		t.Fatalf("RemoveTenantMember: %v", err)
	}
	created, err := client.CreateTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: " Invitee@Tenant-A.example.com ",
	})
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	if _, err := client.ResendTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.ResendTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), InvitationId: created.Invitation.Id,
	}); err != nil {
		t.Fatalf("ResendTenantAdminInvitation: %v", err)
	}
	canceled, err := client.CancelTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CancelTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), InvitationId: created.Invitation.Id,
	})
	if err != nil {
		t.Fatalf("CancelTenantAdminInvitation: %v", err)
	}
	if canceled.Invitation.Status != "canceled" {
		t.Fatalf("invitation status = %q, want canceled", canceled.Invitation.Status)
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

	created, err := env.tenantMemberClient().CreateTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: "invitee@tenant-a.example.com",
	})
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	if created.RoleGrantedImmediately || created.Invitation.GetStatus() != "pending" {
		t.Fatalf("response = %+v, want a pending invitation", created)
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
	if body.InvitationID != created.Invitation.Id || body.TenantID != tenant.Tenant.ID.String() {
		t.Fatalf("outbox payload = %+v, want the invitation of tenant %s", body, tenant.Tenant.ID)
	}

	accepted, err := env.authClient().AcceptTenantAdminInvitation(ctx, &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
		Tenant:   tenant.tenantContext(),
		Token:    body.Token,
		Name:     "Invitee",
		Password: testutil.SeededPassword,
	})
	if err != nil {
		t.Fatalf("AcceptTenantAdminInvitation: %v", err)
	}
	if !accepted.Accepted || !accepted.AccountCreated {
		t.Fatalf("accept response = %+v, want an accepted invitation with a new account", accepted)
	}
	if count := env.countRows(t, `
		SELECT count(*) FROM tenant_user_roles tur JOIN users u ON u.id = tur.user_id
		WHERE u.tenant_id = $1 AND u.email = $2 AND tur.role = $3
	`, tenant.Tenant.ID, "invitee@tenant-a.example.com", auth.RoleTenantAdmin); count != 1 {
		t.Fatalf("invitee tenant_admin roles = %d, want 1", count)
	}
}

// A tenant admin can make a reader an Editor or an Auditor directly, without
// the account passing through the tenant_admin role on the way.
func TestDBAddTenantMemberGivesAReaderTheRoleDirectly(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TAREADER1", "editor@tenant-a.example.com", "Editor To Be")
	auditor := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TAREADER2", "auditor@tenant-a.example.com", "Auditor To Be")
	client := env.tenantMemberClient()
	ctx := context.Background()

	for _, want := range []struct {
		user  testutil.TenantUser
		email string
		role  string
	}{
		{editor, " Editor@Tenant-A.example.com ", auth.RoleTenantEditor},
		{auditor, "auditor@tenant-a.example.com", auth.RoleTenantAuditor},
	} {
		added, err := client.AddTenantMember(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.AddTenantMemberRequest{
			Tenant: tenant.tenantContext(), Email: want.email, Role: want.role,
		})
		if err != nil {
			t.Fatalf("AddTenantMember %s: %v", want.role, err)
		}
		if added.Member.GetUserId() != want.user.ID.String() || added.Member.GetRole() != want.role {
			t.Fatalf("member = %+v, want %s as %s", added.Member, want.user.PublicID, want.role)
		}
		if role := env.roleOf(t, want.user); role != want.role {
			t.Fatalf("roles of %s = %q, want %q", want.user.PublicID, role, want.role)
		}
		if count := env.countRows(t, `
			SELECT count(*) FROM audit_logs
			WHERE tenant_id = $1 AND action = 'tenant_member_added' AND target_type = 'user' AND target_id = $2
				AND actor_user_id = $3 AND actor_role = $4 AND reason = $5 AND outcome = 'success'
		`, tenant.Tenant.ID, want.user.PublicID, tenant.User.ID, auth.RoleTenantAdmin, "role="+want.role); count != 1 {
			t.Errorf("tenant_member_added audit rows for %s = %d, want 1", want.user.PublicID, count)
		}
	}
}

func TestDBAddTenantMemberRefusesWhatItCannotGrant(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant, second := seedTwoTenants(t, env)
	editor := env.seedMember(t, tenant, "TAEDITOR", "editor@tenant-a.example.com", auth.RoleTenantEditor)
	env.PG.SeedEndUser(t, second.Tenant.ID, "TBREADER", "reader@tenant-b.example.com", "Tenant B Reader")
	client := env.tenantMemberClient()
	ctx := context.Background()

	for _, refusal := range []struct {
		name  string
		email string
		role  string
		want  connect.Code
	}{
		{"an address with no account", "nobody@tenant-a.example.com", auth.RoleTenantEditor, connect.CodeNotFound},
		{"another tenant's reader", "reader@tenant-b.example.com", auth.RoleTenantEditor, connect.CodeNotFound},
		{"a member who already holds a role", "editor@tenant-a.example.com", auth.RoleTenantAuditor, connect.CodeAlreadyExists},
		{"the caller themselves", "admin@tenant-a.example.com", auth.RoleTenantAuditor, connect.CodeAlreadyExists},
		{"no address", " ", auth.RoleTenantEditor, connect.CodeInvalidArgument},
		{"a role that is not one", "editor@tenant-a.example.com", "tenant_owner", connect.CodeInvalidArgument},
	} {
		t.Run(refusal.name, func(t *testing.T) {
			_, err := client.AddTenantMember(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.AddTenantMemberRequest{
				Tenant: tenant.tenantContext(), Email: refusal.email, Role: refusal.role,
			})
			if code := connect.CodeOf(err); code != refusal.want {
				t.Fatalf("code = %v, want %v (err = %v)", code, refusal.want, err)
			}
		})
	}

	if role := env.roleOf(t, editor); role != auth.RoleTenantEditor {
		t.Fatalf("editor roles = %q after refused calls, want %q", role, auth.RoleTenantEditor)
	}
	if role := env.roleOf(t, tenant.User); role != auth.RoleTenantAdmin {
		t.Fatalf("admin roles = %q after refused calls, want %q", role, auth.RoleTenantAdmin)
	}
}

// An invitation as an Editor or an Auditor makes the invitee that role when it
// is accepted, and the audit log says which role was granted at both ends.
func TestDBAnInvitationGrantsTheRoleItNames(t *testing.T) {
	for _, role := range []string{auth.RoleTenantEditor, auth.RoleTenantAuditor} {
		t.Run(role, func(t *testing.T) {
			env := newAdminDBEnv(t)
			tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
			ctx := context.Background()
			const email = "invitee@tenant-a.example.com"

			created, err := env.tenantMemberClient().CreateTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
				Tenant: tenant.tenantContext(), Email: email, Role: role,
			})
			if err != nil {
				t.Fatalf("CreateTenantAdminInvitation: %v", err)
			}
			if created.RoleGrantedImmediately || created.Invitation.GetRole() != role {
				t.Fatalf("response = %+v, want a pending invitation as %s", created, role)
			}
			listed, err := env.tenantMemberClient().ListTenantAdminInvitations(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.ListTenantAdminInvitationsRequest{Tenant: tenant.tenantContext()})
			if err != nil {
				t.Fatalf("ListTenantAdminInvitations: %v", err)
			}
			if len(listed.Invitations) != 1 || listed.Invitations[0].GetRole() != role {
				t.Fatalf("invitations = %+v, want the one as %s", listed.Invitations, role)
			}

			var payload []byte
			if err := env.PG.DB.QueryRowContext(ctx, `
				SELECT payload FROM outbox_events WHERE tenant_id = $1 AND event_type = $2
			`, tenant.Tenant.ID, outbox.EventTypeTenantAdminInvitationEmail).Scan(&payload); err != nil {
				t.Fatalf("load outbox event: %v", err)
			}
			var body outbox.TenantAdminInvitationPayload
			if err := json.Unmarshal(payload, &body); err != nil {
				t.Fatalf("decode outbox payload: %v", err)
			}

			state, err := env.authClient().GetTenantAdminInvitationState(ctx, &publiraadminv1.AdminAuthServiceGetTenantAdminInvitationStateRequest{
				Tenant: tenant.tenantContext(), Token: body.Token,
			})
			if err != nil {
				t.Fatalf("GetTenantAdminInvitationState: %v", err)
			}
			if state.Role != role || state.Status != "pending" {
				t.Fatalf("state = %+v, want a pending invitation as %s", state, role)
			}

			if _, err := env.authClient().AcceptTenantAdminInvitation(ctx, &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
				Tenant:   tenant.tenantContext(),
				Token:    body.Token,
				Name:     "Invitee",
				Password: testutil.SeededPassword,
			}); err != nil {
				t.Fatalf("AcceptTenantAdminInvitation: %v", err)
			}

			var userID uuid.UUID
			var held string
			if err := env.PG.DB.QueryRowContext(ctx, `
				SELECT u.id, COALESCE(string_agg(tur.role, ','), '')
				FROM users u LEFT JOIN tenant_user_roles tur ON tur.user_id = u.id
				WHERE u.tenant_id = $1 AND u.email = $2
				GROUP BY u.id
			`, tenant.Tenant.ID, email).Scan(&userID, &held); err != nil {
				t.Fatalf("load invitee: %v", err)
			}
			if held != role {
				t.Fatalf("invitee roles = %q, want %q", held, role)
			}

			if count := env.countRows(t, `
				SELECT count(*) FROM audit_logs
				WHERE tenant_id = $1 AND action = 'tenant_admin_invited' AND target_id = $2
					AND actor_user_id = $3 AND reason = $4
			`, tenant.Tenant.ID, email, tenant.User.ID, "role="+role); count != 1 {
				t.Errorf("tenant_admin_invited audit rows naming %s = %d, want 1", role, count)
			}
			if count := env.countRows(t, `
				SELECT count(*) FROM audit_logs
				WHERE tenant_id = $1 AND action = 'tenant_admin_invite_accepted' AND target_id = $2
					AND actor_user_id = $3 AND actor_role = $4 AND reason = $5
			`, tenant.Tenant.ID, email, userID, role, "role="+role); count != 1 {
				t.Errorf("tenant_admin_invite_accepted audit rows as %s = %d, want 1", role, count)
			}
		})
	}
}

// An invitation as an Editor or an Auditor sent to an address that already has
// an account gives that account the role at once, as one as a tenant_admin
// does, but never takes a role away from a member who holds one.
func TestDBAnInvitationToAnExistingAccountGrantsTheRoleOnlyToAReader(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TAREADER1", "reader@tenant-a.example.com", "Reader")
	second := env.seedMember(t, tenant, "TASECOND", "second@tenant-a.example.com", auth.RoleTenantAdmin)
	client := env.tenantMemberClient()
	ctx := context.Background()

	granted, err := client.CreateTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: "reader@tenant-a.example.com", Role: auth.RoleTenantAuditor,
	})
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation for a reader: %v", err)
	}
	if !granted.RoleGrantedImmediately {
		t.Fatalf("response = %+v, want the role granted at once", granted)
	}
	if role := env.roleOf(t, reader); role != auth.RoleTenantAuditor {
		t.Fatalf("reader roles = %q, want %q", role, auth.RoleTenantAuditor)
	}

	_, err = client.CreateTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: "second@tenant-a.example.com", Role: auth.RoleTenantEditor,
	})
	if code := connect.CodeOf(err); code != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenantAdminInvitation demoting an admin: code = %v, want already_exists", code)
	}
	if role := env.roleOf(t, second); role != auth.RoleTenantAdmin {
		t.Fatalf("second admin roles = %q, want %q", role, auth.RoleTenantAdmin)
	}

	// No role named is the tenant_admin invitation the console has always sent.
	if _, err := client.CreateTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: "reader@tenant-a.example.com",
	}); err != nil {
		t.Fatalf("CreateTenantAdminInvitation with no role: %v", err)
	}
	if role := env.roleOf(t, reader); role != auth.RoleTenantAdmin {
		t.Fatalf("reader roles = %q, want %q", role, auth.RoleTenantAdmin)
	}
}

// An account given a role after it was invited keeps the stronger of the two
// when it accepts: accepting an Editor's invitation never demotes an admin.
func TestDBAcceptingAnInvitationNeverLowersARole(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := context.Background()

	const token = "editor-invitation-token"
	const email = "invitee@tenant-a.example.com"
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_admin_invitations (id, tenant_id, email, token_hash, expires_at, role)
		VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day', $5)
	`, uuid.Must(uuid.NewV7()), tenant.Tenant.ID, email, auth.HashToken(token), auth.RoleTenantEditor); err != nil {
		t.Fatalf("insert invitation: %v", err)
	}
	invitee := env.seedMember(t, tenant, "TAINVITEE", email, auth.RoleTenantAdmin)

	if _, err := env.authClient().AcceptTenantAdminInvitation(ctx, &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Token: token,
	}); err != nil {
		t.Fatalf("AcceptTenantAdminInvitation: %v", err)
	}
	if role := env.roleOf(t, invitee); role != auth.RoleTenantAdmin {
		t.Fatalf("invitee roles = %q, want %q", role, auth.RoleTenantAdmin)
	}
}

// promoteWhileGrantWaits holds the tenant's administrator lock, runs grant in
// the background until it is waiting on that lock, then makes user a
// tenant_admin and commits: a grant that read the user's role without the lock
// would replace a promotion it never saw.
func (e *adminDBEnv) promoteWhileGrantWaits(t *testing.T, tenant adminDBTenant, user testutil.TenantUser, grant func() error) error {
	t.Helper()

	ctx := context.Background()
	holder, err := e.PG.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the promotion: %v", err)
	}
	defer holder.Rollback() //nolint:errcheck
	if err := tenantlock.Take(ctx, holder, "tenant-admins:"+tenant.Tenant.ID.String()); err != nil {
		t.Fatalf("take the administrator lock: %v", err)
	}

	var grantErr error
	done := make(chan struct{})
	go func() {
		defer close(done)
		grantErr = grant()
	}()
	e.waitForBlockedBackend(t)

	if _, err := holder.ExecContext(ctx, `
		INSERT INTO tenant_user_roles (id, tenant_id, user_id, role) VALUES ($1, $2, $3, $4)
	`, uuid.Must(uuid.NewV7()), tenant.Tenant.ID, user.ID, auth.RoleTenantAdmin); err != nil {
		t.Fatalf("promote %s: %v", user.PublicID, err)
	}
	if err := holder.Commit(); err != nil {
		t.Fatalf("commit the promotion: %v", err)
	}
	<-done
	return grantErr
}

// Accepting an Editor's invitation waits for a promotion that is under way and
// then keeps it, rather than replacing a role it read before the promotion.
func TestDBAcceptingAnInvitationWaitsForAPromotionUnderWay(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := context.Background()

	const token = "editor-invitation-token"
	const email = "invitee@tenant-a.example.com"
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_admin_invitations (id, tenant_id, email, token_hash, expires_at, role)
		VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day', $5)
	`, uuid.Must(uuid.NewV7()), tenant.Tenant.ID, email, auth.HashToken(token), auth.RoleTenantEditor); err != nil {
		t.Fatalf("insert invitation: %v", err)
	}
	invitee := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TAINVITEE", email, "Invitee")

	err := env.promoteWhileGrantWaits(t, tenant, invitee, func() error {
		_, err := env.authClient().AcceptTenantAdminInvitation(ctx, &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
			Tenant: tenant.tenantContext(), Token: token,
		})
		return err
	})
	if err != nil {
		t.Fatalf("AcceptTenantAdminInvitation: %v", err)
	}
	if role := env.roleOf(t, invitee); role != auth.RoleTenantAdmin {
		t.Fatalf("invitee roles = %q, want %q", role, auth.RoleTenantAdmin)
	}
}

// Inviting a reader as an Editor waits for a promotion that is under way, and
// then refuses, rather than replacing the role it never saw.
func TestDBAnInvitationWaitsForAPromotionUnderWay(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TAREADER1", "reader@tenant-a.example.com", "Reader")
	ctx := context.Background()

	err := env.promoteWhileGrantWaits(t, tenant, reader, func() error {
		_, err := env.tenantMemberClient().CreateTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
			Tenant: tenant.tenantContext(), Email: "reader@tenant-a.example.com", Role: auth.RoleTenantEditor,
		})
		return err
	})
	if code := connect.CodeOf(err); code != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenantAdminInvitation: code = %v, want already_exists (err = %v)", code, err)
	}
	if role := env.roleOf(t, reader); role != auth.RoleTenantAdmin {
		t.Fatalf("reader roles = %q, want %q", role, auth.RoleTenantAdmin)
	}
}

// seedAdminInvitation inserts a pending invitation whose link carries token,
// so a test can accept it without reading the mail off the outbox.
func (e *adminDBEnv) seedAdminInvitation(t *testing.T, tenant adminDBTenant, email, token string) {
	t.Helper()

	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO tenant_admin_invitations (id, tenant_id, email, token_hash, expires_at)
		VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')
	`, uuid.Must(uuid.NewV7()), tenant.Tenant.ID, email, auth.HashToken(token)); err != nil {
		t.Fatalf("insert invitation: %v", err)
	}
}

// waitForBlockedBackend waits until another session is waiting on a lock, so
// the test knows the request reached the row it holds instead of racing past it.
func (e *adminDBEnv) waitForBlockedBackend(t *testing.T) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		var blocked int
		if err := e.PG.DB.QueryRowContext(ctx, `
			SELECT count(*)
			FROM pg_stat_activity
			WHERE pid <> pg_backend_pid()
				AND wait_event_type = 'Lock'
		`).Scan(&blocked); err != nil {
			t.Fatalf("read pg_stat_activity: %v", err)
		}
		if blocked > 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("no session ever waited on a lock")
}

// A double-submitted form sends the same acceptance twice at once: the second
// has to answer as a later acceptance does, not fail on the account the first
// one is creating.
func TestDBConcurrentAcceptancesOfOneInvitationCreateOneAccount(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := context.Background()

	const token = "concurrent-acceptance-token"
	const email = "invitee@tenant-a.example.com"
	env.seedAdminInvitation(t, tenant, email, token)

	const acceptances = 2
	responses := make([]*publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationResponse, acceptances)
	errs := make([]error, acceptances)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range acceptances {
		wg.Go(func() {
			<-start
			res, err := env.authClient().AcceptTenantAdminInvitation(ctx, &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
				Tenant:   tenant.tenantContext(),
				Token:    token,
				Name:     "Invitee",
				Password: testutil.SeededPassword,
			})
			errs[i] = err
			if err == nil {
				responses[i] = res
			}
		})
	}
	close(start)
	wg.Wait()

	created := 0
	for i := range acceptances {
		if errs[i] != nil {
			t.Fatalf("acceptance %d: %v", i, errs[i])
		}
		if !responses[i].Accepted {
			t.Fatalf("acceptance %d response = %+v, want accepted", i, responses[i])
		}
		if responses[i].AccountCreated {
			created++
		}
	}
	if created != 1 {
		t.Fatalf("acceptances that created the account = %d, want 1", created)
	}
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE tenant_id = $1 AND email = $2", tenant.Tenant.ID, email); count != 1 {
		t.Fatalf("invitee accounts = %d, want 1", count)
	}
	if count := env.countRows(t, `
		SELECT count(*) FROM tenant_user_roles tur JOIN users u ON u.id = tur.user_id
		WHERE u.tenant_id = $1 AND u.email = $2 AND tur.role = $3
	`, tenant.Tenant.ID, email, auth.RoleTenantAdmin); count != 1 {
		t.Fatalf("invitee tenant_admin roles = %d, want 1", count)
	}
}

// A reader signing up with the invited address while the invitation is being
// accepted takes the address first; the acceptance says so on the field
// instead of reporting a database failure, and a retry grants that account.
func TestDBAcceptanceRacingASignUpAnswersAlreadyExists(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := context.Background()

	const token = "racing-sign-up-token"
	const email = "invitee@tenant-a.example.com"
	env.seedAdminInvitation(t, tenant, email, token)

	// The sign-up holds its row uncommitted, so the acceptance sees no account
	// and waits on the address's unique index when it inserts one.
	signUp, err := env.PG.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the sign-up: %v", err)
	}
	defer signUp.Rollback() //nolint:errcheck
	if _, err := signUp.ExecContext(ctx, `
		INSERT INTO users (id, tenant_id, public_id, email, password_hash, name)
		VALUES ($1, $2, 'TAREADER', $3, 'not-a-real-hash', 'Reader')
	`, uuid.Must(uuid.NewV7()), tenant.Tenant.ID, email); err != nil {
		t.Fatalf("insert the signing-up reader: %v", err)
	}

	accept := func() (*publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationResponse, error) {
		return env.authClient().AcceptTenantAdminInvitation(ctx, &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
			Tenant:   tenant.tenantContext(),
			Token:    token,
			Name:     "Invitee",
			Password: testutil.SeededPassword,
		})
	}
	var racingErr error
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, racingErr = accept()
	}()
	env.waitForBlockedBackend(t)
	if err := signUp.Commit(); err != nil {
		t.Fatalf("commit the sign-up: %v", err)
	}
	<-done

	if connect.CodeOf(racingErr) != connect.CodeAlreadyExists {
		t.Fatalf("racing acceptance code = %v, want already_exists (err=%v)", connect.CodeOf(racingErr), racingErr)
	}
	assertBadRequestField(t, racingErr, "email")

	retried, err := accept()
	if err != nil {
		t.Fatalf("retried AcceptTenantAdminInvitation: %v", err)
	}
	if !retried.Accepted || retried.AccountCreated {
		t.Fatalf("retried response = %+v, want an accepted invitation on the existing account", retried)
	}
	if count := env.countRows(t, `
		SELECT count(*) FROM tenant_user_roles tur JOIN users u ON u.id = tur.user_id
		WHERE u.tenant_id = $1 AND u.email = $2 AND tur.role = $3
	`, tenant.Tenant.ID, email, auth.RoleTenantAdmin); count != 1 {
		t.Fatalf("invitee tenant_admin roles = %d, want 1", count)
	}
}

func TestDBCreateTenantAdminInvitationGrantsAnExistingUserAtOnce(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TAREADER", "reader@tenant-a.example.com", "Reader")

	created, err := env.tenantMemberClient().CreateTenantAdminInvitation(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: reader.Email,
	})
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	if !created.RoleGrantedImmediately || created.Invitation != nil {
		t.Fatalf("response = %+v, want the role granted with no invitation", created)
	}
	if role := env.roleOf(t, reader); role != auth.RoleTenantAdmin {
		t.Fatalf("reader roles = %q, want %q", role, auth.RoleTenantAdmin)
	}
	if count := env.countRows(t, "SELECT count(*) FROM outbox_events WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("outbox events = %d, want none for a granted role", count)
	}
}

// An invitation mails an address nobody has confirmed, so creating and resending
// one spend the mail guard's allowance like the console's other mail forms.
func TestDBTenantAdminInvitationMailStopsAtTheLimit(t *testing.T) {
	env := newAdminDBEnvWithMailGuard(t, mailGuardWith(platformpolicy.HourDay{PerHour: 1, PerDay: 100}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}))
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.tenantMemberClient()
	ctx := context.Background()

	created, err := client.CreateTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: "invitee@tenant-a.example.com",
	})
	if err != nil {
		t.Fatalf("the first CreateTenantAdminInvitation: %v", err)
	}
	_, err = client.CreateTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: "invitee@tenant-a.example.com",
	})
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second CreateTenantAdminInvitation code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.ResendTenantAdminInvitation(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.ResendTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), InvitationId: created.Invitation.Id,
	})
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("ResendTenantAdminInvitation code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}

	if events := env.pendingOutboxEvents(t, outbox.EventTypeTenantAdminInvitationEmail); len(events) != 1 {
		t.Fatalf("queued invitation mails = %d, want the one the allowance paid for", len(events))
	}
	if count := env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'tenant_admin_invite_resent'", tenant.Tenant.ID); count != 0 {
		t.Fatalf("resent audit rows = %d, want none for a refused resend", count)
	}
}

// Granting the role to an existing user mails nothing, so it spends nothing.
func TestDBTenantAdminInvitationGrantSpendsNoMailAllowance(t *testing.T) {
	env := newAdminDBEnvWithMailGuard(t, mailGuardWith(platformpolicy.HourDay{PerHour: 1, PerDay: 100}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}))
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TAREADER", "reader@tenant-a.example.com", "Reader")
	client := env.tenantMemberClient()

	for attempt := 1; attempt <= 2; attempt++ {
		created, err := client.CreateTenantAdminInvitation(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateTenantAdminInvitationRequest{
			Tenant: tenant.tenantContext(), Email: reader.Email,
		})
		if err != nil {
			t.Fatalf("CreateTenantAdminInvitation attempt %d: %v", attempt, err)
		}
		if !created.RoleGrantedImmediately {
			t.Fatalf("attempt %d response = %+v, want the role granted", attempt, created)
		}
	}
}
