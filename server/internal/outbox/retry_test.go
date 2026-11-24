package outbox

import (
	"errors"
	"testing"
	"time"
)

func TestRetryDelay(t *testing.T) {
	t.Parallel()

	cases := []struct {
		attempts int
		want     string
	}{
		{attempts: 0, want: "1s"},
		{attempts: 1, want: "1s"},
		{attempts: 2, want: "2s"},
		{attempts: 3, want: "4s"},
		{attempts: 10, want: "8m32s"},
		{attempts: 20, want: "1h0m0s"},
	}
	for _, tc := range cases {
		got := RetryDelay(tc.attempts)
		if got.String() != tc.want {
			t.Fatalf("RetryDelay(%d) = %s, want %s", tc.attempts, got, tc.want)
		}
	}
}

// lastAttemptAt is how long after the first attempt the last one a budget of
// attempts allows starts, under RetryDelay.
func lastAttemptAt(attempts int) time.Duration {
	var elapsed time.Duration
	for n := 1; n < attempts; n++ {
		elapsed += RetryDelay(n)
	}
	return elapsed
}

// An event that keeps failing for an hour, with no outbox variable set, is
// still tried after that hour: an outage someone has to notice and fix takes
// longer than a budget of minutes spans.
func TestDefaultBudgetOutlastsAnHourOfFailures(t *testing.T) {
	t.Parallel()

	got := lastAttemptAt(DefaultMaxAttempts)
	if got <= time.Hour {
		t.Fatalf("the last of %d attempts starts %s after the first, want more than an hour", DefaultMaxAttempts, got)
	}
	if want := 4*time.Hour + 8*time.Minute + 15*time.Second; got != want {
		t.Fatalf("the last of %d attempts starts %s after the first, want %s", DefaultMaxAttempts, got, want)
	}
}

func TestAttemptsWithin(t *testing.T) {
	t.Parallel()

	cases := []struct {
		window time.Duration
		want   int
	}{
		{window: 0, want: 1},
		{window: time.Second, want: 2},
		{window: 3 * time.Second, want: 3},
		{window: 4095 * time.Second, want: 13},
		{window: 4095*time.Second + time.Hour - time.Second, want: 13},
		{window: 4095*time.Second + time.Hour, want: 14},
		{window: 24 * time.Hour, want: 35},
		{window: 72 * time.Hour, want: 83},
	}
	for _, tc := range cases {
		got := AttemptsWithin(tc.window)
		if got != tc.want {
			t.Errorf("AttemptsWithin(%s) = %d, want %d", tc.window, got, tc.want)
		}
		if at := lastAttemptAt(got); at > tc.window {
			t.Errorf("AttemptsWithin(%s): the last attempt starts at %s, after the window", tc.window, at)
		}
		if at := lastAttemptAt(got + 1); at <= tc.window {
			t.Errorf("AttemptsWithin(%s): one more attempt would still start within it, at %s", tc.window, at)
		}
	}
}

// A Google Play purchase is refunded three days after it was made unless it is
// acknowledged or consumed, so its event outlasts a day of the Developer API
// failing and makes no attempt after the three days are out.
func TestGooglePlayBudgetSpansItsDeadline(t *testing.T) {
	t.Parallel()

	at := lastAttemptAt(GooglePlayMaxAttempts)
	if at <= 24*time.Hour {
		t.Fatalf("the last Google Play attempt starts %s after the first, want more than a day", at)
	}
	if at > GooglePlayDeadline || at <= GooglePlayDeadline-time.Hour {
		t.Fatalf("the last Google Play attempt starts %s after the first, want within the last hour of %s", at, GooglePlayDeadline)
	}
}

func TestPermanentError(t *testing.T) {
	t.Parallel()

	if IsPermanent(nil) {
		t.Fatal("IsPermanent(nil) = true")
	}
	plain := errors.New("transient")
	if IsPermanent(plain) {
		t.Fatal("plain error treated as permanent")
	}
	perm := Permanent(plain)
	if !IsPermanent(perm) {
		t.Fatal("Permanent() not detected")
	}
	if perm.Error() != "transient" {
		t.Fatalf("Error() = %q", perm.Error())
	}
	if Permanent(nil) != nil {
		t.Fatal("Permanent(nil) should be nil")
	}
}
