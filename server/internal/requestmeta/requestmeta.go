package requestmeta

import (
	"net"
	"net/http"
	"strings"

	"github.com/publira/publira/server/internal/auth"
)

var sessionCookieCandidates = []string{
	auth.SessionCookieName,
	"publira_public_session",
	"publira_publira_session",
}

func SessionTokenFromRequest(r *http.Request) (string, bool) {
	for _, name := range sessionCookieCandidates {
		if c, err := r.Cookie(name); err == nil {
			token := strings.TrimSpace(c.Value)
			if token != "" {
				return token, true
			}
		}
	}
	return auth.SessionTokenFromRequest("", r.Header)
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
