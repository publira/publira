package platformapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// Signing out ends the session it was made with, so a copy of that token is
// refused from then on, while the operator's other sessions carry on.
func TestDBLogoutEndsTheSessionItSignsOutOf(t *testing.T) {
	t.Parallel()

	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	login := func() string {
		t.Helper()
		resp, err := authClient.Login(context.Background(), &publirasplatformv1.PlatformAuthServiceLoginRequest{
			Email:    operator.Email,
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
		_, err := authClient.GetMe(testutil.WithBearer(context.Background(), token), &publirasplatformv1.PlatformAuthServiceGetMeRequest{})
		return err
	}
	logout := func(token string) {
		t.Helper()
		if _, err := authClient.Logout(testutil.WithBearer(context.Background(), token), &publirasplatformv1.PlatformAuthServiceLogoutRequest{}); err != nil {
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
		t.Fatalf("GetMe with the operator's other session: %v", err)
	}

	// The token has nothing left to end, so a second sign-out with it still
	// succeeds and records nothing more.
	logout(signedOut)
	if got := countRows(t, pg, `SELECT count(*) FROM platform_user_signed_out_sessions WHERE platform_user_id = $1 AND expires_at > now()`, operator.ID); got != 1 {
		t.Fatalf("signed-out sessions = %d, want 1", got)
	}
}
