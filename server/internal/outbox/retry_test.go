package outbox

import (
	"errors"
	"testing"
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
