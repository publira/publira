package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Member sign-in is decided by three columns the sqlmock tests can only assert
// about indirectly: the tenant a users row belongs to, its status and
// email_verified_at, and the credentials_version an issued token was minted
// against. These cases drive them against a real database.

func TestDBLoginIssuesTokenAcceptedByGetMe(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	login, err := client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    user.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if login.Msg.User.PublicId != user.PublicID {
		t.Fatalf("login public_id = %q, want %q", login.Msg.User.PublicId, user.PublicID)
	}
	if login.Msg.AccessToken.GetToken() == "" {
		t.Fatal("login access_token is empty")
	}

	me, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		login.Msg.AccessToken.Token,
	))
	if err != nil {
		t.Fatalf("GetMe with the login token: %v", err)
	}
	if me.Msg.User.PublicId != user.PublicID {
		t.Fatalf("GetMe public_id = %q, want %q", me.Msg.User.PublicId, user.PublicID)
	}
}

func TestDBLoginRejectsWrongPasswordAndUnknownEmail(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	cases := []struct {
		name     string
		email    string
		password string
	}{
		{"wrong_password", user.Email, "not-the-password"},
		{"unknown_email", "nobody@tenant-a.example.com", testutil.SeededPassword},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
				Tenant:   tenantContext(tenant),
				Email:    tc.email,
				Password: tc.password,
			}))
			if connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("Login code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
			}
		})
	}
}

// Signup leaves the account inactive until the address is confirmed, and the
// password alone must not get past that.
func TestDBLoginRejectsUnverifiedAccount(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0002", "pending@tenant-a.example.com", "Pending Member")

	_, err := env.authClient().Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    pending.Email,
		Password: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("Login code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
}

// Two storefronts share one users table, so the credentials of one tenant's
// member must be worthless at another tenant's login form.
func TestDBLoginRejectsMemberOfAnotherTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	theirMember := env.PG.SeedEndUser(t, second.ID, "ENDUSERB0001", "member@tenant-b.example.com", "Tenant B Member")

	_, err := env.authClient().Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(first),
		Email:    theirMember.Email,
		Password: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login across tenants code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// A password reset or an account deletion bumps credentials_version, which is
// what makes the tokens already handed out stop working.
func TestDBAccessTokenStopsWorkingAfterCredentialsVersionBump(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	login, err := client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    user.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	issuedToken := login.Msg.AccessToken.Token

	env.bumpCredentialsVersion(t, user.ID)

	_, err = client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		issuedToken,
	))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with the pre-bump token code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}

	// The password itself is untouched, so a fresh login must still work and hand
	// back a token minted against the new version.
	relogin, err := client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    user.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login after the bump: %v", err)
	}
	if _, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		relogin.Msg.AccessToken.Token,
	)); err != nil {
		t.Fatalf("GetMe with the reissued token: %v", err)
	}
}

func TestDBAccessTokenStopsWorkingWhenAccountIsSuspended(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	token := tokenFor(t, tenant, user)
	client := env.authClient()

	if _, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		token,
	)); err != nil {
		t.Fatalf("GetMe before suspension: %v", err)
	}

	env.suspendUser(t, user.ID)

	_, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		token,
	))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe while suspended code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// The confirmation password on account deletion is form input, not credentials.
// Getting it wrong must not read as "your session ended" — clients turn
// Unauthenticated into a forced re-login, which would log a reader out over a
// typo (#679).
func TestDBDeleteMeRejectsWrongPasswordAsInvalidArgument(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	token := tokenFor(t, tenant, user)
	client := env.authClient()

	_, err := client.DeleteMe(context.Background(), newBearerRequest(
		&publirav1.DeleteMeRequest{Tenant: tenantContext(tenant), Password: "not-the-password"},
		token,
	))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("DeleteMe with a wrong password code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, "password")

	// The session is untouched, so the reader can correct the field and retry.
	if _, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		token,
	)); err != nil {
		t.Fatalf("GetMe after a rejected DeleteMe: %v", err)
	}
}

func assertPublicBadRequestField(t *testing.T, err error, wantField string) {
	t.Helper()
	rpcError, ok := err.(*connect.Error)
	if !ok {
		t.Fatalf("error type = %T, want *connect.Error", err)
	}
	if len(rpcError.Details()) != 1 {
		t.Fatalf("detail count = %d, want 1", len(rpcError.Details()))
	}
	detail, detailErr := rpcError.Details()[0].Value()
	if detailErr != nil {
		t.Fatalf("detail = %v", detailErr)
	}
	badRequest, ok := detail.(*errdetails.BadRequest)
	if !ok || len(badRequest.FieldViolations) != 1 || badRequest.FieldViolations[0].Field != wantField {
		t.Fatalf("field violations = %#v, want %q", badRequest, wantField)
	}
}

// A valid session at one storefront must not carry over to another, even though
// both are served by the same process and the same signing key.
func TestDBGetMeRejectsTokenMintedForAnotherTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	theirMember := env.PG.SeedEndUser(t, second.ID, "ENDUSERB0001", "member@tenant-b.example.com", "Tenant B Member")
	theirToken := tokenFor(t, second, theirMember)

	_, err := env.authClient().GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(first)},
		theirToken,
	))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with another tenant's token code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}
