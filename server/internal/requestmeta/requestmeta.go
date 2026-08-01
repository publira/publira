package requestmeta

import (
	"net"
	"net/http"
	"strings"

	"github.com/publira/publira/server/internal/auth"
)

// AccessTokenFromRequest extracts a Bearer access token from the request.
func AccessTokenFromRequest(r *http.Request) (string, bool) {
	if r == nil {
		return "", false
	}
	return auth.BearerTokenFromHeader(r.Header)
}

func HostCandidatesFromRequest(r *http.Request) []string {
	raw := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if raw == "" {
		raw = strings.TrimSpace(r.Host)
	}

	parts := strings.Split(raw, ",")
	candidates := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		host := normalizeHost(part)
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

func normalizeHost(raw string) string {
	host := strings.ToLower(strings.TrimSpace(raw))
	if host == "" {
		return ""
	}
	if strings.HasPrefix(host, "[") && strings.Contains(host, "]") {
		parsedHost, _, err := net.SplitHostPort(host)
		if err == nil {
			return strings.TrimSpace(parsedHost)
		}
	}
	if strings.Count(host, ":") == 1 {
		parsedHost, _, err := net.SplitHostPort(host)
		if err == nil {
			return strings.TrimSpace(parsedHost)
		}
	}
	return host
}
