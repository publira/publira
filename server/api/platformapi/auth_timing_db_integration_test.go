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

// The password reset form answers a registered address exactly as it answers an
// unknown one, so it must also take as long to do it, or the time it takes is
// the answer.
func TestDBRequestPasswordResetTakesAsLongForARegisteredAddressAsForAnUnknownOne(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	requestReset := func(email string) error {
		_, err := authClient.RequestPasswordReset(context.Background(), &publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
			Email: email,
		})
		return err
	}
	testutil.AssertIndistinguishableTimings(t,
		func(int) error { return requestReset(operator.Email) },
		func(int) error { return requestReset("stranger@example.com") },
	)
}
