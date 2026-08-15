package publicapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
)

// TestPublicHandlerExposesOnlyPublicRoutes は、NewHandler が公開 API (CatalogService, AuthService) だけ
// 公開し、管理 API (AdminSeriesService, AdminAuthService) は登録しないことを検証する。
func TestPublicHandlerExposesOnlyPublicRoutes(t *testing.T) {
	ts := newPublicRouteTestServer(t)
	t.Cleanup(ts.Close)

	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedAuthors", true)
	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/GetPublishedAuthorDetail", true)
	assertRouteRegistered(t, ts, "/publira.v1.PublicPagesService/ListPublishedPages", true)
	assertRouteRegistered(t, ts, "/publira.v1.AuthService/GetMe", true)
	assertRouteRegistered(t, ts, "/publira.v1.NotificationService/ListNotifications", true)
	assertRouteRegistered(t, ts, "/publira.v1.DomainService/GetTenantByDomain", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminSeriesService/ListSeries", false)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminCreatorService/ListCreators", false)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminLabelService/ListLabels", false)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminAuthService/GetMe", false)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminDashboardService/GetDashboard", false)
}

func newPublicRouteTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(NewHandler(nil, nil, nil, nil, nil))
}

func TestInternalDBErrorPreservesContextErrors(t *testing.T) {
	server := &apiServer{logger: slog.Default()}

	if got := server.internalDBError("ignored", context.Canceled); !errors.Is(got, context.Canceled) {
		t.Fatalf("canceled error = %v, want context.Canceled", got)
	}
	if got := server.internalDBError("ignored", context.DeadlineExceeded); !errors.Is(got, context.DeadlineExceeded) {
		t.Fatalf("deadline error = %v, want context.DeadlineExceeded", got)
	}

	err := server.internalDBError("failed to list example", errors.New(`pq: relation "x" does not exist`))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
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
