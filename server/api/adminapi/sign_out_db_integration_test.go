package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Signing out ends the session it was made with, so a copy of that token is
// refused from then on, while the account's other sessions carry on.
func TestDBAdminLogoutEndsTheSessionItSignsOutOf(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "SIGNOUTTEN01", "sign-out.example.com", "Sign Out", "SIGNOUTADM01", "admin@sign-out.example.com")
	signedOut := mfaLogin(t, env, tenant).GetAccessToken().GetToken()
	other := mfaLogin(t, env, tenant).GetAccessToken().GetToken()
	if signedOut == "" || other == "" {
		t.Fatal("Login issued no access token")
	}

	getMe := func(token string) error {
		_, err := env.authClient().GetMe(testutil.WithBearer(context.Background(), token), &publiraadminv1.AdminAuthServiceGetMeRequest{
			Tenant: tenant.tenantContext(),
		})
		return err
	}
	logout := func(token string) {
		t.Helper()
		if _, err := env.authClient().Logout(testutil.WithBearer(context.Background(), token), &publiraadminv1.AdminAuthServiceLogoutRequest{
			Tenant: tenant.tenantContext(),
		}); err != nil {
			t.Fatalf("Logout: %v", err)
		}
	}

	if err := getMe(signedOut); err != nil {
		t.Fatalf("GetMe before signing out: %v", err)
	}
	logout(signedOut)

	if err := getMe(signedOut); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with the signed-out token code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
	if err := getMe(other); err != nil {
		t.Fatalf("GetMe with the account's other session: %v", err)
	}

	// The token has nothing left to end, so a second sign-out with it still
	// succeeds and records nothing more.
	logout(signedOut)
	var rows int
	if err := env.PG.DB.QueryRowContext(context.Background(), `
		SELECT count(*) FROM user_signed_out_sessions WHERE user_id = $1 AND expires_at > now()
	`, tenant.User.ID).Scan(&rows); err != nil {
		t.Fatalf("count signed-out sessions: %v", err)
	}
	if rows != 1 {
		t.Fatalf("signed-out sessions = %d, want 1", rows)
	}
}
