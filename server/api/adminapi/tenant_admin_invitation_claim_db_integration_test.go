package adminapi

import (
	"context"
	"database/sql"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// adminLogin signs in to the console with password and answers the error.
func (e *adminDBEnv) adminLogin(t *testing.T, tenant adminDBTenant, email, password string) (*publiraadminv1.AdminAuthServiceLoginResponse, error) {
	t.Helper()
	return e.authClient().Login(context.Background(), &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    email,
		Password: password,
	})
}

func (e *adminDBEnv) invitationStatus(t *testing.T, tenant adminDBTenant, token string) *publiraadminv1.AdminAuthServiceGetTenantAdminInvitationStateResponse {
	t.Helper()
	state, err := e.authClient().GetTenantAdminInvitationState(context.Background(), &publiraadminv1.AdminAuthServiceGetTenantAdminInvitationStateRequest{
		Tenant: tenant.tenantContext(), Token: token,
	})
	if err != nil {
		t.Fatalf("GetTenantAdminInvitationState: %v", err)
	}
	return state
}

// Someone who signs up on the storefront with the address a tenant is about to
// invite leaves an account carrying a password of their own. Accepting the
// invitation hands that account to the invitee with the password they give,
// and the one set at sign-up never reaches the console.
func TestDBAcceptingAnInvitationReplacesThePasswordOfAnUnconfirmedSignUp(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := context.Background()

	const token = "invitation-over-a-sign-up"
	const email = "invitee@tenant-a.example.com"
	const invitedPassword = "the invitee's own password"
	// The sign-up's password is testutil.SeededPassword, chosen by whoever
	// typed the address in.
	squatter := env.PG.SeedUnverifiedEndUser(t, tenant.Tenant.ID, "TASQUATTER", email, "Squatter")
	env.seedAdminInvitation(t, tenant, email, token)

	if state := env.invitationStatus(t, tenant, token); state.AccountExists {
		t.Fatal("account_exists = true for an address nobody confirmed, want the invitee asked for a password")
	}

	_, err := env.authClient().AcceptTenantAdminInvitation(ctx, &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Token: token,
	})
	if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
		t.Fatalf("accept without a password: code = %v, want invalid_argument (err = %v)", code, err)
	}
	if role := env.roleOf(t, squatter); role != "" {
		t.Fatalf("roles after a refused acceptance = %q, want none", role)
	}
	if state := env.invitationStatus(t, tenant, token); state.Status != "pending" {
		t.Fatalf("invitation status after a refused acceptance = %q, want pending", state.Status)
	}

	accepted, err := env.authClient().AcceptTenantAdminInvitation(ctx, &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Token: token, Name: "Invitee", Password: invitedPassword,
	})
	if err != nil {
		t.Fatalf("AcceptTenantAdminInvitation: %v", err)
	}
	if !accepted.Accepted {
		t.Fatal("accepted = false")
	}

	if _, err := env.adminLogin(t, tenant, email, testutil.SeededPassword); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("login with the sign-up's password: code = %v, want unauthenticated (err = %v)", connect.CodeOf(err), err)
	}
	loggedIn, err := env.adminLogin(t, tenant, email, invitedPassword)
	if err != nil {
		t.Fatalf("login with the invitee's password: %v", err)
	}
	if loggedIn.User.PublicId != squatter.PublicID || loggedIn.User.Role != auth.RoleTenantAdmin {
		t.Fatalf("login user = %+v, want %s as %s", loggedIn.User, squatter.PublicID, auth.RoleTenantAdmin)
	}

	var (
		name               string
		status             string
		verifiedAt         sql.NullTime
		credentialsVersion int32
	)
	if err := env.PG.DB.QueryRowContext(ctx, `
		SELECT name, status, email_verified_at, credentials_version FROM users WHERE id = $1
	`, squatter.ID).Scan(&name, &status, &verifiedAt, &credentialsVersion); err != nil {
		t.Fatalf("load the claimed account: %v", err)
	}
	if name != "Invitee" || status != "active" || !verifiedAt.Valid {
		t.Fatalf("claimed account = (%q, %q, verified %v), want (\"Invitee\", \"active\", verified)", name, status, verifiedAt.Valid)
	}
	if credentialsVersion <= squatter.CredentialsVersion {
		t.Fatalf("credentials_version = %d, want it past %d so nothing signed before still works", credentialsVersion, squatter.CredentialsVersion)
	}
}

// Accepting never lifts a suspension: the account stays suspended, without the
// role, and the invitation stays pending for after an administrator decides.
func TestDBAcceptingAnInvitationRefusesASuspendedAccount(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := context.Background()

	const token = "invitation-for-a-suspended-reader"
	const email = "suspended@tenant-a.example.com"
	reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TASUSPENDED", email, "Suspended Reader")
	if _, err := env.PG.DB.ExecContext(ctx, `UPDATE users SET status = 'suspended' WHERE id = $1`, reader.ID); err != nil {
		t.Fatalf("suspend the reader: %v", err)
	}
	env.seedAdminInvitation(t, tenant, email, token)

	_, err := env.authClient().AcceptTenantAdminInvitation(ctx, &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest{
		Tenant: tenant.tenantContext(), Token: token,
	})
	if code := connect.CodeOf(err); code != connect.CodePermissionDenied {
		t.Fatalf("AcceptTenantAdminInvitation: code = %v, want permission_denied (err = %v)", code, err)
	}
	if role := env.roleOf(t, reader); role != "" {
		t.Fatalf("roles = %q, want none", role)
	}
	if n := env.countRows(t, `SELECT count(*) FROM users WHERE id = $1 AND status = 'suspended'`, reader.ID); n != 1 {
		t.Fatal("the account is no longer suspended")
	}
	if state := env.invitationStatus(t, tenant, token); state.Status != "pending" {
		t.Fatalf("invitation status = %q, want pending", state.Status)
	}
}

// A console role on an account whose address nobody confirmed does not make
// its password one to sign in with, and a session it already holds stops
// working.
func TestDBAdminSignInRefusesAMemberWhoseAddressWasNeverConfirmed(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	member := env.seedMember(t, tenant, "TAMEMBER", "member@tenant-a.example.com", auth.RoleTenantEditor)
	ctx := context.Background()

	loggedIn, err := env.adminLogin(t, tenant, member.Email, testutil.SeededPassword)
	if err != nil {
		t.Fatalf("Login before the address is cleared: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `UPDATE users SET email_verified_at = NULL WHERE id = $1`, member.ID); err != nil {
		t.Fatalf("clear email_verified_at: %v", err)
	}

	if _, err := env.adminLogin(t, tenant, member.Email, testutil.SeededPassword); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login: code = %v, want unauthenticated (err = %v)", connect.CodeOf(err), err)
	}
	_, err = env.authClient().GetMe(testutil.WithBearer(ctx, loggedIn.AccessToken.GetToken()), &publiraadminv1.AdminAuthServiceGetMeRequest{
		Tenant: tenant.tenantContext(),
	})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with the session held before: code = %v, want unauthenticated (err = %v)", connect.CodeOf(err), err)
	}
}
