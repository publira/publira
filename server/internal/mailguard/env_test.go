package mailguard

import (
	"testing"

	"connectrpc.com/connect"
)

// clearEnv empties every setting the policy reads, so a case that is about a
// value states that value itself. A contributor with one of these exported in
// their shell would otherwise be running a different test.
func clearEnv(t *testing.T) {
	t.Helper()

	for _, name := range []string{
		perAddressPerHourEnv,
		perAddressPerDayEnv,
		perSourcePerHourEnv,
		perSourcePerDayEnv,
		"PUBLIRA_REDIS_URL",
	} {
		t.Setenv(name, "")
	}
}

func TestNewFromEnvReadsTheDeploymentsLimits(t *testing.T) {
	clearEnv(t)
	t.Setenv(perAddressPerHourEnv, "2")

	guard, err := NewFromEnv(nil)
	if err != nil {
		t.Fatalf("NewFromEnv: %v", err)
	}

	for attempt := 1; attempt <= 2; attempt++ {
		if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err != nil {
			t.Fatalf("attempt %d = %v, want the first two allowed", attempt, err)
		}
	}
	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the third attempt code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

// A limit of zero refuses every form and a negative one is not a limit at all,
// and either is better caught at startup than by the first reader who cannot
// get their password reset.
func TestNewFromEnvRefusesALimitNobodyCanMeet(t *testing.T) {
	for _, raw := range []string{"0", "-1", "a few"} {
		t.Run(raw, func(t *testing.T) {
			clearEnv(t)
			t.Setenv(perSourcePerDayEnv, raw)

			if _, err := NewFromEnv(nil); err == nil {
				t.Fatalf("NewFromEnv with a limit of %q error = nil, want an error", raw)
			}
		})
	}
}

// A deployment that sets nothing still gets a limit, rather than a form with no
// bound on the mail it causes.
func TestNewDefaultLimitsAnUnconfiguredCaller(t *testing.T) {
	guard := NewDefault()

	for attempt := 1; attempt <= defaultPerAddressPerHour; attempt++ {
		if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err != nil {
			t.Fatalf("attempt %d = %v, want the first %d allowed", attempt, err, defaultPerAddressPerHour)
		}
	}
	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err == nil {
		t.Fatalf("attempt %d = allowed, want the default allowance to refuse it", defaultPerAddressPerHour+1)
	}
}
