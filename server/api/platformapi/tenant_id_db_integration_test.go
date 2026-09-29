package platformapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
)

// The console resolves the tenant a URL names by public ID once, and names the
// tenant and its members by the internal IDs the responses carry from then on.
func TestDBTenantRPCsAddressTheTenantAndItsMembersByID(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	ctx := context.Background()

	seededTenantID := seedTenant(t, pg, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	otherTenantID := seedTenant(t, pg, "TENANTBBBBBB", "tenant-b.example.com", "Tenant B")
	reader := seedEndUser(t, pg, seededTenantID, "READER000001", "reader@tenant-a.example.com", "Reader")
	stranger := seedEndUser(t, pg, otherTenantID, "READER000002", "reader@tenant-b.example.com", "Stranger")

	got, err := client.GetTenant(ctx, newDBAuthedRequest(operator, publirasplatformv1.GetTenantRequest{PublicId: "TENANTAAAAAA"}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	tenantID := got.Msg.Tenant.Id
	if tenantID != seededTenantID.String() {
		t.Fatalf("tenant.id = %q, want %s", tenantID, seededTenantID)
	}

	updated, err := client.UpdateTenant(ctx, newDBAuthedRequest(operator, publirasplatformv1.UpdateTenantRequest{
		TenantId: tenantID,
		Name:     "Renamed",
		Domain:   "tenant-a.example.com",
	}))
	if err != nil {
		t.Fatalf("UpdateTenant: %v", err)
	}
	if updated.Msg.Tenant.Name != "Renamed" || updated.Msg.Tenant.Id != tenantID {
		t.Fatalf("updated tenant = %+v, want the same tenant renamed", updated.Msg.Tenant)
	}

	added, err := client.AddTenantMember(ctx, newDBAuthedRequest(operator, publirasplatformv1.AddTenantMemberRequest{
		TenantId: tenantID,
		UserId:   reader.ID.String(),
		Role:     auth.RoleTenantEditor,
	}))
	if err != nil {
		t.Fatalf("AddTenantMember: %v", err)
	}
	if added.Msg.Member.UserId != reader.ID.String() {
		t.Fatalf("member.user_id = %q, want %s", added.Msg.Member.UserId, reader.ID)
	}

	members, err := client.ListTenantMembers(ctx, newDBAuthedRequest(operator, publirasplatformv1.ListTenantMembersRequest{TenantId: tenantID}))
	if err != nil {
		t.Fatalf("ListTenantMembers: %v", err)
	}
	if len(members.Msg.Members) != 1 || members.Msg.Members[0].UserId != reader.ID.String() {
		t.Fatalf("members = %+v, want only the reader", members.Msg.Members)
	}

	roled, err := client.UpdateTenantMemberRole(ctx, newDBAuthedRequest(operator, publirasplatformv1.UpdateTenantMemberRoleRequest{
		TenantId: tenantID,
		UserId:   reader.ID.String(),
		Role:     auth.RoleTenantAuditor,
	}))
	if err != nil {
		t.Fatalf("UpdateTenantMemberRole: %v", err)
	}
	if roled.Msg.Member.Role != auth.RoleTenantAuditor {
		t.Fatalf("role = %q, want %s", roled.Msg.Member.Role, auth.RoleTenantAuditor)
	}

	_, err = client.UpdateTenantMemberRole(ctx, newDBAuthedRequest(operator, publirasplatformv1.UpdateTenantMemberRoleRequest{
		TenantId: tenantID,
		UserId:   stranger.ID.String(),
		Role:     auth.RoleTenantAdmin,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another tenant's user: code = %v, want not_found", connect.CodeOf(err))
	}

	removed, err := client.RemoveTenantMember(ctx, newDBAuthedRequest(operator, publirasplatformv1.RemoveTenantMemberRequest{
		TenantId: tenantID,
		UserId:   reader.ID.String(),
	}))
	if err != nil {
		t.Fatalf("RemoveTenantMember: %v", err)
	}
	if removed.Msg.UserId != reader.ID.String() {
		t.Fatalf("removed user_id = %q, want %s", removed.Msg.UserId, reader.ID)
	}

	invited, err := client.CreateTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.CreateTenantAdminInvitationRequest{
		TenantId: tenantID,
		Email:    "invitee@tenant-a.example.com",
	}))
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	invitationID := invited.Msg.Invitation.Id
	if _, err := client.ResendTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.ResendTenantAdminInvitationRequest{
		TenantId:     tenantID,
		InvitationId: invitationID,
	})); err != nil {
		t.Fatalf("ResendTenantAdminInvitation: %v", err)
	}
	if _, err := client.CancelTenantAdminInvitation(ctx, newDBAuthedRequest(operator, publirasplatformv1.CancelTenantAdminInvitationRequest{
		TenantId:     tenantID,
		InvitationId: invitationID,
	})); err != nil {
		t.Fatalf("CancelTenantAdminInvitation: %v", err)
	}
	invitations, err := client.ListTenantAdminInvitations(ctx, newDBAuthedRequest(operator, publirasplatformv1.ListTenantAdminInvitationsRequest{TenantId: tenantID}))
	if err != nil {
		t.Fatalf("ListTenantAdminInvitations: %v", err)
	}
	if len(invitations.Msg.Invitations) != 1 || invitations.Msg.Invitations[0].Status != "canceled" {
		t.Fatalf("invitations = %+v, want the one canceled invitation", invitations.Msg.Invitations)
	}

	if _, err := client.ListTenantMembers(ctx, newDBAuthedRequest(operator, publirasplatformv1.ListTenantMembersRequest{TenantId: "TENANTAAAAAA"})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a public ID as tenant_id: code = %v, want invalid_argument", connect.CodeOf(err))
	}
}
