package platformapi

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/publira/publira/server/internal/testutil"
)

// An inbound RPC must continue the caller's trace instead of starting its
// own, which is what lets one trace span the web app, the API, and the
// queries the API issues.
func TestConnectHandlerContinuesTheCallersTrace(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))

	previousProvider := otel.GetTracerProvider()
	previousPropagator := otel.GetTextMapPropagator()
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
		if err := provider.Shutdown(context.Background()); err != nil {
			t.Errorf("provider.Shutdown: %v", err)
		}
	})
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	// NewHandler builds the interceptor, so it has to run after the
	// globals above are in place.
	ts := httptest.NewServer(NewHandler(nil, nil, slog.Default(), nil, nil, nil, testutil.TokenManager()))
	t.Cleanup(ts.Close)

	const procedure = "/publira.platform.v1.PlatformTenantService/ListTenants"
	request, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		ts.URL+procedure,
		strings.NewReader("{}"),
	)
	if err != nil {
		t.Fatalf("NewRequestWithContext: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")

	// The call is unauthenticated on purpose: the span must be recorded
	// for a failing RPC too, which is when a trace is worth having.
	response, err := ts.Client().Do(request)
	if err != nil {
		t.Fatalf("POST %s: %v", procedure, err)
	}
	_ = response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		t.Fatalf("POST %s: route is not registered", procedure)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("recorded %d spans, want 1", len(spans))
	}
	span := spans[0]
	if got := span.SpanContext().TraceID().String(); got != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("trace = %s, want the caller's trace", got)
	}
	if got := span.Parent().SpanID().String(); got != "00f067aa0ba902b7" {
		t.Errorf("parent = %s, want the caller's span", got)
	}
	if want := "publira.platform.v1.PlatformTenantService/ListTenants"; span.Name() != want {
		t.Errorf("span name = %q, want %q", span.Name(), want)
	}
}
