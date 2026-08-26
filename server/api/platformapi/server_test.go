package platformapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/testutil"
)

func TestPlatformHandlerExposesOnlyPlatformRoutes(t *testing.T) {
	ts := httptest.NewServer(NewHandler(nil, nil, slog.Default(), nil, nil, testutil.TokenManager()))
	t.Cleanup(ts.Close)

	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformTenantService/ListTenants", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformTenantService/CreateTenant", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformEmailSettingsService/GetPlatformEmailSettings", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformAuthService/GetMe", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformNotificationService/ListNotifications", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformDashboardService/GetDashboardSummary", true)
	assertPlatformRouteRegistered(t, ts, "/publira.platform.v1.PlatformAuditLogService/ListAuditLogs", true)
	assertPlatformRouteRegistered(t, ts, "/publira.admin.v1.AdminSeriesService/ListSeries", false)
	assertPlatformRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", false)
}

func TestInternalDBErrorPreservesContextErrors(t *testing.T) {
	ctx := t.Context()
	server := &platformServer{logger: slog.Default()}

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
