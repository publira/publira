package main

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/api/platformapi"
	"github.com/publira/publira/server/api/publicapi"
	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/imageserver"
	"github.com/publira/publira/server/internal/signin"
)

func TestRunWithoutCommand(t *testing.T) {
	var stderr strings.Builder
	if code := run(nil, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr.String(), "Usage: publira <command>") {
		t.Fatalf("stderr = %q, want the usage text", stderr.String())
	}
}

func TestRunUnknownCommand(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"api-server"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	out := stderr.String()
	if !strings.Contains(out, `unknown command "api-server"`) {
		t.Fatalf("stderr = %q, want the rejected name", out)
	}
	if !strings.Contains(out, "Usage: publira <command>") {
		t.Fatalf("stderr = %q, want the usage text", out)
	}
}

// Everything a process reads is in the environment, and the flags there are
// choose what server hosts, so any other argument is a mistake rather than a
// setting. None of these invocations starts anything.
func TestRunRejectsArgumentsTheCommandDoesNotTake(t *testing.T) {
	for _, tc := range []struct {
		args   []string
		reason string
	}{
		{[]string{"server", "--port", "8000"}, "flag provided but not defined: -port"},
		{[]string{"server", "extra"}, "server takes no arguments other than --listener and --with-worker"},
		{[]string{"server", "--with-worker", "extra"}, "server takes no arguments other than --listener and --with-worker"},
		{[]string{"server", "--listener", "worker"}, `--listener must be edge or internal, not "worker"`},
		{[]string{"server", "--listener", "edge,internal"}, `--listener must be edge or internal, not "edge,internal"`},
		{[]string{"server", "--listener"}, "flag needs an argument: -listener"},
		{[]string{"worker", "extra"}, "worker takes no arguments"},
		{[]string{"worker", "--with-worker"}, "worker takes no arguments"},
		{[]string{"worker", "--listener", "edge"}, "worker takes no arguments"},
		{[]string{"--with-worker"}, `unknown command "--with-worker"`},
	} {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			var stderr strings.Builder
			if code := run(tc.args, &stderr); code != 2 {
				t.Fatalf("exit code = %d, want 2", code)
			}
			out := stderr.String()
			if !strings.Contains(out, tc.reason) {
				t.Fatalf("stderr = %q, want %q", out, tc.reason)
			}
			if !strings.Contains(out, "Usage: publira <command>") {
				t.Fatalf("stderr = %q, want the usage text", out)
			}
		})
	}
}

// Without --listener the server serves both listeners, as it did before the
// flag existed, and --with-worker adds the worker to whichever it serves.
func TestParseServerFlags(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want hosted
	}{
		{nil, hosted{server: bothListeners}},
		{[]string{"--with-worker"}, hosted{server: bothListeners, worker: true}},
		{[]string{"-with-worker"}, hosted{server: bothListeners, worker: true}},
		{[]string{"--with-worker=false"}, hosted{server: bothListeners}},
		{[]string{"--listener", "edge"}, hosted{server: serverListeners{edge: true}}},
		{[]string{"--listener=internal"}, hosted{server: serverListeners{internal: true}}},
		{[]string{"--listener", "edge", "--with-worker"}, hosted{server: serverListeners{edge: true}, worker: true}},
	} {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			got, err := parseServerFlags(tc.args)
			if err != nil {
				t.Fatalf("parseServerFlags(%q): %v", tc.args, err)
			}
			if got != tc.want {
				t.Fatalf("parseServerFlags(%q) = %+v, want %+v", tc.args, got, tc.want)
			}
		})
	}
}

func TestUsageListsEveryCommandAndFlag(t *testing.T) {
	out := usage()
	for _, entry := range []string{"server", "worker", "--listener", "--with-worker"} {
		if !strings.Contains(out, "  "+entry+" ") {
			t.Fatalf("usage text is missing %q", entry)
		}
	}
}

// A process serving one listener reports under the names of what that
// listener serves, and the public namespace, which both serve, stays the
// process default.
func TestServerServiceNamesFollowTheListeners(t *testing.T) {
	for _, tc := range []struct {
		name      string
		listeners serverListeners
		want      []string
	}{
		{"both", bothListeners, []string{publicapi.ServiceName, adminapi.ServiceName, platformapi.ServiceName, imageserver.ServiceName}},
		{"edge", serverListeners{edge: true}, []string{publicapi.ServiceName, imageserver.ServiceName}},
		{"internal", serverListeners{internal: true}, []string{publicapi.ServiceName, adminapi.ServiceName, platformapi.ServiceName}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := serverServiceNames(tc.listeners); !slices.Equal(got, tc.want) {
				t.Fatalf("serverServiceNames(%+v) = %v, want %v", tc.listeners, got, tc.want)
			}
		})
	}
}

// The edge forwards /api and /images to this process host-agnostically and a
// Connect handler answers gRPC, gRPC-Web and the Connect protocol on one
// route, so what keeps the two console namespaces off the internet is the
// registration and nothing else. These two tests are that boundary.
func TestEdgeListenerServesThePublicNamespaceAndImagesAlone(t *testing.T) {
	ts := httptest.NewServer(edgeHandler(clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies}), newTestPublicAPI(t), newTestImageServer(t), serverPools{}))
	t.Cleanup(ts.Close)

	assertRouteRegistered(t, ts.URL, "/api/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, ts.URL, "/images/creators/media", true)
	assertRouteRegistered(t, ts.URL, "/readyz", true)
	assertRouteRegistered(t, ts.URL, "/api/publira.admin.v1.AdminSeriesService/ListSeries", false)
	assertRouteRegistered(t, ts.URL, "/api/publira.admin.v1.AdminAuthService/GetMe", false)
	assertRouteRegistered(t, ts.URL, "/api/publira.platform.v1.PlatformTenantService/ListTenants", false)
	assertRouteRegistered(t, ts.URL, "/api/publira.platform.v1.PlatformSetupService/CheckSetupStatus", false)
	// The edge keeps the /api prefix, so the same procedure at the root is
	// not a second way in.
	assertRouteRegistered(t, ts.URL, "/publira.v1.CatalogService/ListPublishedSeries", false)
}

func TestInternalListenerServesAllThreeNamespaces(t *testing.T) {
	publicAPI := newTestPublicAPI(t)
	adminAPI, err := adminapi.New(nil, nil, nil, slog.Default(), nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("adminapi.New: %v", err)
	}
	platformAPI := platformapi.New(nil, nil, slog.Default(), nil, nil, nil)

	ts := httptest.NewServer(internalHandler(clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies}), publicAPI, adminAPI, platformAPI, serverPools{}))
	t.Cleanup(ts.Close)

	assertRouteRegistered(t, ts.URL, "/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, ts.URL, "/publira.admin.v1.AdminSeriesService/ListSeries", true)
	assertRouteRegistered(t, ts.URL, "/publira.platform.v1.PlatformTenantService/ListTenants", true)
	assertRouteRegistered(t, ts.URL, "/readyz", true)
	// The apps fetch no image over the private network; a browser asks for it
	// on the origin of the page it is reading, which is the edge's.
	assertRouteRegistered(t, ts.URL, "/images/creators/media", false)
}

func newTestPublicAPI(t *testing.T) *publicapi.API {
	t.Helper()
	api, err := publicapi.New(nil, nil, nil, nil, nil, nil, signin.VerifierConfig{}, nil, nil)
	if err != nil {
		t.Fatalf("publicapi.New: %v", err)
	}
	return api
}

func newTestImageServer(t *testing.T) *imageserver.Server {
	t.Helper()
	srv, err := imageserver.NewHandler(nil, imageserver.SiteDB{}, imageserver.SiteDB{}, nil, slog.Default(), nil)
	if err != nil {
		t.Fatalf("imageserver.NewHandler: %v", err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	return srv
}

// assertRouteRegistered asks with POST for a health probe, which the probe
// refuses before anything runs, and with GET for a Connect procedure, which
// every one here refuses the same way; an image route is registered for GET
// alone, so the POST is refused by the mux before the handler runs. Each
// registered route therefore answers something other than 404 without a
// database behind it.
func assertRouteRegistered(t *testing.T, baseURL, path string, wantRegistered bool) {
	t.Helper()
	method := http.MethodGet
	if strings.HasPrefix(path, "/images/") || path == "/readyz" {
		method = http.MethodPost
	}
	req, err := http.NewRequest(method, baseURL+path, nil)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	_ = resp.Body.Close()

	gotRegistered := resp.StatusCode != http.StatusNotFound
	if gotRegistered != wantRegistered {
		t.Fatalf("path %s status = %d, registered = %v, want registered = %v", path, resp.StatusCode, gotRegistered, wantRegistered)
	}
}
