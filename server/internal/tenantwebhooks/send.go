package tenantwebhooks

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/publicaddr"
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

// NewHTTPClient is the client deliveries are sent with. It follows no
// redirect, which would take a delivery somewhere the tenant did not save,
// and dials through [publicaddr.Dial] with allowed: the URL is the tenant's
// choice.
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
				return publicaddr.Dial(ctx, dialer, network, address, allowed)
			},
			TLSHandshakeTimeout:   timeout,
			ResponseHeaderTimeout: timeout,
			MaxIdleConnsPerHost:   2,
			IdleConnTimeout:       90 * time.Second,
		},
	}
}
