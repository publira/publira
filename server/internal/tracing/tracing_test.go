package tracing

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
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

// The Dev Container turns tracing on for the whole shell, so every test
// that reads the environment sets what it needs rather than inheriting it.
// An empty value is how these tests express "unset": Enabled and
// Environment both treat it that way, and t.Setenv cannot unset.
func TestEnabledReadsTheEnvironment(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
		want  bool
	}{
		{name: "unset", value: "", want: false},
		{name: "true", value: "true", want: true},
		{name: "one", value: "1", want: true},
		{name: "false", value: "false", want: false},
		{name: "padded", value: "  true  ", want: true},
		{name: "garbage", value: "yes-please", want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(EnabledEnv, tc.value)
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
	t.Setenv(EnabledEnv, "false")
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

func TestEnvironmentDefaultsToDevelopment(t *testing.T) {
	t.Setenv(EnvironmentEnv, "")
	if got := Environment(); got != EnvironmentDevelopment {
		t.Errorf("Environment() = %q, want %q", got, EnvironmentDevelopment)
	}

	t.Setenv(EnvironmentEnv, "  Production ")
	if got := Environment(); got != "production" {
		t.Errorf("Environment() = %q, want production", got)
	}
}

// Sampling is what keeps a busy production service from exporting a span
// per request, so the tier has to pick the sampler and the operator has to
// be able to take it back.
func TestDefaultSamplerFollowsTheDeploymentTier(t *testing.T) {
	t.Run("development samples everything", func(t *testing.T) {
		t.Setenv(EnvironmentEnv, EnvironmentDevelopment)
		t.Setenv(samplerEnv, "")
		sampler, ok := defaultSampler()
		if !ok {
			t.Fatal("defaultSampler() declined to pick a sampler")
		}
		if want := sdktrace.ParentBased(sdktrace.AlwaysSample()).Description(); sampler.Description() != want {
			t.Errorf("sampler = %q, want %q", sampler.Description(), want)
		}
	})

	t.Run("production samples a share", func(t *testing.T) {
		t.Setenv(EnvironmentEnv, "production")
		t.Setenv(samplerEnv, "")
		sampler, ok := defaultSampler()
		if !ok {
			t.Fatal("defaultSampler() declined to pick a sampler")
		}
		want := sdktrace.ParentBased(sdktrace.TraceIDRatioBased(ProductionSampleRatio)).Description()
		if sampler.Description() != want {
			t.Errorf("sampler = %q, want %q", sampler.Description(), want)
		}
	})

	t.Run("the operator wins", func(t *testing.T) {
		t.Setenv(EnvironmentEnv, "production")
		t.Setenv("OTEL_TRACES_SAMPLER", "always_on")
		if _, ok := defaultSampler(); ok {
			t.Error("defaultSampler() overrode OTEL_TRACES_SAMPLER")
		}
	})
}

func TestRPCSpanNameDropsTheProtoPackage(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name      string
		procedure string
		want      string
	}{
		{
			name:      "admin procedure",
			procedure: "/publira.admin.v1.AdminSeriesService/ListSeries",
			want:      "AdminSeriesService/ListSeries",
		},
		{
			name:      "public procedure",
			procedure: "/publira.v1.CatalogService/GetEpisodeDetail",
			want:      "CatalogService/GetEpisodeDetail",
		},
		{name: "no leading slash", procedure: "publira.v1.AuthService/GetMe", want: "AuthService/GetMe"},
		{name: "no package", procedure: "/AuthService/GetMe", want: "AuthService/GetMe"},
		{name: "no method", procedure: "/publira.v1.AuthService", want: ""},
		{name: "empty", procedure: "", want: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := RPCSpanName(tc.procedure); got != tc.want {
				t.Errorf("RPCSpanName(%q) = %q, want %q", tc.procedure, got, tc.want)
			}
		})
	}
}

// The tenant and end user are the two dimensions an operator slices a
// trace by, and both must be the public IDs rather than the internal keys.
func TestSetTenantAndSetEndUserRecordPublicIDs(t *testing.T) {
	provider, recorder := recordingProvider(t)

	ctx, span := provider.Tracer("test").Start(t.Context(), "request")
	SetTenant(ctx, "TENANT001")
	SetEndUser(ctx, "USER001")
	// Empty values mean "not resolved yet" and must not be recorded.
	SetTenant(ctx, "")
	SetEndUser(ctx, "")
	span.End()

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("recorded %d spans, want 1", len(spans))
	}

	attributes := map[attribute.Key]string{}
	for _, kv := range spans[0].Attributes() {
		attributes[kv.Key] = kv.Value.AsString()
	}
	if got := attributes[TenantPublicIDKey]; got != "TENANT001" {
		t.Errorf("%s = %q, want TENANT001", TenantPublicIDKey, got)
	}
	if got := attributes[EndUserIDKey]; got != "USER001" {
		t.Errorf("%s = %q, want USER001", EndUserIDKey, got)
	}
	if len(spans[0].Attributes()) != 2 {
		t.Errorf("recorded %d attributes, want 2 (empty values must be dropped)", len(spans[0].Attributes()))
	}
}

// A span that is not recording must not pay for attribute construction or
// blow up; the helpers are called on every request whether tracing is on
// or off.
func TestSetTenantAndSetEndUserAreSafeWithoutASpan(t *testing.T) {
	t.Parallel()

	SetTenant(t.Context(), "TENANT001")
	SetEndUser(t.Context(), "USER001")
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
