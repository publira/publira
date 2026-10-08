// Package clientip determines the address of the client a request came from,
// once per request, so that the access token log, the audit log, and every
// per-client limit count the same caller.
//
// The forwarded headers are believed only as far as the hops that wrote them
// are trusted. The proxies in front of the server are the operator's, and a
// proxy that appends to X-Forwarded-For or Forwarded rather than replacing it
// keeps whatever the caller sent in front of the address it adds, so the
// first address in either header is the caller's choice. The address is found
// the way Rails' request.remote_ip finds it instead: the chain the header
// names, followed by the peer, is walked from the right past every trusted
// proxy, and the first address that is not one is the client.
package clientip

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strings"
)

// Env names the variable that replaces [DefaultTrustedProxies].
const Env = "PUBLIRA_TRUSTED_PROXIES"

// DefaultTrustedProxies are the ranges Rails trusts when
// config.action_dispatch.trusted_proxies is not set: loopback, private, and
// link-local. They cover the reverse proxy and the web apps of an install
// that keeps them on a private network, and no address on the internet.
var DefaultTrustedProxies = []netip.Prefix{
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("fe80::/10"),
}

// Resolver determines the client address of a request from the proxies it
// trusts.
type Resolver struct {
	trusted []netip.Prefix
}

// New returns a Resolver that trusts the given addresses and ranges, and no
// others.
func New(trusted []netip.Prefix) *Resolver {
	return &Resolver{trusted: trusted}
}

// FromEnv returns a Resolver trusting the proxies [Env] lists, or
// [DefaultTrustedProxies] when it is unset or empty. A list naming anything
// but an address or a range is an error, so a typo stops the process rather
// than trusting less, or more, than the operator wrote.
func FromEnv() (*Resolver, error) {
	raw := strings.TrimSpace(os.Getenv(Env))
	if raw == "" {
		return New(DefaultTrustedProxies), nil
	}
	trusted, err := ParseTrustedProxies(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", Env, err)
	}
	return New(trusted), nil
}

// ParseTrustedProxies reads addresses and CIDR ranges separated by commas or
// white space. A bare address is the range holding that address alone.
func ParseTrustedProxies(raw string) ([]netip.Prefix, error) {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t' || r == '\n' || r == '\r'
	})
	trusted := make([]netip.Prefix, 0, len(fields))
	for _, field := range fields {
		if strings.Contains(field, "/") {
			prefix, err := netip.ParsePrefix(field)
			if err != nil {
				return nil, fmt.Errorf("%q is not an address or a CIDR range", field)
			}
			trusted = append(trusted, prefix.Masked())
			continue
		}
		addr, err := netip.ParseAddr(field)
		if err != nil || addr.Zone() != "" {
			return nil, fmt.Errorf("%q is not an address or a CIDR range", field)
		}
		trusted = append(trusted, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return trusted, nil
}

// Resolve returns the client address of a request carrying header that
// arrived from remoteAddr, the peer's host and port.
//
// The chain comes from X-Forwarded-For when the request carries one, and from
// the for= parameters of Forwarded otherwise. Rack reads Forwarded first by
// default and makes the order a setting; this one is fixed the other way
// round, because the proxies in front of an install overwhelmingly write
// X-Forwarded-For and pass a Forwarded header the caller sent on untouched,
// and reading that first would let any caller name their own address.
//
// Entries that are not an address, such as Forwarded's "unknown" and its
// obfuscated identifiers, are skipped, as Rails skips them. When every address
// in the chain is trusted, the one furthest from the server is the client.
func (r *Resolver) Resolve(header http.Header, remoteAddr string) string {
	host := remoteAddr
	if h, _, err := net.SplitHostPort(remoteAddr); err == nil {
		host = h
	}
	peer, ok := parseNode(host)
	if !ok {
		// A peer that is not an address cannot be a trusted proxy, so what it
		// forwarded is not believed either.
		return host
	}

	var chain []netip.Addr
	if values := header.Values("X-Forwarded-For"); len(values) > 0 {
		chain = forwardedForChain(values)
	} else {
		chain = forwardedChain(header.Values("Forwarded"))
	}
	chain = append(chain, peer)

	for i := len(chain) - 1; i >= 0; i-- {
		if !r.trusts(chain[i]) {
			return chain[i].String()
		}
	}
	return chain[0].String()
}

func (r *Resolver) trusts(addr netip.Addr) bool {
	for _, prefix := range r.trusted {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// Middleware stores the client address of every request in its context, for
// [FromContext] to read.
func (r *Resolver) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ip := r.Resolve(req.Header, req.RemoteAddr)
		next.ServeHTTP(w, req.WithContext(NewContext(req.Context(), ip)))
	})
}

type contextKey struct{}

// NewContext returns a copy of ctx carrying ip as the client address.
func NewContext(ctx context.Context, ip string) context.Context {
	return context.WithValue(ctx, contextKey{}, ip)
}

// FromContext returns the client address [Resolver.Middleware] determined for
// the request ctx belongs to, or an empty string for a context that did not
// pass through it.
func FromContext(ctx context.Context) string {
	ip, _ := ctx.Value(contextKey{}).(string)
	return ip
}

// forwardedForChain reads every X-Forwarded-For line in order, as one list.
func forwardedForChain(values []string) []netip.Addr {
	var chain []netip.Addr
	for _, value := range values {
		for entry := range strings.SplitSeq(value, ",") {
			if addr, ok := parseNode(entry); ok {
				chain = append(chain, addr)
			}
		}
	}
	return chain
}

// forwardedChain reads the for= parameter of every element of the Forwarded
// lines in order (RFC 7239).
func forwardedChain(values []string) []netip.Addr {
	var chain []netip.Addr
	for _, value := range values {
		for _, element := range splitUnquoted(value, ',') {
			for _, pair := range splitUnquoted(element, ';') {
				name, node, found := strings.Cut(pair, "=")
				if !found || !strings.EqualFold(strings.TrimSpace(name), "for") {
					continue
				}
				if addr, ok := parseNode(node); ok {
					chain = append(chain, addr)
				}
			}
		}
	}
	return chain
}

// splitUnquoted splits s at every sep outside a quoted string.
func splitUnquoted(s string, sep byte) []string {
	var parts []string
	quoted, escaped, start := false, false, 0
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case escaped:
			escaped = false
		case quoted && c == '\\':
			escaped = true
		case c == '"':
			quoted = !quoted
		case !quoted && c == sep:
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	return append(parts, s[start:])
}

// parseNode reads one hop of a chain: an address, optionally quoted, with an
// optional port, and an IPv6 address in brackets when it carries one.
func parseNode(raw string) (netip.Addr, bool) {
	node := strings.TrimSpace(raw)
	if len(node) >= 2 && node[0] == '"' && node[len(node)-1] == '"' {
		node = strings.ReplaceAll(node[1:len(node)-1], `\`, "")
	}
	var (
		addr netip.Addr
		err  error
	)
	if addrPort, portErr := netip.ParseAddrPort(node); portErr == nil {
		addr = addrPort.Addr()
	} else if inner, ok := strings.CutPrefix(node, "["); ok && strings.HasSuffix(inner, "]") {
		addr, err = netip.ParseAddr(strings.TrimSuffix(inner, "]"))
	} else {
		addr, err = netip.ParseAddr(node)
	}
	if err != nil {
		return netip.Addr{}, false
	}
	return addr.WithZone("").Unmap(), true
}
