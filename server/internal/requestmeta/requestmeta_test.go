package requestmeta

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/publira/publira/server/internal/clientip"
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
		{name: "a bracketed IPv6 host keeps its port", host: "[::1]:3080", want: []string{"[::1]:3080"}},
		{name: "X-Forwarded-Host is not read without the middleware", host: "a.example", forwardedHost: "b.example", want: []string{"a.example"}},
		{name: "no host at all", host: "", want: nil},
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

func TestHostCandidatesFromRequestReadsTheMiddlewaresHost(t *testing.T) {
	tests := []struct {
		name string
		peer string
		want []string
	}{
		{name: "the forwarded host from a trusted proxy", peer: "10.0.0.2:41000", want: []string{"shop.example:3080"}},
		{name: "Host from any other peer", peer: "192.0.2.5:41000", want: []string{"web-storefront:3000"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got []string
			handler := clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies}).Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				got = HostCandidatesFromRequest(r)
			}))
			r := httptest.NewRequest(http.MethodGet, "/images/x", nil)
			r.RemoteAddr = tt.peer
			r.Host = "web-storefront:3000"
			r.Header.Set("X-Forwarded-Host", "Shop.Example:3080")
			handler.ServeHTTP(httptest.NewRecorder(), r)

			if !slices.Equal(got, tt.want) {
				t.Fatalf("HostCandidatesFromRequest() = %v, want %v", got, tt.want)
			}
		})
	}
}
