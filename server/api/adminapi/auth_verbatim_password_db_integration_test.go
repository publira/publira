package adminapi

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

// spacedPassword is a password whose surrounding spaces are part of what the
// admin typed, so every form that sets or checks one has to keep them.
const spacedPassword = "  correct horse battery staple  "

// assertSignsInOnlyAsTyped signs in with the password as typed, then with its
// spaces trimmed, and returns the session the first attempt opened.
func assertSignsInOnlyAsTyped(t *testing.T, env *adminDBEnv, tenant adminDBTenant, email, password string) string {
	t.Helper()

	client := env.authClient()
	login, err := client.Login(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    email,
		Password: password,
	}))
	if err != nil {
		t.Fatalf("Login with the password as typed: %v", err)
	}
	_, err = client.Login(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    email,
		Password: strings.TrimSpace(password),
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login with the password trimmed code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
	return login.Msg.AccessToken.GetToken()
}

func TestDBAcceptTenantAdminInvitationKeepsThePasswordAsTyped(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := context.Background()

	if _, err := env.tenantMemberClient().CreateTenantAdminInvitation(ctx, newAdminDBRequest(tenant, &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Email: "invitee@tenant-a.example.com",
	})); err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	events := env.pendingOutboxEvents(t, outbox.EventTypeTenantAdminInvitationEmail)
	if len(events) != 1 {
		t.Fatalf("pending invitation events = %d, want 1", len(events))
	}
	var invitation outbox.TenantAdminInvitationPayload
	if err := json.Unmarshal(events[0].Payload, &invitation); err != nil {
		t.Fatalf("decode invitation payload: %v", err)
	}

	if _, err := env.authClient().AcceptTenantAdminInvitation(ctx, connect.NewRequest(&publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
		Tenant:   tenant.tenantContext(),
		Token:    invitation.Token,
		Name:     "Invitee",
		Password: spacedPassword,
	})); err != nil {
		t.Fatalf("AcceptTenantAdminInvitation: %v", err)
	}

	assertSignsInOnlyAsTyped(t, env, tenant, "invitee@tenant-a.example.com", spacedPassword)
}

// The current password an address change asks for is compared as typed too, so
// the password without its spaces is as wrong there as on the sign-in form.
func TestDBAdminConfirmPasswordResetKeepsThePasswordAsTyped(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.authClient()
	ctx := context.Background()

	if _, err := client.RequestPasswordReset(ctx, connect.NewRequest(&publiraadminv1.AdminAuthServiceRequestPasswordResetRequest{
		Tenant: tenant.tenantContext(),
		Email:  tenant.User.Email,
	})); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	events := env.pendingOutboxEvents(t, outbox.EventTypeAdminPasswordResetEmail)
	if len(events) != 1 {
		t.Fatalf("pending reset events = %d, want 1", len(events))
	}
	var reset outbox.AdminPasswordResetEmailPayload
	if err := json.Unmarshal(events[0].Payload, &reset); err != nil {
		t.Fatalf("decode reset payload: %v", err)
	}

	if _, err := client.ConfirmPasswordReset(ctx, connect.NewRequest(&publiraadminv1.AdminAuthServiceConfirmPasswordResetRequest{
		Tenant:      tenant.tenantContext(),
		Token:       reset.Token,
		NewPassword: spacedPassword,
	})); err != nil {
		t.Fatalf("ConfirmPasswordReset: %v", err)
	}
	token := assertSignsInOnlyAsTyped(t, env, tenant, tenant.User.Email, spacedPassword)

	req := connect.NewRequest(&publiraadminv1.AdminAuthServiceRequestEmailChangeRequest{
		Tenant:          tenant.tenantContext(),
		CurrentEmail:    tenant.User.Email,
		NewEmail:        "moved@tenant-a.example.com",
		CurrentPassword: strings.TrimSpace(spacedPassword),
	})
	req.Header().Set("Authorization", "Bearer "+token)
	_, err := client.RequestEmailChange(ctx, req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("RequestEmailChange with the current password trimmed code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertBadRequestField(t, err, "current_password")
}
