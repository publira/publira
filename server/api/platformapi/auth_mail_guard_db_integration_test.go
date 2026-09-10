package platformapi

import (
	"context"
	"log/slog"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/outbox"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/ratelimit"
)

// The platform console's password reset form belongs to no tenant, and takes an
// address from anyone who can reach it, so the mail behind it is bounded the
// same way a storefront's is.
func TestDBPlatformRequestPasswordResetStopsAtTheLimit(t *testing.T) {
	ts, pg := newDBIntegrationEnvWithMailGuard(t, mailguard.New(
		ratelimit.New(ratelimit.NewMemoryStore()),
		mailguard.Rules(1, 100),
		mailguard.Rules(1000, 1000),
		slog.Default(),
	))
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)

	requestReset := func() error {
		_, err := authClient.RequestPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
			Email: operator.Email,
		}))
		return err
	}

	if err := requestReset(); err != nil {
		t.Fatalf("the first RequestPasswordReset: %v", err)
	}
	if err := requestReset(); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second RequestPasswordReset code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}

	if got := countOutboxEvents(t, pg, outbox.EventTypePlatformPasswordResetEmail); got != 1 {
		t.Fatalf("queued reset emails = %d, want the one the allowance paid for", got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_password_reset_tokens"); got != 1 {
		t.Fatalf("password reset token rows = %d, want the refused request to have written none", got)
	}
}
