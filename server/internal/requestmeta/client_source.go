package requestmeta

import (
	"net"
	"net/http"

	"github.com/publira/publira/server/internal/auditlog"
)

// ClientSource names where a request came from, for an allowance a server holds
// against one caller rather than against one account.
//
// The edge records the caller in X-Forwarded-For; the peer address is what is
// left for a request that reached a server without passing one. The peer's port
// is dropped, because it is a fresh number on every connection and an allowance
// keyed on it would be one nobody ever spends twice.
func ClientSource(headers http.Header, peerAddr string) string {
	if ip := auditlog.ClientIPFromHeader(headers); ip != "" {
		return ip
	}
	if host, _, err := net.SplitHostPort(peerAddr); err == nil {
		return host
	}
	return peerAddr
}
