package platformapi

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/rpcmiddleware"
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

func TestResolveTenantPublicID_FromTenantIDAliasHeader(t *testing.T) {
	// Platform resolve accepts non-UUID strings, because public_id is not a UUID.
	headers := http.Header{}
	headers.Set(rpcmiddleware.TenantPublicIDHeaderName, "TENANT001")

	got, err := resolveTenantPublicID("", headers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "TENANT001" {
		t.Fatalf("value = %q, want TENANT001", got)
	}
}

func TestResolveTenantPublicID_MismatchReturnsInvalidArgument(t *testing.T) {
	headers := http.Header{}
	headers.Set(rpcmiddleware.TenantIDHeaderName, "TENANT002")

	_, err := resolveTenantPublicID("TENANT001", headers)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

func TestResolveTenantPublicID_MissingReturnsInvalidArgument(t *testing.T) {
	_, err := resolveTenantPublicID("  ", nil)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
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
