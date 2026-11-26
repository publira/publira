// Package publicaddr dials the hosts a tenant chooses — a webhook endpoint, an
// SMTP server — only at a public address or one the operator allowed. The
// processes that dial them run inside the operator's network, so a host that
// resolves to a private or loopback address would let a tenant reach what the
// operator never exposed.
package publicaddr

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"slices"
	"strings"
	"time"
	"unicode"
)

// ErrRestricted is a connection refused because its host resolves to an
// address that is neither public nor allowed.
var ErrRestricted = errors.New("the host resolves to a private, loopback, or otherwise restricted address")

// ParseAllowed reads addresses and CIDR ranges separated by commas or white
// space. A bare address is the range holding that address alone. A range of
// length zero is refused: allowing every address is switching the check off,
// which no list of hosts needs.
func ParseAllowed(raw string) ([]netip.Prefix, error) {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || unicode.IsSpace(r)
	})
	allowed := make([]netip.Prefix, 0, len(fields))
	for _, field := range fields {
		var prefix netip.Prefix
		var err error
		if strings.Contains(field, "/") {
			prefix, err = netip.ParsePrefix(field)
		} else {
			var addr netip.Addr
			if addr, err = netip.ParseAddr(field); err == nil && addr.Zone() == "" {
				prefix = netip.PrefixFrom(addr, addr.BitLen())
			}
		}
		if err != nil || !prefix.IsValid() {
			return nil, fmt.Errorf("%q is not an address or a CIDR range", field)
		}
		if prefix.Addr().Is4In6() {
			if prefix.Bits() < 96 {
				return nil, fmt.Errorf("%q is an IPv4-mapped range shorter than /96", field)
			}
			prefix = netip.PrefixFrom(prefix.Addr().Unmap(), prefix.Bits()-96)
		}
		if prefix.Bits() == 0 {
			return nil, fmt.Errorf("%q allows every address", field)
		}
		allowed = append(allowed, prefix.Masked())
	}
	return allowed, nil
}

// Dial connects to address, a host and a port, at the addresses the host
// resolves to that are public or in allowed, and at no other: a host with
// none is [ErrRestricted]. Each address is dialled as the IP it was checked
// as, so a name that resolves elsewhere between a check and the dial cannot
// slip past it. The rest follows net.Dialer: its timeout is shared between the
// addresses, the other address family is raced after its fallback delay, and
// the error of a host whose permitted addresses all fail is theirs.
func Dial(ctx context.Context, dialer *net.Dialer, network, address string, allowed []netip.Prefix) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("split the address: %w", err)
	}
	resolver := net.DefaultResolver
	if dialer.Resolver != nil {
		resolver = dialer.Resolver
	}
	resolved, err := resolver.LookupNetIP(ctx, lookupNetwork(network), host)
	if err != nil {
		return nil, fmt.Errorf("resolve the host: %w", err)
	}
	var primaries, fallbacks []netip.Addr
	for _, addr := range resolved {
		addr = addr.Unmap()
		if !Public(addr) && !inAllowed(addr, allowed) {
			continue
		}
		if len(primaries) == 0 || addr.Is4() == primaries[0].Is4() {
			primaries = append(primaries, addr)
		} else {
			fallbacks = append(fallbacks, addr)
		}
	}
	if len(primaries) == 0 {
		return nil, ErrRestricted
	}

	if dialer.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, dialer.Timeout)
		defer cancel()
	}
	single := *dialer
	single.Timeout = 0
	if len(fallbacks) == 0 || dialer.FallbackDelay < 0 {
		return dialSerial(ctx, &single, network, port, append(primaries, fallbacks...))
	}
	delay := dialer.FallbackDelay
	if delay == 0 {
		delay = defaultFallbackDelay
	}
	return dialParallel(ctx, &single, network, port, primaries, fallbacks, delay)
}

// defaultFallbackDelay is net.Dialer's wait before it races the other address
// family, RFC 8305's recommended value.
const defaultFallbackDelay = 300 * time.Millisecond

// minimumAttempt is the least time net.Dialer gives one address while others
// wait, unless less than that is left in all.
const minimumAttempt = 2 * time.Second

func lookupNetwork(network string) string {
	switch network {
	case "tcp4", "udp4":
		return "ip4"
	case "tcp6", "udp6":
		return "ip6"
	default:
		return "ip"
	}
}

// dialSerial tries addrs in order, giving each its share of the time left, and
// answers the first address's error when all of them fail.
func dialSerial(ctx context.Context, dialer *net.Dialer, network, port string, addrs []netip.Addr) (net.Conn, error) {
	var firstErr error
	for i, addr := range addrs {
		conn, err := dialOne(ctx, dialer, network, net.JoinHostPort(addr.String(), port), len(addrs)-i)
		if err == nil {
			return conn, nil
		}
		if firstErr == nil {
			firstErr = err
		}
		if ctx.Err() != nil {
			break
		}
	}
	return nil, firstErr
}

func dialOne(ctx context.Context, dialer *net.Dialer, network, address string, remaining int) (net.Conn, error) {
	if deadline, ok := ctx.Deadline(); ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithDeadline(ctx, partialDeadline(time.Now(), deadline, remaining))
		defer cancel()
	}
	return dialer.DialContext(ctx, network, address)
}

// partialDeadline is the deadline of one of remaining attempts sharing the
// time until deadline, as net.Dialer divides it.
func partialDeadline(now, deadline time.Time, remaining int) time.Time {
	left := deadline.Sub(now)
	if left <= 0 {
		return deadline
	}
	share := left / time.Duration(remaining)
	if share < minimumAttempt {
		share = min(left, minimumAttempt)
	}
	return now.Add(share)
}

// dialParallel races fallbacks against primaries once delay has passed, or as
// soon as the primaries have all failed, and answers the first connection.
// When both fail it answers the primaries' error, as net.Dialer does.
func dialParallel(ctx context.Context, dialer *net.Dialer, network, port string, primaries, fallbacks []netip.Addr, delay time.Duration) (net.Conn, error) {
	type result struct {
		conn    net.Conn
		err     error
		primary bool
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan result)
	race := func(primary bool, addrs []netip.Addr) {
		conn, err := dialSerial(ctx, dialer, network, port, addrs)
		select {
		case results <- result{conn: conn, err: err, primary: primary}:
		case <-ctx.Done():
			if conn != nil {
				_ = conn.Close()
			}
		}
	}

	go race(true, primaries)
	timer := time.NewTimer(delay)
	defer timer.Stop()
	var primaryErr, fallbackErr error
	pending, fallbackStarted := 1, false
	startFallback := func() {
		if !fallbackStarted {
			fallbackStarted = true
			pending++
			go race(false, fallbacks)
		}
	}
	for {
		select {
		case <-timer.C:
			startFallback()
		case r := <-results:
			pending--
			if r.err == nil {
				return r.conn, nil
			}
			if r.primary {
				primaryErr = r.err
				startFallback()
			} else {
				fallbackErr = r.err
			}
			if pending == 0 {
				if primaryErr != nil {
					return nil, primaryErr
				}
				return nil, fallbackErr
			}
		}
	}
}

func inAllowed(addr netip.Addr, allowed []netip.Prefix) bool {
	addr = addr.Unmap()
	return slices.ContainsFunc(allowed, func(prefix netip.Prefix) bool {
		return prefix.Contains(addr)
	})
}

// sharedAddressSpace is RFC 6598's carrier-grade NAT range, which net/netip
// does not count as private.
var sharedAddressSpace = netip.MustParsePrefix("100.64.0.0/10")

// nat64 is RFC 6052's well-known prefix, which reaches an IPv4 address the
// other checks would refuse.
var nat64 = netip.MustParsePrefix("64:ff9b::/96")

// Public reports whether addr may be dialled without being allowed: a global
// unicast address that is not private, shared, or a NAT64 one.
func Public(addr netip.Addr) bool {
	addr = addr.Unmap()
	return addr.IsValid() &&
		addr.IsGlobalUnicast() &&
		!addr.IsPrivate() &&
		!sharedAddressSpace.Contains(addr) &&
		!nat64.Contains(addr)
}
