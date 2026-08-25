package adminapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/testutil"
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
	assertRouteRegistered(t, ts, "/publira.admin.v1.TenantThemeService/GetTenantTheme", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminEmailSettingsService/GetTenantEmailSettings", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminPaymentSettingsService/GetTenantPaymentSettings", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminDashboardService/GetDashboard", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminAnnouncementService/ListAnnouncements", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminNotificationService/ListNotifications", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminAccessTicketService/ListAccessTickets", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.TenantSettingsService/GetTenantTimezone", true)
	assertRouteRegistered(t, ts, "/publira.admin.v1.TenantSettingsService/GetTenantDefaultLocale", true)
	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", false)
	assertRouteRegistered(t, ts, "/publira.v1.AuthService/GetMe", false)
}

func newAdminRouteTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(NewHandler(nil, nil, nil, slog.Default(), nil, nil, testutil.TokenManager()))
}

func TestInternalDBErrorPreservesContextErrors(t *testing.T) {
	ctx := t.Context()
	server := &adminServer{logger: slog.Default()}

	// Returning the context error is only half the contract. It has to
	// come back uncoded as well: connect's wrapIfContextError turns an
	// uncoded context error into CodeCanceled / CodeDeadlineExceeded at
	// the protocol boundary, and wrapping it here — even preserving the
	// chain, which errors.Is alone would not notice — would pin the wrong
	// code instead.
	for _, tc := range []struct {
		name string
		err  error
	}{
		{name: "canceled", err: context.Canceled},
		{name: "deadline exceeded", err: context.DeadlineExceeded},
	} {
		got := server.internalDBError(ctx, "ignored", tc.err)
		if !errors.Is(got, tc.err) {
			t.Fatalf("%s error = %v, want %v", tc.name, got, tc.err)
		}
		if code := connect.CodeOf(got); code != connect.CodeUnknown {
			t.Fatalf("%s code = %v, want it left uncoded for connect to map", tc.name, code)
		}
	}

	err := server.internalDBError(ctx, "failed to list example", errors.New(`pq: relation "x" does not exist`))
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
