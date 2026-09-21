package adminapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/storage"
)

// TestAdminHandlerExposesOnlyAdminRoutes asserts that NewHandler serves the
// admin API (AdminSeriesService, AdminAuthService) and registers none of the
// public API (CatalogService, AuthService).
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
	assertRouteRegistered(t, ts, "/publira.admin.v1.AdminFcmSettingsService/GetTenantFcmSettings", true)
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
	handler, err := newTestHandler(nil, nil, nil, slog.Default(), nil, nil)
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}
	return httptest.NewServer(handler)
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

func TestStorageUploadErrorPreservesContextErrors(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
	}{
		{name: "canceled", err: context.Canceled},
		{name: "deadline exceeded", err: context.DeadlineExceeded},
	} {
		got := storageUploadError(tc.err)
		if !errors.Is(got, tc.err) {
			t.Fatalf("%s error = %v, want %v", tc.name, got, tc.err)
		}
		if code := connect.CodeOf(got); code != connect.CodeUnknown {
			t.Fatalf("%s code = %v, want it left uncoded for connect to map", tc.name, code)
		}
	}

	err := storageUploadError(errors.New("storage unavailable"))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
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

// A platform with no object store saved is a state the Platform Console
// resolves, so an upload says which state it is rather than failing as internal.
func TestStorageUploadErrorReportsMissingPlatformStorage(t *testing.T) {
	err := storageUploadError(fmt.Errorf("variant persistence failed: %w", storage.ErrNotConfigured))
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeFailedPrecondition {
		t.Fatalf("error = %v, want %v", err, connect.CodeFailedPrecondition)
	}
	details := connectErr.Details()
	if len(details) != 1 {
		t.Fatalf("details = %d, want one ErrorInfo", len(details))
	}
	value, detailErr := details[0].Value()
	if detailErr != nil {
		t.Fatalf("detail Value(): %v", detailErr)
	}
	info, ok := value.(*errdetails.ErrorInfo)
	if !ok || info.Reason != rpcerrors.ReasonStorageNotConfigured {
		t.Fatalf("detail = %#v, want reason %q", value, rpcerrors.ReasonStorageNotConfigured)
	}
}
