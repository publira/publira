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

// Dial connects to address, a host and a port, at the first address the host
// resolves to that is public or in allowed. The address is checked as it is
// dialled, after resolution, so a name that resolves elsewhere between a check
// and the dial cannot slip past it. A host none of whose addresses may be
// dialled is [ErrRestricted].
func Dial(ctx context.Context, dialer *net.Dialer, network, address string, allowed []netip.Prefix) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("split the address: %w", err)
	}
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("resolve the host: %w", err)
	}
	lastErr := ErrRestricted
	for _, addr := range addresses {
		if !Public(addr) && !inAllowed(addr, allowed) {
			continue
		}
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(addr.Unmap().String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
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
