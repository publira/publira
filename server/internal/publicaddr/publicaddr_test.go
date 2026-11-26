package publicaddr

import (
	"errors"
	"net"
	"net/netip"
	"slices"
	"strconv"
	"sync/atomic"
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

// A restricted address is refused before anything connects to it, and a host
// is reached at an allowed address whichever other addresses it resolves to.
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
}
