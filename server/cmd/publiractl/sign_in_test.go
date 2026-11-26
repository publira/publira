package main

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/testutil"
)

// sharedSignInCounters stands one limiter in for the Redis every server
// shares, and answers a guard charging it with one attempt a day per address
// at each origin.
func sharedSignInCounters(t *testing.T) *loginguard.Guard {
	t.Helper()
	limiter := ratelimit.New(ratelimit.NewMemoryStore())
	previous := openSignInCounters
	openSignInCounters = func() (*ratelimit.Limiter, func() error, error) {
		return limiter, func() error { return nil }, nil
	}
	t.Cleanup(func() { openSignInCounters = previous })

	policy := platformpolicy.Defaults()
	policy.LoginAttemptsPerAccount = platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1}
	return loginguard.New(limiter, platformpolicy.Fixed(policy), testutil.TokenManager(), nil)
}

// spendSignInAllowance spends the one attempt the address has at the origin,
// and checks that the next is refused.
func spendSignInAllowance(t *testing.T, guard *loginguard.Guard, scope, address string) {
	t.Helper()
	ctx := clientip.NewContext(context.Background(), "203.0.113.10")
	if _, err := guard.Begin(ctx, scope, address, ""); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}
	if _, err := guard.Begin(ctx, scope, address, ""); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second attempt code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

func signInAllowed(guard *loginguard.Guard, scope, address string) error {
	_, err := guard.Begin(clientip.NewContext(context.Background(), "203.0.113.10"), scope, address, "")
	return err
}

func TestOperatorUnlockSignIn(t *testing.T) {
	guard := sharedSignInCounters(t)
	spendSignInAllowance(t, guard, loginguard.PlatformScope, "operator@example.com")
	spendSignInAllowance(t, guard, loginguard.PlatformScope, "other@example.com")

	code, stdout, stderr := operatorCommand(t, "unlock-sign-in", "--email", " Operator@Example.com ")
	if code != 0 {
		t.Fatalf("operator unlock-sign-in: exit code = %d\n%s", code, stderr)
	}
	if stdout != "Lifted the sign-in limit of Operator@Example.com on the Platform Console\n" {
		t.Fatalf("operator unlock-sign-in = %q", stdout)
	}
	if err := signInAllowed(guard, loginguard.PlatformScope, "operator@example.com"); err != nil {
		t.Fatalf("a sign-in after the lift = %v, want it allowed", err)
	}
	if err := signInAllowed(guard, loginguard.PlatformScope, "other@example.com"); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("another address after the lift code = %v, want what it spent to stand (err=%v)", connect.CodeOf(err), err)
	}
}

func TestOperatorUnlockSignInRequiresAnAddress(t *testing.T) {
	sharedSignInCounters(t)

	code, _, stderr := operatorCommand(t, "unlock-sign-in")
	if code != 1 || !strings.Contains(stderr, "--email is required") {
		t.Fatalf("operator unlock-sign-in without --email: exit code = %d\n%s", code, stderr)
	}
}

// With no Redis every server holds its own counters, and nothing this command
// could write would reach them, so it says so rather than claiming a lift.
func TestUnlockSignInWithoutRedis(t *testing.T) {
	t.Setenv("PUBLIRA_REDIS_URL", "")

	code, stdout, stderr := operatorCommand(t, "unlock-sign-in", "--email", "operator@example.com")
	if code != 1 || stdout != "" || !strings.Contains(stderr, "names no Redis") || !strings.Contains(stderr, "restarting publira server") {
		t.Fatalf("operator unlock-sign-in with no Redis: exit code = %d, stdout = %q\n%s", code, stdout, stderr)
	}
}

func TestTenantMemberUnlockSignIn(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	tenant := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	guard := sharedSignInCounters(t)
	spendSignInAllowance(t, guard, tenant.ID.String(), "reader@example.com")
	spendSignInAllowance(t, guard, loginguard.PlatformScope, "reader@example.com")

	stdout := tenantCommand(t, "", "member", "unlock-sign-in", "--tenant", "TENANTAAAAAA", "--email", "reader@example.com")
	if stdout != "Lifted the sign-in limit of reader@example.com on TENANTAAAAAA\n" {
		t.Fatalf("tenant member unlock-sign-in = %q", stdout)
	}
	if err := signInAllowed(guard, tenant.ID.String(), "reader@example.com"); err != nil {
		t.Fatalf("a sign-in to the tenant after the lift = %v, want it allowed", err)
	}
	// The same address on the Platform Console is another allowance.
	if err := signInAllowed(guard, loginguard.PlatformScope, "reader@example.com"); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the Platform Console after the tenant's lift code = %v, want what it spent to stand (err=%v)", connect.CodeOf(err), err)
	}
}
