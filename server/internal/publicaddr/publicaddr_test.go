package publicaddr

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"slices"
	"strconv"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func TestPublicRefusesWhatTheOperatorsNetworkHolds(t *testing.T) {
	for raw, want := range map[string]bool{
		"93.184.216.34":        true,
		"2606:2800:220:1::1":   true,
		"127.0.0.1":            false,
		"::1":                  false,
		"10.0.0.8":             false,
		"172.16.4.1":           false,
		"192.168.1.10":         false,
		"169.254.169.254":      false,
		"100.64.0.1":           false,
		"0.0.0.0":              false,
		"fd00::1":              false,
		"fe80::1":              false,
		"::ffff:127.0.0.1":     false,
		"64:ff9b::7f00:1":      false,
		"224.0.0.1":            false,
		"::ffff:93.184.216.34": true,
	} {
		if got := Public(netip.MustParseAddr(raw)); got != want {
			t.Errorf("Public(%s) = %v, want %v", raw, got, want)
		}
	}
}

func TestParseAllowedReadsAddressesAndRanges(t *testing.T) {
	t.Parallel()

	got, err := ParseAllowed(" 10.0.0.0/8, 192.0.2.1\n::ffff:198.51.100.0/120 fd00::1 ")
	if err != nil {
		t.Fatalf("ParseAllowed: %v", err)
	}
	want := []netip.Prefix{
		netip.MustParsePrefix("10.0.0.0/8"),
		netip.MustParsePrefix("192.0.2.1/32"),
		netip.MustParsePrefix("198.51.100.0/24"),
		netip.MustParsePrefix("fd00::1/128"),
	}
	if !slices.Equal(got, want) {
		t.Fatalf("ParseAllowed = %v, want %v", got, want)
	}

	if got, err := ParseAllowed("  "); err != nil || len(got) != 0 {
		t.Fatalf("ParseAllowed of nothing = %v, %v, want none", got, err)
	}

	for _, raw := range []string{"receiver.internal", "10.0.0.0/33", "0.0.0.0/0", "::/0", "::ffff:0.0.0.0/96", "::ffff:0.0.0.0/64", "fe80::1%eth0"} {
		if got, err := ParseAllowed(raw); err == nil {
			t.Errorf("ParseAllowed(%q) = %v, want refused", raw, got)
		}
	}
}

// A restricted address is refused before anything connects to it, a host is
// reached at an allowed address whichever other addresses it resolves to, and
// a permitted address that fails answers its own error rather than the
// refusal of a restricted one beside it.
func TestDialChecksEveryAddressItConnectsTo(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	var accepted atomic.Int32
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			accepted.Add(1)
			_ = conn.Close()
		}
	}()
	port := strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
	dialer := &net.Dialer{Timeout: 5 * time.Second}

	for _, host := range []string{"127.0.0.1", "localhost"} {
		if conn, err := Dial(t.Context(), dialer, "tcp", net.JoinHostPort(host, port), nil); !errors.Is(err, ErrRestricted) {
			if conn != nil {
				_ = conn.Close()
			}
			t.Errorf("Dial(%s) with nothing allowed = %v, want %v", host, err, ErrRestricted)
		}
	}
	if got := accepted.Load(); got != 0 {
		t.Fatalf("connections accepted before the address was allowed = %d, want 0", got)
	}

	allowed := []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
	conn, err := Dial(t.Context(), dialer, "tcp", net.JoinHostPort("localhost", port), allowed)
	if err != nil {
		t.Fatalf("Dial(localhost) with 127.0.0.1 allowed = %v, want it connected", err)
	}
	_ = conn.Close()

	// Both families permitted: ::1 refuses, and the race falls back to
	// 127.0.0.1, which takes the connection.
	both := append([]netip.Prefix{netip.MustParsePrefix("::1/128")}, allowed...)
	conn, err = Dial(t.Context(), dialer, "tcp", net.JoinHostPort("localhost", port), both)
	if err != nil {
		t.Fatalf("Dial(localhost) with ::1 and 127.0.0.1 allowed = %v, want it connected", err)
	}
	_ = conn.Close()

	_ = ln.Close()
	_, err = Dial(t.Context(), dialer, "tcp", net.JoinHostPort("localhost", port), allowed)
	if err == nil || errors.Is(err, ErrRestricted) {
		t.Fatalf("Dial(localhost) to a closed port with 127.0.0.1 allowed = %v, want the allowed address's own failure", err)
	}
}

func TestPartialDeadlineSharesTheTimeLeft(t *testing.T) {
	t.Parallel()

	now := time.Unix(1_800_000_000, 0)
	for _, tc := range []struct {
		left      time.Duration
		remaining int
		want      time.Duration
	}{
		{left: 10 * time.Second, remaining: 2, want: 5 * time.Second},
		{left: 10 * time.Second, remaining: 10, want: 2 * time.Second},
		{left: time.Second, remaining: 3, want: time.Second},
		{left: 0, remaining: 2, want: 0},
	} {
		if got := partialDeadline(now, now.Add(tc.left), tc.remaining).Sub(now); got != tc.want {
			t.Errorf("partialDeadline(%v left, %d remaining) = %v, want %v", tc.left, tc.remaining, got, tc.want)
		}
	}
}

// The dialer's timeout bounds the resolution too, so a resolver that never
// answers is given up on at the timeout even when the context has no deadline.
func TestDialBoundsTheResolutionByTheDialTimeout(t *testing.T) {
	t.Parallel()

	stalled := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}
	dialer := &net.Dialer{Timeout: 50 * time.Millisecond, Resolver: stalled}
	done := make(chan error, 1)
	go func() {
		_, err := Dial(context.Background(), dialer, "tcp", "smtp.stalled.example:25", nil)
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Dial through a resolver that never answers connected")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Dial was still resolving after the dial timeout")
	}
}

// Racing two families whose attempts both stall until the deadline returns at
// the deadline, whichever way each racer finds out the time is up.
func TestDialParallelReturnsWhenBothFamiliesStallPastTheDeadline(t *testing.T) {
	t.Parallel()

	dialer := &net.Dialer{
		ControlContext: func(ctx context.Context, _, _ string, _ syscall.RawConn) error {
			<-ctx.Done()
			return ctx.Err()
		},
	}
	primaries := []netip.Addr{netip.MustParseAddr("::1")}
	fallbacks := []netip.Addr{netip.MustParseAddr("127.0.0.1")}
	for range 20 {
		ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
		done := make(chan error, 1)
		go func() {
			_, err := dialParallel(ctx, dialer, "tcp", "25", primaries, fallbacks, time.Millisecond)
			done <- err
		}()
		select {
		case err := <-done:
			if err == nil {
				t.Fatal("dialParallel connected through attempts that never finish")
			}
		case <-time.After(5 * time.Second):
			t.Fatal("dialParallel was still racing after the deadline")
		}
		cancel()
	}
}
