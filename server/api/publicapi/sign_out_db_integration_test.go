package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Signing out ends the session it was made with, so a copy of that token is
// refused from then on, while the reader's other sessions — another browser,
// the app — carry on.
func TestDBLogoutEndsTheSessionItSignsOutOf(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "SIGNOUTTEN01", "sign-out.example.com", "Sign Out")
	user := env.PG.SeedEndUser(t, tenant.ID, "SIGNOUTUSR01", "reader@sign-out.example.com", "Reader")
	client := env.authClient()

	login := func() string {
		t.Helper()
		resp, err := client.Login(context.Background(), &publirav1.LoginRequest{
			Tenant:   tenantContext(tenant),
			Email:    user.Email,
			Password: testutil.SeededPassword,
		})
		if err != nil {
			t.Fatalf("Login: %v", err)
		}
		if resp.GetAccessToken().GetToken() == "" {
			t.Fatal("Login issued no access token")
		}
		return resp.AccessToken.Token
	}
	getMe := func(token string) error {
		_, err := client.GetMe(testutil.WithBearer(context.Background(), token), &publirav1.GetMeRequest{Tenant: tenantContext(tenant)})
		return err
	}
	logout := func(token string) {
		t.Helper()
		if _, err := client.Logout(testutil.WithBearer(context.Background(), token), &publirav1.LogoutRequest{Tenant: tenantContext(tenant)}); err != nil {
			t.Fatalf("Logout: %v", err)
		}
	}

	signedOut := login()
	other := login()
	if err := getMe(signedOut); err != nil {
		t.Fatalf("GetMe before signing out: %v", err)
	}
	logout(signedOut)

	if err := getMe(signedOut); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with the signed-out token code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
	if err := getMe(other); err != nil {
		t.Fatalf("GetMe with the reader's other session: %v", err)
	}

	// The token has nothing left to end, so a second sign-out with it still
	// succeeds and records nothing more.
	logout(signedOut)
	var rows int
	if err := env.PG.DB.QueryRowContext(context.Background(), `
		SELECT count(*) FROM user_signed_out_sessions WHERE user_id = $1 AND expires_at > now()
	`, user.ID).Scan(&rows); err != nil {
		t.Fatalf("count signed-out sessions: %v", err)
	}
	if rows != 1 {
		t.Fatalf("signed-out sessions = %d, want 1", rows)
	}
}
