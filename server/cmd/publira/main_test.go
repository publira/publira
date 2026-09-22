package main

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/api/platformapi"
	"github.com/publira/publira/server/api/publicapi"
	"github.com/publira/publira/server/internal/imageserver"
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

// A command takes no arguments: everything a process reads is in the
// environment, so an argument is a mistake rather than a setting.
func TestRunRejectsExtraArguments(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"server", "--port", "8000"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr.String(), "takes no arguments") {
		t.Fatalf("stderr = %q, want the extra argument rejection", stderr.String())
	}
}

func TestUsageListsEveryCommand(t *testing.T) {
	out := usage()
	for _, command := range []string{"server", "worker"} {
		if !strings.Contains(out, "  "+command+" ") {
			t.Fatalf("usage text is missing %q", command)
		}
	}
}

// The edge forwards /api and /images to this process host-agnostically and a
// Connect handler answers gRPC, gRPC-Web and the Connect protocol on one
// route, so what keeps the two console namespaces off the internet is the
// registration and nothing else. These two tests are that boundary.
func TestEdgeListenerServesThePublicNamespaceAndImagesAlone(t *testing.T) {
	ts := httptest.NewServer(edgeHandler(newTestPublicAPI(t), newTestImageServer(t), serverPools{}))
	t.Cleanup(ts.Close)

	assertRouteRegistered(t, ts, "/api/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, ts, "/images/creators/media", true)
	assertRouteRegistered(t, ts, "/readyz", true)
	assertRouteRegistered(t, ts, "/api/publira.admin.v1.AdminSeriesService/ListSeries", false)
	assertRouteRegistered(t, ts, "/api/publira.admin.v1.AdminAuthService/GetMe", false)
	assertRouteRegistered(t, ts, "/api/publira.platform.v1.PlatformTenantService/ListTenants", false)
	assertRouteRegistered(t, ts, "/api/publira.platform.v1.PlatformSetupService/CheckSetupStatus", false)
	// The edge keeps the /api prefix, so the same procedure at the root is
	// not a second way in.
	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", false)
}

func TestInternalListenerServesAllThreeNamespaces(t *testing.T) {
	publicAPI := newTestPublicAPI(t)
	adminAPI, err := adminapi.New(nil, nil, nil, slog.Default(), nil, nil, nil)
	if err != nil {
		t.Fatalf("adminapi.New: %v", err)
	}
	platformAPI := platformapi.New(nil, nil, slog.Default(), nil, nil, nil)

	ts := httptest.NewServer(internalHandler(publicAPI, adminAPI, platformAPI, serverPools{}))
	t.Cleanup(ts.Close)

	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminSeriesService/ListSeries", true)
	assertRouteRegistered(t, ts, "/publira.platform.v1.PlatformTenantService/ListTenants", true)
	assertRouteRegistered(t, ts, "/readyz", true)
	// The apps fetch no image over the private network; a browser asks for it
	// on the origin of the page it is reading, which is the edge's.
	assertRouteRegistered(t, ts, "/images/creators/media", false)
}

func newTestPublicAPI(t *testing.T) *publicapi.API {
	t.Helper()
	api, err := publicapi.New(nil, nil, nil, nil)
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
func assertRouteRegistered(t *testing.T, ts *httptest.Server, path string, wantRegistered bool) {
	t.Helper()
	method := http.MethodGet
	if strings.HasPrefix(path, "/images/") || path == "/readyz" {
		method = http.MethodPost
	}
	req, err := http.NewRequest(method, ts.URL+path, nil)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	_ = resp.Body.Close()

	gotRegistered := resp.StatusCode != http.StatusNotFound
	if gotRegistered != wantRegistered {
		t.Fatalf("path %s status = %d, registered = %v, want registered = %v", path, resp.StatusCode, gotRegistered, wantRegistered)
	}
}
