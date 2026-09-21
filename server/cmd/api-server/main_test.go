package main

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/api/platformapi"
	"github.com/publira/publira/server/api/publicapi"
)

// The edge forwards /api to this process host-agnostically and a Connect
// handler answers gRPC, gRPC-Web and the Connect protocol on one route, so
// what keeps the two console namespaces off the internet is the registration
// and nothing else. These two tests are that boundary.
func TestEdgeListenerServesThePublicNamespaceAlone(t *testing.T) {
	ts := httptest.NewServer(edgeHandler(newTestPublicAPI(t), dbPools{}))
	t.Cleanup(ts.Close)

	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, ts, "/readyz", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminSeriesService/ListSeries", false)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminAuthService/GetMe", false)
	assertRouteRegistered(t, ts, "/publira.platform.v1.PlatformTenantService/ListTenants", false)
	assertRouteRegistered(t, ts, "/publira.platform.v1.PlatformSetupService/CheckSetupStatus", false)
}

func TestInternalListenerServesAllThreeNamespaces(t *testing.T) {
	publicAPI := newTestPublicAPI(t)
	adminAPI, err := adminapi.New(nil, nil, nil, slog.Default(), nil, nil, nil)
	if err != nil {
		t.Fatalf("adminapi.New: %v", err)
	}
	platformAPI := platformapi.New(nil, nil, slog.Default(), nil, nil, nil)

	ts := httptest.NewServer(internalHandler(publicAPI, adminAPI, platformAPI, dbPools{}))
	t.Cleanup(ts.Close)

	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminSeriesService/ListSeries", true)
	assertRouteRegistered(t, ts, "/publira.platform.v1.PlatformTenantService/ListTenants", true)
	assertRouteRegistered(t, ts, "/readyz", true)
}

func newTestPublicAPI(t *testing.T) *publicapi.API {
	t.Helper()
	api, err := publicapi.New(nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("publicapi.New: %v", err)
	}
	return api
}

// assertRouteRegistered asks with GET, which every Connect procedure here
// refuses before the handler runs, so a registered route answers something
// other than 404 without a database behind it.
func assertRouteRegistered(t *testing.T, ts *httptest.Server, path string, wantRegistered bool) {
	t.Helper()
	resp, err := ts.Client().Get(ts.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	_ = resp.Body.Close()

	gotRegistered := resp.StatusCode != http.StatusNotFound
	if gotRegistered != wantRegistered {
		t.Fatalf("path %s status = %d, registered = %v, want registered = %v", path, resp.StatusCode, gotRegistered, wantRegistered)
	}
}
