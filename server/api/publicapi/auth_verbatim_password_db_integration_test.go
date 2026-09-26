package publicapi

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// spacedPassword is a password whose surrounding spaces are part of what the
// reader typed, so every form that sets or checks one has to keep them.
const spacedPassword = "  correct horse battery staple  "

// assertSignsInOnlyAsTyped signs in with the password as typed, then with its
// spaces trimmed, and returns the session the first attempt opened.
func assertSignsInOnlyAsTyped(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, email, password string) string {
	t.Helper()

	client := env.authClient()
	login, err := client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    email,
		Password: password,
	}))
	if err != nil {
		t.Fatalf("Login with the password as typed: %v", err)
	}
	_, err = client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    email,
		Password: strings.TrimSpace(password),
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login with the password trimmed code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
	return login.Msg.AccessToken.GetToken()
}

func TestDBCreateUserKeepsThePasswordAsTyped(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	client := env.authClient()

	if _, err := client.CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:   tenantContext(tenant),
		Name:     "Newcomer",
		Email:    "newcomer@tenant-a.example.com",
		Password: spacedPassword,
	})); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	env.processReaderAuthRequests(t)

	var token string
	if err := env.PG.DB.QueryRow(`
		SELECT payload ->> 'token' FROM outbox_events
		WHERE event_type = 'reader_email_verification_email'
	`).Scan(&token); err != nil {
		t.Fatalf("read the queued verification link: %v", err)
	}
	if _, err := client.VerifyUserEmail(context.Background(), connect.NewRequest(&publirav1.VerifyUserEmailRequest{
		Tenant: tenantContext(tenant),
		Token:  token,
	})); err != nil {
		t.Fatalf("VerifyUserEmail: %v", err)
	}

	assertSignsInOnlyAsTyped(t, env, tenant, "newcomer@tenant-a.example.com", spacedPassword)
}

func TestDBConfirmPasswordResetKeepsThePasswordAsTyped(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	if _, err := client.RequestPasswordReset(context.Background(), connect.NewRequest(&publirav1.RequestPasswordResetRequest{
		Tenant: tenantContext(tenant),
		Email:  user.Email,
	})); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	env.processReaderAuthRequests(t)

	var token string
	if err := env.PG.DB.QueryRow(`
		SELECT payload ->> 'token' FROM outbox_events
		WHERE event_type = 'reader_password_reset_email'
	`).Scan(&token); err != nil {
		t.Fatalf("read the queued reset link: %v", err)
	}
	if _, err := client.ConfirmPasswordReset(context.Background(), connect.NewRequest(&publirav1.ConfirmPasswordResetRequest{
		Tenant:      tenantContext(tenant),
		Token:       token,
		NewPassword: spacedPassword,
	})); err != nil {
		t.Fatalf("ConfirmPasswordReset: %v", err)
	}

	assertSignsInOnlyAsTyped(t, env, tenant, user.Email, spacedPassword)
}

// Every check of the current password compares what was typed, so the password
// without its spaces is as wrong there as it is on the sign-in form.
func TestDBChangePasswordKeepsThePasswordAsTyped(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	if _, err := client.ChangePassword(context.Background(), newBearerRequest(
		&publirav1.ChangePasswordRequest{
			Tenant:          tenantContext(tenant),
			CurrentPassword: testutil.SeededPassword,
			NewPassword:     spacedPassword,
		},
		tokenFor(t, tenant, user),
	)); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	token := assertSignsInOnlyAsTyped(t, env, tenant, user.Email, spacedPassword)
	trimmed := strings.TrimSpace(spacedPassword)

	_, err := client.ChangePassword(context.Background(), newBearerRequest(
		&publirav1.ChangePasswordRequest{
			Tenant:          tenantContext(tenant),
			CurrentPassword: trimmed,
			NewPassword:     "a-brand-new-password",
		},
		token,
	))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ChangePassword with the current password trimmed code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, "current_password")

	_, err = client.RequestEmailChange(context.Background(), newBearerRequest(
		&publirav1.RequestEmailChangeRequest{
			Tenant:          tenantContext(tenant),
			CurrentEmail:    user.Email,
			NewEmail:        "moved@tenant-a.example.com",
			CurrentPassword: trimmed,
		},
		token,
	))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("RequestEmailChange with the current password trimmed code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, "current_password")

	_, err = client.DeleteMe(context.Background(), newBearerRequest(
		&publirav1.DeleteMeRequest{Tenant: tenantContext(tenant), Password: trimmed},
		token,
	))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("DeleteMe with the password trimmed code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}
