package platformapi

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/outbox"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
)

// A password whose surrounding spaces are part of what the operator typed is
// stored and checked with them: the sign-in form sends it as typed, and so does
// every other form that asks for it. The current password an address change
// asks for is compared as typed too.
func TestDBConfirmPasswordResetKeepsThePasswordAsTyped(t *testing.T) {
	const spacedPassword = "  correct horse battery staple  "
	trimmed := strings.TrimSpace(spacedPassword)
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)
	ctx := context.Background()

	if _, err := authClient.RequestPasswordReset(ctx, connect.NewRequest(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
		Email: operator.Email,
	})); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	if _, err := authClient.ConfirmPasswordReset(ctx, connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmPasswordResetRequest{
		Token:       platformOutboxToken(t, pg, outbox.EventTypePlatformPasswordResetEmail, ""),
		NewPassword: spacedPassword,
	})); err != nil {
		t.Fatalf("ConfirmPasswordReset: %v", err)
	}

	login, err := authClient.Login(ctx, connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    operator.Email,
		Password: spacedPassword,
	}))
	if err != nil {
		t.Fatalf("Login with the password as typed: %v", err)
	}
	_, err = authClient.Login(ctx, connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    operator.Email,
		Password: trimmed,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login with the password trimmed code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}

	_, err = authClient.RequestEmailChange(ctx, newDBBearerRequest(login.Msg.AccessToken.GetToken(), publirasplatformv1.PlatformAuthServiceRequestEmailChangeRequest{
		CurrentEmail:    operator.Email,
		NewEmail:        "moved@example.com",
		CurrentPassword: trimmed,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("RequestEmailChange with the current password trimmed code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertFieldViolation(t, err, "current_password")
}
