package tracing

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

// recordingProvider returns a provider that keeps every span in memory,
// together with the recorder holding them.
func recordingProvider(t *testing.T) (trace.TracerProvider, *tracetest.SpanRecorder) {
	t.Helper()

	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	// t.Context is already canceled by the time cleanups run.
	t.Cleanup(func() {
		if err := provider.Shutdown(context.Background()); err != nil {
			t.Errorf("provider.Shutdown: %v", err)
		}
	})
	return provider, recorder
}

// installGlobals points the global provider and propagator at the given
// provider and restores the previous ones afterwards, so tests that rely
// on the globals do not leak into each other.
func installGlobals(t *testing.T, provider trace.TracerProvider) {
	t.Helper()

	previousProvider := otel.GetTracerProvider()
	previousPropagator := otel.GetTextMapPropagator()
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})

	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
}

func TestEnabledReadsTheEnvironment(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
		set   bool
		want  bool
	}{
		{name: "unset", want: false},
		{name: "empty", value: "", set: true, want: false},
		{name: "true", value: "true", set: true, want: true},
		{name: "one", value: "1", set: true, want: true},
		{name: "false", value: "false", set: true, want: false},
		{name: "padded", value: "  true  ", set: true, want: true},
		{name: "garbage", value: "yes-please", set: true, want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.set {
				t.Setenv(EnabledEnv, tc.value)
			}
			if got := Enabled(); got != tc.want {
				t.Errorf("Enabled() = %v, want %v", got, tc.want)
			}
		})
	}
}

// With tracing off the process must look exactly as it did before
// instrumentation: no provider, no propagator, and a shutdown that is
// safe to call.
func TestSetupDisabledLeavesTheGlobalsAlone(t *testing.T) {
	before := noop.NewTracerProvider()
	installGlobals(t, before)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator())

	shutdown, err := Setup(t.Context(), "publira-test")
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if shutdown == nil {
		t.Fatal("Setup returned a nil shutdown")
	}
	if err := shutdown(t.Context()); err != nil {
		t.Errorf("shutdown: %v", err)
	}

	if got := otel.GetTracerProvider(); got != before {
		t.Errorf("TracerProvider = %T, want the provider installed before Setup", got)
	}
	if fields := otel.GetTextMapPropagator().Fields(); len(fields) != 0 {
		t.Errorf("propagator fields = %v, want none", fields)
	}
}

func TestSetupEnabledInstallsProviderAndPropagator(t *testing.T) {
	installGlobals(t, noop.NewTracerProvider())
	t.Setenv(EnabledEnv, "true")
	// "none" keeps the test from reaching for a collector.
	t.Setenv("OTEL_TRACES_EXPORTER", "none")

	shutdown, err := Setup(t.Context(), "publira-test")
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	t.Cleanup(func() {
		if err := shutdown(context.Background()); err != nil {
			t.Errorf("shutdown: %v", err)
		}
	})

	if _, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider); !ok {
		t.Errorf("TracerProvider = %T, want *sdktrace.TracerProvider", otel.GetTracerProvider())
	}

	fields := otel.GetTextMapPropagator().Fields()
	if !slices.Contains(fields, "traceparent") {
		t.Errorf("propagator fields = %v, want traceparent", fields)
	}
	if !slices.Contains(fields, "baggage") {
		t.Errorf("propagator fields = %v, want baggage", fields)
	}
}

// The middleware must continue the caller's trace rather than starting a
// new one, and the handler must see a context it can hang child spans off.
func TestHTTPMiddlewareContinuesTheIncomingTrace(t *testing.T) {
	provider, recorder := recordingProvider(t)
	installGlobals(t, provider)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /images/creators/{media_id}", func(_ http.ResponseWriter, r *http.Request) {
		_, span := provider.Tracer("test").Start(r.Context(), "load object")
		span.End()
	})

	server := httptest.NewServer(HTTPMiddleware(mux))
	t.Cleanup(server.Close)

	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, server.URL+"/images/creators/01J0", nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext: %v", err)
	}
	const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	request.Header.Set("traceparent", traceparent)

	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	_ = response.Body.Close()

	spans := recorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("recorded %d spans, want 2 (server + child)", len(spans))
	}

	// A span is recorded when it ends, so the child comes first.
	child, inbound := spans[0], spans[1]
	if inbound.SpanContext().TraceID().String() != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("server span trace = %s, want the caller's trace", inbound.SpanContext().TraceID())
	}
	if inbound.Parent().SpanID().String() != "00f067aa0ba902b7" {
		t.Errorf("server span parent = %s, want the caller's span", inbound.Parent().SpanID())
	}
	if child.Parent().SpanID() != inbound.SpanContext().SpanID() {
		t.Errorf("child parent = %s, want the server span %s", child.Parent().SpanID(), inbound.SpanContext().SpanID())
	}
	// The span is named after the route, not the URL, so a media ID does
	// not turn every request into its own span name.
	if want := "GET /images/creators/{media_id}"; inbound.Name() != want {
		t.Errorf("server span name = %q, want %q", inbound.Name(), want)
	}
}

func TestHTTPMiddlewareSkipsHealthProbes(t *testing.T) {
	provider, recorder := recordingProvider(t)
	installGlobals(t, provider)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /livez", func(http.ResponseWriter, *http.Request) {})
	mux.HandleFunc("GET /readyz", func(http.ResponseWriter, *http.Request) {})

	server := httptest.NewServer(HTTPMiddleware(mux))
	t.Cleanup(server.Close)

	for _, path := range []string{"/livez", "/readyz"} {
		request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, server.URL+path, nil)
		if err != nil {
			t.Fatalf("NewRequestWithContext: %v", err)
		}
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatalf("Do %s: %v", path, err)
		}
		_ = response.Body.Close()
	}

	if spans := recorder.Ended(); len(spans) != 0 {
		t.Errorf("recorded %d spans for the health probes, want 0", len(spans))
	}
}

func TestTransportInjectsTheTraceContext(t *testing.T) {
	provider, _ := recordingProvider(t)
	installGlobals(t, provider)

	var received string
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		received = r.Header.Get("traceparent")
	}))
	t.Cleanup(server.Close)

	ctx, span := provider.Tracer("test").Start(t.Context(), "outbound")
	defer span.End()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext: %v", err)
	}
	client := &http.Client{Transport: Transport(http.DefaultTransport)}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	_ = response.Body.Close()

	if received == "" {
		t.Fatal("no traceparent header reached the server")
	}
	if want := span.SpanContext().TraceID().String(); !strings.Contains(received, want) {
		t.Errorf("traceparent = %q, want it to carry trace %s", received, want)
	}
}
