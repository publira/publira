package platformapi

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPlatformHandlerExposesOnlyPlatformRoutes(t *testing.T) {
	ts := httptest.NewServer(NewHandler(nil, nil, slog.Default(), nil, nil))
	t.Cleanup(ts.Close)

	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformTenantService/ListTenants", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformTenantService/CreateTenant", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformEmailSettingsService/GetPlatformEmailSettings", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformAuthService/GetMe", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformDashboardService/GetDashboardSummary", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformAuditLogService/ListAuditLogs", true)
	assertPlatformRouteRegistered(t, ts, "/publira.admin.v1.AdminSeriesService/ListSeries", false)
	assertPlatformRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", false)
}

func assertPlatformRouteRegistered(t *testing.T, ts *httptest.Server, path string, wantRegistered bool) {
	t.Helper()
	resp, err := ts.Client().Get(ts.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	_ = resp.Body.Close()
	gotRegistered := resp.StatusCode != http.StatusNotFound
	if gotRegistered != wantRegistered {
		t.Fatalf("path %s: status=%d registered=%v, want registered=%v", path, resp.StatusCode, gotRegistered, wantRegistered)
	}
}
