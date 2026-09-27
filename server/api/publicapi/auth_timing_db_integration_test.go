package publicapi

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The forms that answer a registered address exactly as they answer a free one
// must also take as long to do it, or the time they take is the answer.

func TestDBCreateUserTakesAsLongForARegisteredAddressAsForAFreeOne(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	signUp := func(email string) error {
		_, err := client.CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
			Tenant:   tenantContext(tenant),
			Name:     "Signup",
			Email:    email,
			Password: "signup-password",
		}))
		return err
	}
	testutil.AssertIndistinguishableTimings(t,
		func(int) error { return signUp(member.Email) },
		func(sample int) error {
			return signUp(fmt.Sprintf("free-%d@tenant-a.example.com", sample+testutil.TimingWarmup))
		},
	)
}

func TestDBRequestPasswordResetTakesAsLongForARegisteredAddressAsForAFreeOne(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	requestReset := func(email string) error {
		_, err := client.RequestPasswordReset(context.Background(), connect.NewRequest(&publirav1.RequestPasswordResetRequest{
			Tenant: tenantContext(tenant),
			Email:  email,
		}))
		return err
	}
	testutil.AssertIndistinguishableTimings(t,
		func(int) error { return requestReset(member.Email) },
		func(int) error { return requestReset("stranger@tenant-a.example.com") },
	)
}

// The unverified account is the case that is mailed a link, so it is the one
// that would take longest; the unknown address is the one that would take the
// least.
func TestDBRequestEmailVerificationTakesAsLongForARegisteredAddressAsForAFreeOne(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0001", "pending@tenant-a.example.com", "Pending")
	client := env.authClient()

	requestLink := func(email string) error {
		_, err := client.RequestEmailVerification(context.Background(), connect.NewRequest(&publirav1.RequestEmailVerificationRequest{
			Tenant: tenantContext(tenant),
			Email:  email,
		}))
		return err
	}
	testutil.AssertIndistinguishableTimings(t,
		func(int) error { return requestLink(pending.Email) },
		func(int) error { return requestLink("stranger@tenant-a.example.com") },
	)
}
