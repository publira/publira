package platformapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
)

// The platform console's password reset form belongs to no tenant, and takes an
// address from anyone who can reach it, so the mail behind it is bounded the
// same way a storefront's is.
func TestDBPlatformRequestPasswordResetStopsAtTheLimit(t *testing.T) {
	ts, pg := newDBIntegrationEnvWithMailGuard(t, mailGuardWith(platformpolicy.HourDay{PerHour: 1, PerDay: 100}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}))
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

	if got := countOutboxEvents(t, pg, outbox.EventTypePlatformPasswordResetRequest); got != 1 {
		t.Fatalf("recorded reset requests = %d, want the one the allowance paid for", got)
	}
}
