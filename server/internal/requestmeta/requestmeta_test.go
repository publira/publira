package requestmeta

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestHostCandidatesFromRequest(t *testing.T) {
	tests := []struct {
		name          string
		host          string
		forwardedHost string
		want          []string
	}{
		{name: "keeps the port of the Host header", host: "Shop.Example:8443", want: []string{"shop.example:8443"}},
		{name: "a host with no port", host: "shop.example", want: []string{"shop.example"}},
		{name: "prefers X-Forwarded-Host over Host", host: "web-host:3000", forwardedHost: "shop.example:3080", want: []string{"shop.example:3080"}},
		{name: "every forwarded host, once each", host: "web-host:3000", forwardedHost: "a.example:3080, b.example ,a.example:3080", want: []string{"a.example:3080", "b.example"}},
		{name: "a bracketed IPv6 host keeps its port", host: "[::1]:3080", want: []string{"[::1]:3080"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/images/x", nil)
			r.Host = tt.host
			if tt.forwardedHost != "" {
				r.Header.Set("X-Forwarded-Host", tt.forwardedHost)
			}
			if got := HostCandidatesFromRequest(r); !slices.Equal(got, tt.want) {
				t.Fatalf("HostCandidatesFromRequest() = %v, want %v", got, tt.want)
			}
		})
	}
}
