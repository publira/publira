package publicaddr

import (
	"net/netip"
	"slices"
	"testing"
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
