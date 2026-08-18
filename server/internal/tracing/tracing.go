// Package tracing wires OpenTelemetry tracing into the server processes.
//
// Tracing is opt-in. Without PUBLIRA_TRACING_ENABLED the global
// TracerProvider and propagator are left untouched, so every helper below
// falls back to OpenTelemetry's no-op implementations: spans are not
// recorded, nothing is exported, and no collector has to exist.
//
// Everything except the on/off switch is configured through the
// environment variables the OpenTelemetry SDK reads itself
// (OTEL_SERVICE_NAME, OTEL_RESOURCE_ATTRIBUTES, OTEL_TRACES_EXPORTER,
// OTEL_EXPORTER_OTLP_*, OTEL_TRACES_SAMPLER), so an operator configures
// the exporter with the names the OpenTelemetry documentation uses.
package tracing

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"connectrpc.com/otelconnect"
	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
)

// EnabledEnv is the environment variable that turns tracing on.
const EnabledEnv = "PUBLIRA_TRACING_ENABLED"

// noopShutdown is returned whenever no provider was installed, so callers
// can register the result without a nil check.
func noopShutdown(context.Context) error { return nil }

// Enabled reports whether PUBLIRA_TRACING_ENABLED asks for tracing.
func Enabled() bool {
	raw := strings.TrimSpace(os.Getenv(EnabledEnv))
	if raw == "" {
		return false
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return false
	}
	return enabled
}

// Setup installs the global TracerProvider and the W3C trace context
// propagator, and returns a shutdown that flushes the pending span batch.
//
// serviceName is the process-level default for service.name;
// OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES override it. When
// tracing is disabled Setup installs nothing and returns a no-op
// shutdown and a nil error.
//
// The shutdown is shaped as an httpserver.Serve hook: the batch processor
// holds up to a batch interval of spans, and the run's last spans are the
// ones a deploy or a crash makes you want.
func Setup(ctx context.Context, serviceName string) (func(context.Context) error, error) {
	if !Enabled() {
		return noopShutdown, nil
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceName(serviceName)),
		resource.WithTelemetrySDK(),
		resource.WithHost(),
		resource.WithProcessPID(),
		// Last so OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES win over
		// the per-binary default above.
		resource.WithFromEnv(),
	)
	if err != nil {
		return noopShutdown, err
	}

	exporter, err := autoexport.NewSpanExporter(ctx)
	if err != nil {
		return noopShutdown, err
	}

	// No WithSampler: the SDK reads OTEL_TRACES_SAMPLER itself, and
	// passing one here would override the operator's choice.
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)

	// The default error handler writes to the standard logger, which
	// bypasses the structured logging the servers set up.
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		slog.Warn("opentelemetry error", "error", err)
	}))
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return provider.Shutdown, nil
}

// ConnectHandlerOption returns the handler option that starts a server
// span for every inbound Connect / gRPC call and continues the caller's
// trace from the request headers.
//
// WithTrustRemote makes the incoming traceparent the span's parent
// instead of a link. Without it every RPC starts a fresh trace and a
// request cannot be followed from the web app through the API into the
// queries it issues, which is the whole point of the instrumentation.
// The callers here are the first-party Next.js apps reaching the API
// through the internal gateway; a forged traceparent buys an attacker
// nothing but a polluted trace.
//
// Pass the option unconditionally: with tracing disabled the interceptor
// records into the no-op TracerProvider.
func ConnectHandlerOption() connect.HandlerOption {
	interceptor, err := otelconnect.NewInterceptor(
		otelconnect.WithTrustRemote(),
		otelconnect.WithoutMetrics(),
	)
	if err != nil {
		slog.Warn("connect rpc tracing is disabled", "error", err)
		return connect.WithInterceptors()
	}
	return connect.WithInterceptors(interceptor)
}

// HTTPMiddleware starts a server span for every inbound request handled
// by h, except the health probes: those would produce a span per scrape
// without ever explaining a user-visible latency.
//
// The span is named after the ServeMux pattern that matched, not the
// request path, so an image URL carrying a media ID does not turn every
// request into its own span name. otelhttp renames the span once the
// inner mux has filled in Request.Pattern.
func HTTPMiddleware(h http.Handler) http.Handler {
	return otelhttp.NewHandler(h, "",
		otelhttp.WithFilter(func(r *http.Request) bool {
			switch r.URL.Path {
			case "/livez", "/readyz":
				return false
			default:
				return true
			}
		}),
	)
}

// Transport wraps base so outbound requests carry the caller's trace
// context and show up as client spans. A nil base means
// http.DefaultTransport.
func Transport(base http.RoundTripper) http.RoundTripper {
	return otelhttp.NewTransport(base)
}
