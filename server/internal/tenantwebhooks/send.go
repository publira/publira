package tenantwebhooks

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// The headers a delivery is sent with.
const (
	HeaderSignature = "X-Publira-Signature"
	HeaderEvent     = "X-Publira-Event"
	HeaderDelivery  = "X-Publira-Delivery"
)

// Sign answers the X-Publira-Signature of body sent at timestamp:
// "t=<unix seconds>,v1=<hex>", the hex being HMAC-SHA256 under secret of the
// timestamp, a full stop, and the body. The timestamp is signed with the body
// so that a receiver which rejects an old one rejects a replay too.
func Sign(secret string, timestamp time.Time, body []byte) string {
	unix := strconv.FormatInt(timestamp.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unix))
	mac.Write([]byte("."))
	mac.Write(body)
	return "t=" + unix + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}

// Verify is what a receiver does with a delivery, written down so the server
// holds itself to the documented check: the signature header names a
// timestamp within tolerance of now and a v1 that Sign would make.
func Verify(secret, header string, body []byte, now time.Time, tolerance time.Duration) error {
	var unix, signature string
	for part := range strings.SplitSeq(header, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch key {
		case "t":
			unix = value
		case "v1":
			signature = value
		}
	}
	seconds, err := strconv.ParseInt(unix, 10, 64)
	if err != nil || signature == "" {
		return errors.New("tenantwebhooks: malformed signature header")
	}
	at := time.Unix(seconds, 0)
	if now.Sub(at).Abs() > tolerance {
		return errors.New("tenantwebhooks: signature timestamp is outside the tolerance")
	}
	want := Sign(secret, at, body)
	if !hmac.Equal([]byte(want), []byte("t="+unix+",v1="+signature)) {
		return errors.New("tenantwebhooks: signature does not match")
	}
	return nil
}

// ValidateURL checks a URL an endpoint is saved with: https, with a host, no
// user information, and at most 2048 characters. Where the host resolves is
// checked when a delivery is sent, since it can change after the URL is saved.
func ValidateURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("is required")
	}
	if len(raw) > 2048 {
		return "", errors.New("must be at most 2048 characters")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.Opaque != "" {
		return "", errors.New("must be an https URL with a host")
	}
	if parsed.User != nil {
		return "", errors.New("must not carry a user name or password")
	}
	if parsed.Fragment != "" {
		return "", errors.New("must not carry a fragment")
	}
	return raw, nil
}

// ErrRestrictedAddress is a delivery refused because its host resolves to an
// address the worker does not send to.
var ErrRestrictedAddress = errors.New("the endpoint's host resolves to a private, loopback, or otherwise restricted address")

// ParseAllowedAddresses reads addresses and CIDR ranges separated by commas or
// white space. A bare address is the range holding that address alone. A range
// of length zero is refused: allowing every address is switching the check
// off, which no list of receivers needs.
func ParseAllowedAddresses(raw string) ([]netip.Prefix, error) {
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

// NewHTTPClient is the client deliveries are sent with. It follows no
// redirect, which would take a delivery somewhere the tenant did not save,
// and dials only a public address or one the operator put in allowed: the URL
// is the tenant's choice, and the worker runs inside the operator's network,
// so a host that resolves to a private or loopback address would let a tenant
// reach what the operator never exposed. The address is checked as it is
// dialled, after resolution, so a name that resolves elsewhere between a check
// and the dial cannot slip past it.
func NewHTTPClient(timeout time.Duration, allowed []netip.Prefix) *http.Client {
	dialer := &net.Dialer{Timeout: timeout}
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{
			Proxy: nil,
			DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
				return dialDeliverable(ctx, dialer, network, address, allowed)
			},
			TLSHandshakeTimeout:   timeout,
			ResponseHeaderTimeout: timeout,
			MaxIdleConnsPerHost:   2,
			IdleConnTimeout:       90 * time.Second,
		},
	}
}

func dialDeliverable(ctx context.Context, dialer *net.Dialer, network, address string, allowed []netip.Prefix) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("split the endpoint address: %w", err)
	}
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("resolve the endpoint host: %w", err)
	}
	lastErr := ErrRestrictedAddress
	for _, addr := range addresses {
		if !PublicAddress(addr) && !inAllowed(addr, allowed) {
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

// PublicAddress reports whether addr is one a delivery may be sent to: a
// global unicast address that is not private, shared, or a NAT64 one.
func PublicAddress(addr netip.Addr) bool {
	addr = addr.Unmap()
	return addr.IsValid() &&
		addr.IsGlobalUnicast() &&
		!addr.IsPrivate() &&
		!sharedAddressSpace.Contains(addr) &&
		!nat64.Contains(addr)
}
