package adminapi

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestAdminHandlerExposesOnlyAdminRoutes は、NewHandler が管理 API (AdminSeriesService, AdminAuthService) だけ
// 公開し、公開 API (CatalogService, AuthService) は登録しないことを検証する。
func TestAdminHandlerExposesOnlyAdminRoutes(t *testing.T) {
	ts := newAdminRouteTestServer(t)
	t.Cleanup(ts.Close)

	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminSeriesService/ListSeries", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminCreatorService/ListCreators", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminLabelService/ListLabels", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminAuthService/GetMe", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminDashboardService/GetDashboard", true)
	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", false)
	assertRouteRegistered(t, ts, "/publira.v1.AuthService/GetMe", false)
}

func newAdminRouteTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(NewHandler(nil, nil, slog.Default()))
}

func assertRouteRegistered(t *testing.T, ts *httptest.Server, path string, wantRegistered bool) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, ts.URL+path, nil)
	if err != nil {
		t.Fatalf("http.NewRequest: %v", err)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	_ = resp.Body.Close()

	gotRegistered := resp.StatusCode != http.StatusNotFound
	if gotRegistered != wantRegistered {
		t.Fatalf("path %s status = %d, registered = %v, want registered = %v", path, resp.StatusCode, gotRegistered, wantRegistered)
	}
}
