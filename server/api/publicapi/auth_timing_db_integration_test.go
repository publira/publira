package publicapi

import (
	"context"
	"fmt"
	"math"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

// The forms that answer a registered address exactly as they answer a free one
// must also take as long to do it, or the time they take is the answer. These
// cases time them over the loopback interface, where no network noise hides a
// difference, and alternate the two addresses so a change in the machine's load
// falls on both alike.

const (
	timingWarmup  = 5
	timingSamples = 60
)

// timingFloor is the smallest gap a measurement is held to, which absorbs
// scheduler jitter on a loopback round trip.
const timingFloor = 500 * time.Microsecond

// timingTolerance is how far the median gap may stray from zero: three standard
// errors of that median, estimated from the spread of the gaps, and never less
// than the floor. The bcrypt hash a sign-up spends varies by milliseconds, so a
// fixed bound would either fail that form at random or pass anything the lighter
// forms do.
func timingTolerance(gaps []time.Duration) time.Duration {
	sorted := slices.Clone(gaps)
	slices.Sort(sorted)
	spread := sorted[len(sorted)*3/4] - sorted[len(sorted)/4]
	deviation := float64(spread) / 1.349
	standardError := 1.2533 * deviation / math.Sqrt(float64(len(gaps)))
	return max(timingFloor, time.Duration(3*standardError))
}

func assertIndistinguishableTimings(t *testing.T, registered, free func(sample int) error) {
	t.Helper()

	measure := func(call func(int) error, sample int) time.Duration {
		t.Helper()
		started := time.Now()
		if err := call(sample); err != nil {
			t.Fatalf("sample %d: %v", sample, err)
		}
		return time.Since(started)
	}
	for sample := range timingWarmup {
		measure(registered, -1-sample)
		measure(free, -1-sample)
	}

	// Each pair is timed back to back, so what the gap between its halves
	// measures is the work behind the two answers rather than the machine's
	// load at the time.
	gaps := make([]time.Duration, 0, timingSamples)
	for sample := range timingSamples {
		var registeredTime, freeTime time.Duration
		if sample%2 == 0 {
			registeredTime = measure(registered, sample)
			freeTime = measure(free, sample)
		} else {
			freeTime = measure(free, sample)
			registeredTime = measure(registered, sample)
		}
		gaps = append(gaps, registeredTime-freeTime)
	}

	gap, tolerance := median(gaps), timingTolerance(gaps)
	t.Logf("median gap %v between the registered address and the free one (tolerance %v)", gap, tolerance)
	if gap > tolerance || gap < -tolerance {
		t.Fatalf("the registered address takes %v longer than the free one, past the %v tolerance", gap, tolerance)
	}
}

func median(samples []time.Duration) time.Duration {
	sorted := slices.Clone(samples)
	slices.Sort(sorted)
	return sorted[len(sorted)/2]
}

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
	assertIndistinguishableTimings(t,
		func(int) error { return signUp(member.Email) },
		func(sample int) error {
			return signUp(fmt.Sprintf("free-%d@tenant-a.example.com", sample+timingWarmup))
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
	assertIndistinguishableTimings(t,
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
	assertIndistinguishableTimings(t,
		func(int) error { return requestLink(pending.Email) },
		func(int) error { return requestLink("stranger@tenant-a.example.com") },
	)
}
