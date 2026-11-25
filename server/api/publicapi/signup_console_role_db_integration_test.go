package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// A storefront sign-up for a staff member's address, made by someone else and
// confirmed by the address's owner following the link it mailed, leaves an
// account whose password the person who signed up chose. None of the console's
// ways of giving a role may take that password as the owner's.

const (
	signupStaffEmail    = "staff@tenant-a.example.com"
	signupChosenByOther = "chosen-by-whoever-signed-up"
	signupOwnPassword   = "the address owner's own password"
)

// signupConsole is the tenant console as a Tenant admin of the tenant drives
// it, beside the storefront the sign-up was made on.
type signupConsole struct {
	members publiraadminv1connect.AdminTenantMemberServiceClient
	auth    publiraadminv1connect.AdminAuthServiceClient
	token   string
	tenant  *publirattypesv1.TenantContext
}

func (e *publicDBEnv) openSignupConsole(t *testing.T, tenant testutil.Tenant) signupConsole {
	t.Helper()

	admin := e.PG.SeedTenantAdmin(t, tenant.ID, "SIGNADMIN", "admin@tenant-a.example.com", "Admin")
	console := e.openAdminConsole(t, tenant, admin)
	client := connect.NewClient(connecthttp.NewTransport(console.server.Client(), console.server.URL))
	return signupConsole{
		members: publiraadminv1connect.NewAdminTenantMemberServiceClient(client),
		auth:    publiraadminv1connect.NewAdminAuthServiceClient(client),
		token:   console.token,
		tenant:  &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
	}
}

// signUpAndConfirm signs up with the staff address and the password someone
// other than its owner chose, and follows the confirmation link the sign-up
// mailed to it, as the address's owner would.
func (e *publicDBEnv) signUpAndConfirm(t *testing.T, tenant testutil.Tenant) {
	t.Helper()

	client := e.authClient()
	if _, err := client.CreateUser(context.Background(), &publirav1.CreateUserRequest{
		Tenant:   tenantContext(tenant),
		Name:     "Someone Else",
		Email:    signupStaffEmail,
		Password: signupChosenByOther,
	}); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	e.processReaderAuthRequests(t)
	if _, err := client.VerifyUserEmail(context.Background(), &publirav1.VerifyUserEmailRequest{
		Tenant: tenantContext(tenant),
		Token:  e.queuedToken(t, "reader_email_verification_email"),
	}); err != nil {
		t.Fatalf("VerifyUserEmail: %v", err)
	}
}

// queuedToken reads the link token of the one queued mail of eventType.
func (e *publicDBEnv) queuedToken(t *testing.T, eventType string) string {
	t.Helper()
	var token string
	if err := e.PG.DB.QueryRow(`
		SELECT payload ->> 'token' FROM outbox_events WHERE event_type = $1
	`, eventType).Scan(&token); err != nil {
		t.Fatalf("read the queued %s link: %v", eventType, err)
	}
	return token
}

func (c signupConsole) invite(t *testing.T) *publiraadminv1.CreateTenantAdminInvitationResponse {
	t.Helper()
	res, err := c.members.CreateTenantAdminInvitation(testutil.WithBearer(context.Background(), c.token), &publiraadminv1.CreateTenantAdminInvitationRequest{
		Tenant: c.tenant, Email: signupStaffEmail, Role: auth.RoleTenantEditor,
	})
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	return res
}

func (c signupConsole) login(password string) (*publiraadminv1.AdminAuthServiceLoginResponse, error) {
	return c.auth.Login(context.Background(), &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant: c.tenant, Email: signupStaffEmail, Password: password,
	})
}

func (e *publicDBEnv) staffRoles(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.PG.DB.QueryRow(`
		SELECT count(*) FROM tenant_user_roles r JOIN users u ON u.id = r.user_id WHERE u.email = $1
	`, signupStaffEmail).Scan(&n); err != nil {
		t.Fatalf("count roles: %v", err)
	}
	return n
}

func TestDBInvitingAConfirmedSignUpMailsAnInvitation(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	console := env.openSignupConsole(t, tenant)
	env.signUpAndConfirm(t, tenant)

	invited := console.invite(t)
	if invited.RoleGrantedImmediately {
		t.Fatal("role_granted_immediately = true for a confirmed sign-up, want an invitation mailed")
	}
	if invited.Invitation.GetEmail() != signupStaffEmail {
		t.Fatalf("invitation email = %q, want %q", invited.Invitation.GetEmail(), signupStaffEmail)
	}
	if n := env.staffRoles(t); n != 0 {
		t.Fatalf("roles after inviting = %d, want none until the invitation is accepted", n)
	}
	if _, err := console.login(signupChosenByOther); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("console login with the sign-up's password: code = %v, want unauthenticated (err = %v)", connect.CodeOf(err), err)
	}
}

func TestDBAddingAConfirmedSignUpIsRefused(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	console := env.openSignupConsole(t, tenant)
	env.signUpAndConfirm(t, tenant)

	_, err := console.members.AddTenantMember(testutil.WithBearer(context.Background(), console.token), &publiraadminv1.AddTenantMemberRequest{
		Tenant: console.tenant, Email: signupStaffEmail, Role: auth.RoleTenantEditor,
	})
	assertReason(t, err, connect.CodeFailedPrecondition, rpcerrors.ReasonAccountUnconfirmed)
	if n := env.staffRoles(t); n != 0 {
		t.Fatalf("roles after a refused add = %d, want none", n)
	}
}

// Accepting the invitation for a confirmed sign-up asks for a new name and
// password, and the password chosen at sign-up stops working everywhere, along
// with every session it signed in.
func TestDBAcceptingAnInvitationReplacesThePasswordOfAConfirmedSignUp(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	console := env.openSignupConsole(t, tenant)
	env.signUpAndConfirm(t, tenant)

	storefront, err := env.authClient().Login(context.Background(), &publirav1.LoginRequest{
		Tenant: tenantContext(tenant), Email: signupStaffEmail, Password: signupChosenByOther,
	})
	if err != nil {
		t.Fatalf("storefront login with the sign-up's password: %v", err)
	}

	console.invite(t)
	invitationToken := env.queuedToken(t, outbox.EventTypeTenantAdminInvitationEmail)

	state, err := console.auth.GetTenantAdminInvitationState(context.Background(), &publiraadminv1.AdminAuthServiceGetTenantAdminInvitationStateRequest{
		Tenant: console.tenant, Token: invitationToken,
	})
	if err != nil {
		t.Fatalf("GetTenantAdminInvitationState: %v", err)
	}
	if state.AccountExists {
		t.Fatal("account_exists = true for a confirmed sign-up, want the invitee asked for a name and password")
	}

	_, err = console.auth.AcceptTenantAdminInvitation(context.Background(), &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
		Tenant: console.tenant, Token: invitationToken,
	})
	if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
		t.Fatalf("accept without a password: code = %v, want invalid_argument (err = %v)", code, err)
	}
	if n := env.staffRoles(t); n != 0 {
		t.Fatalf("roles after a refused acceptance = %d, want none", n)
	}

	if _, err := console.auth.AcceptTenantAdminInvitation(context.Background(), &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
		Tenant: console.tenant, Token: invitationToken, Name: "Staff", Password: signupOwnPassword,
	}); err != nil {
		t.Fatalf("AcceptTenantAdminInvitation: %v", err)
	}

	if _, err := console.login(signupChosenByOther); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("console login with the sign-up's password: code = %v, want unauthenticated (err = %v)", connect.CodeOf(err), err)
	}
	loggedIn, err := console.login(signupOwnPassword)
	if err != nil {
		t.Fatalf("console login with the invitee's password: %v", err)
	}
	if loggedIn.User.GetName() != "Staff" || loggedIn.User.GetRole() != auth.RoleTenantEditor {
		t.Fatalf("console user = %+v, want Staff as %s", loggedIn.User, auth.RoleTenantEditor)
	}
	if _, err := env.authClient().Login(context.Background(), &publirav1.LoginRequest{
		Tenant: tenantContext(tenant), Email: signupStaffEmail, Password: signupChosenByOther,
	}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("storefront login with the sign-up's password: code = %v, want unauthenticated (err = %v)", connect.CodeOf(err), err)
	}
	_, err = env.authClient().GetMe(testutil.WithBearer(context.Background(), storefront.AccessToken.GetToken()), &publirav1.GetMeRequest{
		Tenant: tenantContext(tenant),
	})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("storefront session signed in with the sign-up's password: code = %v, want unauthenticated (err = %v)", connect.CodeOf(err), err)
	}
}

// Changing the password while signed in proves only that the caller knew the
// one it replaces, which was the sign-up's.
func TestDBChangingASignUpsPasswordDoesNotProveIt(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	console := env.openSignupConsole(t, tenant)
	env.signUpAndConfirm(t, tenant)

	client := env.authClient()
	login, err := client.Login(context.Background(), &publirav1.LoginRequest{
		Tenant: tenantContext(tenant), Email: signupStaffEmail, Password: signupChosenByOther,
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if _, err := client.ChangePassword(testutil.WithBearer(context.Background(), login.AccessToken.GetToken()), &publirav1.ChangePasswordRequest{
		Tenant: tenantContext(tenant), CurrentPassword: signupChosenByOther, NewPassword: "changed-by-the-same-person",
	}); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}

	if console.invite(t).RoleGrantedImmediately {
		t.Fatal("role_granted_immediately = true after a password change, want an invitation mailed")
	}
}

// Resetting the password through the link mailed to the address is what
// proves it, and the account is then given the role on the spot.
func TestDBResettingASignUpsPasswordProvesIt(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	console := env.openSignupConsole(t, tenant)
	env.signUpAndConfirm(t, tenant)

	client := env.authClient()
	if _, err := client.RequestPasswordReset(context.Background(), &publirav1.RequestPasswordResetRequest{
		Tenant: tenantContext(tenant), Email: signupStaffEmail,
	}); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	env.processReaderAuthRequests(t)
	if _, err := client.ConfirmPasswordReset(context.Background(), &publirav1.ConfirmPasswordResetRequest{
		Tenant: tenantContext(tenant), Token: env.queuedToken(t, "reader_password_reset_email"), NewPassword: signupOwnPassword,
	}); err != nil {
		t.Fatalf("ConfirmPasswordReset: %v", err)
	}

	if !console.invite(t).RoleGrantedImmediately {
		t.Fatal("role_granted_immediately = false after a password reset, want the role given on the spot")
	}
	if n := env.staffRoles(t); n != 1 {
		t.Fatalf("roles = %d, want 1", n)
	}
	if _, err := console.login(signupOwnPassword); err != nil {
		t.Fatalf("console login with the reset password: %v", err)
	}
}
