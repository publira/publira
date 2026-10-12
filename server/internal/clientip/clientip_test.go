package clientip

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"slices"
	"testing"
)

func TestResolve(t *testing.T) {
	tests := []struct {
		name      string
		peer      string
		forwarded string
		xff       []string
		want      string
	}{
		// X-Forwarded-For
		{name: "a trusted proxy that appends to X-Forwarded-For records the address it appended", peer: "10.0.0.2:41000", xff: []string{"198.51.100.7, 203.0.113.10"}, want: "203.0.113.10"},
		{name: "every trusted hop on the right is stepped over", peer: "10.0.0.2:41000", xff: []string{"198.51.100.7, 203.0.113.10, 192.168.1.5, 10.0.0.3"}, want: "203.0.113.10"},
		{name: "X-Forwarded-For from a peer outside the trusted proxies is ignored", peer: "192.0.2.5:41000", xff: []string{"203.0.113.10"}, want: "192.0.2.5"},
		{name: "repeated X-Forwarded-For lines are one list", peer: "10.0.0.2:41000", xff: []string{"198.51.100.7", "203.0.113.10"}, want: "203.0.113.10"},
		{name: "an address with a port", peer: "10.0.0.2:41000", xff: []string{"203.0.113.10:5000"}, want: "203.0.113.10"},
		{name: "a bracketed IPv6 address with a port", peer: "10.0.0.2:41000", xff: []string{"[2001:db8::1]:5000"}, want: "2001:db8::1"},
		{name: "entries that are not addresses are skipped", peer: "10.0.0.2:41000", xff: []string{"203.0.113.10, unknown, 10.0.0.9"}, want: "203.0.113.10"},
		{name: "a chain of trusted addresses names the furthest one", peer: "10.0.0.2:41000", xff: []string{"192.168.1.5, 10.0.0.3"}, want: "192.168.1.5"},
		{name: "an IPv4-mapped peer is matched as IPv4", peer: "[::ffff:10.0.0.2]:41000", xff: []string{"203.0.113.10"}, want: "203.0.113.10"},

		// Forwarded
		{name: "a trusted proxy that appends to Forwarded records the address it appended", peer: "10.0.0.2:41000", forwarded: "for=198.51.100.7, for=203.0.113.10", want: "203.0.113.10"},
		{name: "Forwarded from a peer outside the trusted proxies is ignored", peer: "192.0.2.5:41000", forwarded: "for=203.0.113.10", want: "192.0.2.5"},
		{name: "Forwarded parameters beside for= and quoted IPv6 nodes", peer: "10.0.0.2:41000", forwarded: `for=198.51.100.7;proto=https, for="[2001:db8::1]:4711";by=10.0.0.2;host="a,b.example"`, want: "2001:db8::1"},
		{name: "Forwarded's unknown and obfuscated nodes are skipped", peer: "10.0.0.2:41000", forwarded: "for=203.0.113.10, for=unknown, for=_hidden", want: "203.0.113.10"},

		// Both
		{name: "Forwarded is read when a request carries both", peer: "10.0.0.2:41000", forwarded: "for=203.0.113.10", xff: []string{"198.51.100.7"}, want: "203.0.113.10"},
		{name: "X-Forwarded-For is read when Forwarded names no for=", peer: "10.0.0.2:41000", forwarded: "proto=https;host=shop.example", xff: []string{"203.0.113.10"}, want: "203.0.113.10"},

		// No header
		{name: "the peer when nothing is forwarded", peer: "192.0.2.5:41000", want: "192.0.2.5"},
		{name: "a trusted peer with nothing forwarded is the client itself", peer: "127.0.0.1:41000", want: "127.0.0.1"},
	}
	resolver := New(Config{TrustedProxies: DefaultTrustedProxies})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			header := http.Header{}
			for _, v := range tt.xff {
				header.Add("X-Forwarded-For", v)
			}
			if tt.forwarded != "" {
				header.Set("Forwarded", tt.forwarded)
			}
			if got := resolver.Resolve(header, tt.peer); got != tt.want {
				t.Fatalf("Resolve() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestResolveTrustsOnlyTheConfiguredProxies(t *testing.T) {
	resolver := New(Config{TrustedProxies: []netip.Prefix{netip.MustParsePrefix("198.51.100.0/24")}})
	header := http.Header{}
	header.Set("X-Forwarded-For", "192.0.2.1, 10.0.0.3")

	if got := resolver.Resolve(header, "198.51.100.20:443"); got != "10.0.0.3" {
		t.Fatalf("Resolve() = %q, want the private address once private ranges are no longer trusted", got)
	}
	if got := resolver.Resolve(header, "10.0.0.2:443"); got != "10.0.0.2" {
		t.Fatalf("Resolve() = %q, want a peer outside the configured proxies", got)
	}
}

func TestResolveIgnoresForwardedWhenTurnedOff(t *testing.T) {
	resolver := New(Config{TrustedProxies: DefaultTrustedProxies, IgnoreForwarded: true})
	header := http.Header{}
	header.Set("Forwarded", "for=198.51.100.7")
	header.Set("X-Forwarded-For", "203.0.113.10")

	if got := resolver.Resolve(header, "10.0.0.2:41000"); got != "203.0.113.10" {
		t.Fatalf("Resolve() = %q, want the X-Forwarded-For chain", got)
	}
	header.Del("X-Forwarded-For")
	if got := resolver.Resolve(header, "10.0.0.2:41000"); got != "10.0.0.2" {
		t.Fatalf("Resolve() = %q, want the peer with Forwarded unread", got)
	}
}

func TestParseTrustedProxies(t *testing.T) {
	got, err := ParseTrustedProxies(" 192.0.2.0/24, 198.51.100.7 2001:db8::/32\n10.1.2.3/8 ")
	if err != nil {
		t.Fatalf("ParseTrustedProxies() error = %v", err)
	}
	want := []netip.Prefix{
		netip.MustParsePrefix("192.0.2.0/24"),
		netip.MustParsePrefix("198.51.100.7/32"),
		netip.MustParsePrefix("2001:db8::/32"),
		netip.MustParsePrefix("10.0.0.0/8"),
	}
	if !slices.Equal(got, want) {
		t.Fatalf("ParseTrustedProxies() = %v, want %v", got, want)
	}

	mapped, err := ParseTrustedProxies("::ffff:192.0.2.0/120, ::ffff:198.51.100.7")
	if err != nil {
		t.Fatalf("ParseTrustedProxies() error = %v", err)
	}
	if want := []netip.Prefix{netip.MustParsePrefix("192.0.2.0/24"), netip.MustParsePrefix("198.51.100.7/32")}; !slices.Equal(mapped, want) {
		t.Fatalf("ParseTrustedProxies() = %v, want the IPv4 ranges the mapped ones name", mapped)
	}

	for _, raw := range []string{"proxy.example", "192.0.2.0/33", "fe80::1%eth0", "0.0.0.0/0", "::/0", "::ffff:0:0/95", "::ffff:0:0/96"} {
		if _, err := ParseTrustedProxies(raw); err == nil {
			t.Errorf("ParseTrustedProxies(%q) succeeded, want an error", raw)
		}
	}
}

func TestFromEnv(t *testing.T) {
	header := http.Header{}
	header.Set("X-Forwarded-For", "203.0.113.10")

	t.Setenv(Env, "")
	resolver, err := FromEnv()
	if err != nil {
		t.Fatalf("FromEnv() error = %v", err)
	}
	if got := resolver.Resolve(header, "10.0.0.2:443"); got != "203.0.113.10" {
		t.Fatalf("unset: Resolve() = %q, want the private peer trusted by default", got)
	}

	t.Setenv(Env, "198.51.100.0/24")
	resolver, err = FromEnv()
	if err != nil {
		t.Fatalf("FromEnv() error = %v", err)
	}
	if got := resolver.Resolve(header, "10.0.0.2:443"); got != "10.0.0.2" {
		t.Fatalf("set: Resolve() = %q, want the setting to replace the default", got)
	}

	t.Setenv(Env, "not-an-address")
	if _, err := FromEnv(); err == nil {
		t.Fatal("FromEnv() succeeded on an invalid list, want an error")
	}
}

func TestFromEnvReadsForwardedUnlessTurnedOff(t *testing.T) {
	header := http.Header{}
	header.Set("Forwarded", "for=203.0.113.10")
	header.Set("X-Forwarded-For", "198.51.100.7")

	t.Setenv(Env, "")
	t.Setenv(ForwardedEnv, "")
	resolver, err := FromEnv()
	if err != nil {
		t.Fatalf("FromEnv() error = %v", err)
	}
	if got := resolver.Resolve(header, "10.0.0.2:443"); got != "203.0.113.10" {
		t.Fatalf("unset: Resolve() = %q, want Forwarded read", got)
	}

	t.Setenv(ForwardedEnv, "false")
	resolver, err = FromEnv()
	if err != nil {
		t.Fatalf("FromEnv() error = %v", err)
	}
	if got := resolver.Resolve(header, "10.0.0.2:443"); got != "198.51.100.7" {
		t.Fatalf("false: Resolve() = %q, want X-Forwarded-For read", got)
	}

	t.Setenv(ForwardedEnv, "maybe")
	if _, err := FromEnv(); err == nil {
		t.Fatal("FromEnv() succeeded on a value that is not a boolean, want an error")
	}
}

func TestMiddlewareStoresTheClientAddress(t *testing.T) {
	var got string
	handler := New(Config{TrustedProxies: DefaultTrustedProxies}).Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = FromContext(r.Context())
	}))
	req := httptest.NewRequest(http.MethodPost, "/api/x", nil)
	req.RemoteAddr = "10.0.0.2:41000"
	req.Header.Set("X-Forwarded-For", "198.51.100.7, 203.0.113.10")
	handler.ServeHTTP(httptest.NewRecorder(), req)

	if got != "203.0.113.10" {
		t.Fatalf("FromContext() = %q, want the resolved client address", got)
	}
}

func TestHost(t *testing.T) {
	tests := []struct {
		name          string
		peer          string
		host          string
		forwarded     []string
		forwardedHost []string
		want          string
	}{
		// X-Forwarded-Host
		{name: "X-Forwarded-Host from a trusted proxy", peer: "10.0.0.2:41000", host: "web-storefront:3000", forwardedHost: []string{"shop.example:3080"}, want: "shop.example:3080"},
		{name: "the rightmost X-Forwarded-Host is the one the nearest hop wrote", peer: "10.0.0.2:41000", host: "web-storefront:3000", forwardedHost: []string{"b.example, a.example"}, want: "a.example"},
		{name: "repeated X-Forwarded-Host lines are one list", peer: "10.0.0.2:41000", host: "web-storefront:3000", forwardedHost: []string{"b.example", "a.example, "}, want: "a.example"},
		{name: "X-Forwarded-Host from a peer outside the trusted proxies is ignored", peer: "192.0.2.5:41000", host: "a.example", forwardedHost: []string{"b.example"}, want: "a.example"},
		{name: "a peer that is not an address is not trusted", peer: "@", host: "a.example", forwardedHost: []string{"b.example"}, want: "a.example"},

		// Forwarded
		{name: "Forwarded's host= from a trusted proxy", peer: "10.0.0.2:41000", host: "web-storefront:3000", forwarded: []string{"for=203.0.113.10;host=shop.example:3080"}, want: "shop.example:3080"},
		{name: "the rightmost host= across elements and lines", peer: "10.0.0.2:41000", host: "web-storefront:3000", forwarded: []string{"host=b.example", `for=203.0.113.10;host="a.example:3080", for=10.0.0.3`}, want: "a.example:3080"},
		{name: "a quoted host= keeps a comma and a semicolon inside it", peer: "10.0.0.2:41000", host: "web-storefront:3000", forwarded: []string{`host="a,b;c.example"`}, want: "a,b;c.example"},
		{name: "Forwarded from a peer outside the trusted proxies is ignored", peer: "192.0.2.5:41000", host: "a.example", forwarded: []string{"host=b.example"}, want: "a.example"},

		// Both
		{name: "Forwarded's host= is read ahead of X-Forwarded-Host", peer: "10.0.0.2:41000", host: "web-storefront:3000", forwarded: []string{"host=a.example"}, forwardedHost: []string{"b.example"}, want: "a.example"},
		{name: "X-Forwarded-Host is read when Forwarded names no host=", peer: "10.0.0.2:41000", host: "web-storefront:3000", forwarded: []string{"for=203.0.113.10"}, forwardedHost: []string{"a.example"}, want: "a.example"},

		// No header
		{name: "Host when nothing is forwarded", peer: "10.0.0.2:41000", host: "a.example:3080", want: "a.example:3080"},
	}
	resolver := New(Config{TrustedProxies: DefaultTrustedProxies})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/images/x", nil)
			req.RemoteAddr = tt.peer
			req.Host = tt.host
			for _, v := range tt.forwarded {
				req.Header.Add("Forwarded", v)
			}
			for _, v := range tt.forwardedHost {
				req.Header.Add("X-Forwarded-Host", v)
			}
			if got := resolver.Host(req); got != tt.want {
				t.Fatalf("Host() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestHostIgnoresForwardedWhenTurnedOff(t *testing.T) {
	resolver := New(Config{TrustedProxies: DefaultTrustedProxies, IgnoreForwarded: true})
	req := httptest.NewRequest(http.MethodGet, "/images/x", nil)
	req.RemoteAddr = "10.0.0.2:41000"
	req.Host = "web-storefront:3000"
	req.Header.Set("Forwarded", "host=b.example")
	req.Header.Set("X-Forwarded-Host", "a.example")

	if got := resolver.Host(req); got != "a.example" {
		t.Fatalf("Host() = %q, want X-Forwarded-Host's value", got)
	}
}

func TestMiddlewareStoresTheHost(t *testing.T) {
	var (
		got string
		ok  bool
	)
	handler := New(Config{TrustedProxies: DefaultTrustedProxies}).Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got, ok = HostFromContext(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/images/x", nil)
	req.RemoteAddr = "10.0.0.2:41000"
	req.Host = "web-storefront:3000"
	req.Header.Set("X-Forwarded-Host", "shop.example")
	handler.ServeHTTP(httptest.NewRecorder(), req)

	if !ok || got != "shop.example" {
		t.Fatalf("HostFromContext() = %q, %v, want the forwarded host", got, ok)
	}
}

func TestHostFromContextIsAbsentOutsideTheMiddleware(t *testing.T) {
	if got, ok := HostFromContext(t.Context()); ok {
		t.Fatalf("HostFromContext() = %q, true, want nothing", got)
	}
}

func TestFromContextIsEmptyOutsideTheMiddleware(t *testing.T) {
	if got := FromContext(t.Context()); got != "" {
		t.Fatalf("FromContext() = %q, want empty", got)
	}
}
