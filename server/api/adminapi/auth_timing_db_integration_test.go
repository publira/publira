package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The password reset form answers a registered address exactly as it answers an
// unknown one, so it must also take as long to do it, or the time it takes is
// the answer.
func TestDBAdminRequestPasswordResetTakesAsLongForARegisteredAddressAsForAnUnknownOne(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.authClient()

	requestReset := func(email string) error {
		_, err := client.RequestPasswordReset(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceRequestPasswordResetRequest{
			Tenant: tenant.tenantContext(),
			Email:  email,
		}))
		return err
	}
	testutil.AssertIndistinguishableTimings(t,
		func(int) error { return requestReset(tenant.User.Email) },
		func(int) error { return requestReset("stranger@tenant-a.example.com") },
	)
}
