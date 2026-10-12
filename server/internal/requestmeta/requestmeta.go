package requestmeta

import (
	"net/http"
	"strings"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/clientip"
)

// AccessTokenFromRequest extracts a Bearer access token from the request.
func AccessTokenFromRequest(r *http.Request) (string, bool) {
	if r == nil {
		return "", false
	}
	return auth.BearerToken(r.Header.Get("Authorization"))
}

// HostCandidatesFromRequest returns the hosts the request names, port included,
// since a port saved on a tenant's host is part of which tenant it is.
//
// The host is the one [clientip.Resolver.Middleware] determined, which takes
// a forwarded host only from a trusted proxy. A request that did not pass
// through it names the host in Host alone.
func HostCandidatesFromRequest(r *http.Request) []string {
	host, ok := clientip.HostFromContext(r.Context())
	if !ok {
		host = r.Host
	}
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return nil
	}
	return []string{host}
}
