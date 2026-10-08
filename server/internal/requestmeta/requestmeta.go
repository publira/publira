package requestmeta

import (
	"net/http"
	"strings"

	"github.com/publira/publira/server/internal/auth"
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
func HostCandidatesFromRequest(r *http.Request) []string {
	raw := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if raw == "" {
		raw = strings.TrimSpace(r.Host)
	}

	parts := strings.Split(raw, ",")
	candidates := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		host := strings.ToLower(strings.TrimSpace(part))
		if host == "" {
			continue
		}
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		candidates = append(candidates, host)
	}
	return candidates
}
