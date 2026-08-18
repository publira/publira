package publicapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"go.opentelemetry.io/otel/trace"

	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/testutil"
)

// TestPublicHandlerExposesOnlyPublicRoutes は、NewHandler が公開 API (CatalogService, AuthService) だけ
// 公開し、管理 API (AdminSeriesService, AdminAuthService) は登録しないことを検証する。
func TestPublicHandlerExposesOnlyPublicRoutes(t *testing.T) {
	ts := newPublicRouteTestServer(t)
	t.Cleanup(ts.Close)

	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/ListPublishedAuthors", true)
	assertRouteRegistered(t, ts, "/publira.v1.CatalogService/GetPublishedAuthorDetail", true)
	assertRouteRegistered(t, ts, "/publira.v1.PurchaseService/StartEpisodeCheckout", true)
	assertRouteRegistered(t, ts, "/publira.v1.PurchaseService/ListMyPurchases", true)
	assertRouteRegistered(t, ts, "/publira.v1.PurchaseService/ProcessStripeWebhook", true)
	assertRouteRegistered(t, ts, "/webhooks/stripe", false)
	assertRouteRegistered(t, ts, "/publira.v1.PublicPagesService/ListPublishedPages", true)
	assertRouteRegistered(t, ts, "/publira.v1.AuthService/GetMe", true)
	assertRouteRegistered(t, ts, "/publira.v1.AuthService/GetAnnouncement", true)
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
	return httptest.NewServer(NewHandler(nil, nil, nil, nil, nil, testutil.TokenManager()))
}

type captureHandler struct {
	records []slog.Record
}

func (h *captureHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *captureHandler) Handle(_ context.Context, r slog.Record) error {
	h.records = append(h.records, r.Clone())
	return nil
}

func (h *captureHandler) WithAttrs([]slog.Attr) slog.Handler { return h }

func (h *captureHandler) WithGroup(string) slog.Handler { return h }

func (h *captureHandler) errorAttr() error {
	for _, rec := range h.records {
		var logged error
		rec.Attrs(func(a slog.Attr) bool {
			if a.Key == "error" {
				logged, _ = a.Value.Any().(error)
				return false
			}
			return true
		})
		if logged != nil {
			return logged
		}
	}
	return nil
}

// A DB failure is the log line an operator reaches for first, so it has
// to carry the trace it belongs to. internalDBError is the shared path
// every handler funnels those failures through.
func TestInternalDBErrorLogsTheTraceOfTheRequest(t *testing.T) {
	handler := &captureHandler{}
	server := &apiServer{logger: slog.New(logging.NewTraceHandler(handler))}

	traceID, err := trace.TraceIDFromHex("4bf92f3577b34da6a3ce929d0e0e4736")
	if err != nil {
		t.Fatalf("TraceIDFromHex: %v", err)
	}
	spanID, err := trace.SpanIDFromHex("00f067aa0ba902b7")
	if err != nil {
		t.Fatalf("SpanIDFromHex: %v", err)
	}
	ctx := trace.ContextWithSpanContext(t.Context(), trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: traceID,
		SpanID:  spanID,
	}))

	_ = server.internalDBError(ctx, "failed to list example", errors.New(`pq: relation "x" does not exist`))

	if len(handler.records) != 1 {
		t.Fatalf("logged %d records, want 1", len(handler.records))
	}
	var logged string
	handler.records[0].Attrs(func(a slog.Attr) bool {
		if a.Key == logging.TraceIDKey {
			logged = a.Value.String()
			return false
		}
		return true
	})
	if logged != traceID.String() {
		t.Errorf("%s = %q, want %s", logging.TraceIDKey, logged, traceID)
	}
}

func TestInternalDBErrorPreservesContextErrors(t *testing.T) {
	handler := &captureHandler{}
	ctx := t.Context()
	server := &apiServer{logger: slog.New(handler)}

	if got := server.internalDBError(ctx, "ignored", context.Canceled); !errors.Is(got, context.Canceled) {
		t.Fatalf("canceled error = %v, want context.Canceled", got)
	}
	if got := server.internalDBError(ctx, "ignored", context.DeadlineExceeded); !errors.Is(got, context.DeadlineExceeded) {
		t.Fatalf("deadline error = %v, want context.DeadlineExceeded", got)
	}
	if len(handler.records) != 0 {
		t.Fatalf("context errors must not be logged, got %d records", len(handler.records))
	}

	driverErr := errors.New(`pq: relation "x" does not exist`)
	err := server.internalDBError(ctx, "failed to list example", driverErr)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	if len(handler.records) != 1 {
		t.Fatalf("logged %d records, want 1", len(handler.records))
	}
	if handler.records[0].Message != "failed to list example" {
		t.Fatalf("log message = %q, want failed to list example", handler.records[0].Message)
	}
	if logged := handler.errorAttr(); logged == nil || logged.Error() != driverErr.Error() {
		t.Fatalf("logged error = %v, want original database error", logged)
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
