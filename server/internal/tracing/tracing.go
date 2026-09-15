// Package tracing wires OpenTelemetry tracing into the server processes.
//
// Tracing is opt-in. Without PUBLIRA_TRACING_ENABLED the global
// TracerProvider and propagator are left untouched, so every helper below
// falls back to OpenTelemetry's no-op implementations: spans are not
// recorded, nothing is exported, and no collector has to exist.
//
// The exporter is configured through the environment variables the
// OpenTelemetry SDK reads itself (OTEL_SERVICE_NAME,
// OTEL_RESOURCE_ATTRIBUTES, OTEL_TRACES_EXPORTER, OTEL_EXPORTER_OTLP_*,
// OTEL_TRACES_SAMPLER), so an operator configures it with the names the
// OpenTelemetry documentation uses.
//
// The attribute names, span names, and sampling defaults follow the
// observability specification agreed in
// https://github.com/publira/publira/issues/502.
package tracing

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync/atomic"

	"connectrpc.com/connect"
	"connectrpc.com/otelconnect"
	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/publira/publira/server/internal/buildinfo"
)

const (
	// EnabledEnv is the environment variable that turns tracing on.
	EnabledEnv = "PUBLIRA_TRACING_ENABLED"

	// EnvironmentEnv names the deployment tier the process runs in. It
	// decides the default sampling rate as well as the resource
	// attribute, so a mislabelled process is a costly mistake rather
	// than a cosmetic one.
	EnvironmentEnv = "PUBLIRA_DEPLOYMENT_ENVIRONMENT"

	// samplerEnv is read only to detect whether the operator has taken
	// over sampling; the SDK is what parses it.
	samplerEnv = "OTEL_TRACES_SAMPLER"

	// EnvironmentDevelopment is the assumed tier when EnvironmentEnv is
	// unset. Tracing is opt-in, so a process with tracing on and no
	// declared tier is someone trying it out locally.
	EnvironmentDevelopment = "development"

	// ProductionSampleRatio is the share of root spans sampled outside
	// development. Override it with OTEL_TRACES_SAMPLER /
	// OTEL_TRACES_SAMPLER_ARG.
	ProductionSampleRatio = 0.1
)

// TenantPublicIDKey and EndUserIDKey identify the tenant and the signed-in
// end user a span was produced for. Both are public IDs: the internal
// UUIDs, e-mail addresses, and tokens never reach telemetry.
const (
	TenantPublicIDKey = attribute.Key("tenant.public_id")
	EndUserIDKey      = semconv.EnduserIDKey
)

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

// Environment returns the deployment tier from PUBLIRA_DEPLOYMENT_ENVIRONMENT,
// defaulting to [EnvironmentDevelopment].
func Environment() string {
	if env := strings.TrimSpace(os.Getenv(EnvironmentEnv)); env != "" {
		return strings.ToLower(env)
	}
	return EnvironmentDevelopment
}

// defaultSampler returns the sampler for the current deployment tier, and
// false when the operator has set OTEL_TRACES_SAMPLER and the SDK should
// parse that instead.
//
// Development samples every root span, because a trace you cannot find is
// worth nothing while debugging. Every other tier samples a share of them,
// since a busy production service would otherwise export a span for every
// request. Both are parent-based, so a sampled request stays sampled all
// the way through the services it touches.
func defaultSampler() (sdktrace.Sampler, bool) {
	if strings.TrimSpace(os.Getenv(samplerEnv)) != "" {
		return nil, false
	}
	if Environment() == EnvironmentDevelopment {
		return sdktrace.ParentBased(sdktrace.AlwaysSample()), true
	}
	return sdktrace.ParentBased(sdktrace.TraceIDRatioBased(ProductionSampleRatio)), true
}

// SetTenant records the tenant a span was produced for, once the request
// has resolved one. Empty IDs and spans that are not recording are ignored,
// so call sites do not need to check either.
func SetTenant(ctx context.Context, tenantPublicID string) {
	if tenantPublicID == "" {
		return
	}
	trace.SpanFromContext(ctx).SetAttributes(TenantPublicIDKey.String(tenantPublicID))
}

// SetEndUser records the signed-in user a span was produced for, once the
// request has authenticated one. Pass the public ID: the internal UUID and
// the e-mail address must not reach telemetry.
func SetEndUser(ctx context.Context, userPublicID string) {
	if userPublicID == "" {
		return
	}
	trace.SpanFromContext(ctx).SetAttributes(EndUserIDKey.String(userPublicID))
}

// serviceProviders holds the provider Setup built for each service name, so
// ConnectHandlerOption can send a namespace's spans to the one carrying its
// service.name. It is written once at startup and read while the handlers are
// built; a name Setup was never given falls back to the global provider.
var serviceProviders atomic.Pointer[map[string]trace.TracerProvider]

// Setup installs a TracerProvider for every service name given along with the
// W3C trace context propagator, and returns a shutdown that flushes the
// pending span batches.
//
// The first name is the process default: its provider becomes the global one,
// so the database instrumentation and the outbound HTTP clients report under
// it. A process that serves several API namespaces passes one name per
// namespace and reaches the rest through ConnectHandlerOption, which is what
// keeps those namespaces apart in a trace UI now that they share a process.
// OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES override every one of them.
// When tracing is disabled Setup installs nothing and returns a no-op
// shutdown and a nil error.
//
// The shutdown is shaped as an httpserver.Serve hook: the batch processor
// holds up to a batch interval of spans, and the run's last spans are the
// ones a deploy or a crash makes you want.
func Setup(ctx context.Context, serviceNames ...string) (func(context.Context) error, error) {
	if !Enabled() || len(serviceNames) == 0 {
		return noopShutdown, nil
	}

	exporter, err := autoexport.NewSpanExporter(ctx)
	if err != nil {
		return noopShutdown, err
	}

	sampler, sampled := defaultSampler()
	providers := make(map[string]trace.TracerProvider, len(serviceNames))
	shutdowns := make([]func(context.Context) error, 0, len(serviceNames))
	for _, serviceName := range serviceNames {
		res, resErr := newResource(ctx, serviceName)
		if resErr != nil {
			// Nothing is installed yet, so the exporter it was going to feed
			// has no other way back.
			return noopShutdown, errors.Join(resErr, exporter.Shutdown(ctx))
		}
		options := []sdktrace.TracerProviderOption{
			// The exporter is shared, and only the shutdown below closes it:
			// a provider that closed it on its way out would leave the others
			// exporting into a stopped exporter.
			sdktrace.WithBatcher(sharedExporter{exporter}),
			sdktrace.WithResource(res),
		}
		if sampled {
			options = append(options, sdktrace.WithSampler(sampler))
		}
		provider := sdktrace.NewTracerProvider(options...)
		providers[serviceName] = provider
		shutdowns = append(shutdowns, provider.Shutdown)
	}

	// The default error handler writes to the standard logger, which
	// bypasses the structured logging the servers set up.
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		slog.Warn("opentelemetry error", "error", err)
	}))
	otel.SetTracerProvider(providers[serviceNames[0]])
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	serviceProviders.Store(&providers)

	return func(ctx context.Context) error {
		serviceProviders.Store(nil)
		errs := make([]error, 0, len(shutdowns)+1)
		for _, shutdown := range shutdowns {
			errs = append(errs, shutdown(ctx))
		}
		return errors.Join(append(errs, exporter.Shutdown(ctx))...)
	}, nil
}

func newResource(ctx context.Context, serviceName string) (*resource.Resource, error) {
	return resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			semconv.ServiceVersion(buildinfo.Version()),
			semconv.DeploymentEnvironmentNameKey.String(Environment()),
		),
		resource.WithTelemetrySDK(),
		resource.WithHost(),
		resource.WithProcessPID(),
		// Last so OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES win over
		// the per-binary defaults above.
		resource.WithFromEnv(),
	)
}

// sharedExporter is one exporter handed to several providers, with Shutdown
// declined so each provider still flushes its own batch while the export
// connection is closed once, after all of them have.
type sharedExporter struct {
	sdktrace.SpanExporter
}

func (sharedExporter) Shutdown(context.Context) error { return nil }

// ConnectHandlerOption returns the handler option that starts a server
// span for every inbound Connect / gRPC call and continues the caller's
// trace from the request headers.
//
// WithTrustRemote makes the incoming traceparent the span's parent
// instead of a link. Without it every RPC starts a fresh trace and a
// request cannot be followed from the web app through the API into the
// queries it issues, which is the whole point of the instrumentation.
//
// Trusting that header is only safe because the gateway is the trust
// boundary: it drops traceparent / tracestate / baggage from every
// request that arrives on an external entrypoint, so what reaches these
// servers is first-party trace context or none at all. A forged
// traceparent would otherwise graft spans onto someone else's trace, and
// a forged sampled flag would force export past the production sampling
// ratio.
//
// Pass the option unconditionally: with tracing disabled the interceptors
// record into the no-op TracerProvider.
//
// serviceName picks the provider Setup built for it, so the spans carry the
// service.name of the API namespace rather than of the process it shares. A
// name Setup was not given — every name while tracing is disabled — falls
// back to the global provider.
func ConnectHandlerOption(serviceName string) connect.HandlerOption {
	options := []otelconnect.Option{
		otelconnect.WithTrustRemote(),
		otelconnect.WithoutMetrics(),
	}
	if provider, ok := serviceProvider(serviceName); ok {
		options = append(options, otelconnect.WithTracerProvider(provider))
	}
	interceptor, err := otelconnect.NewInterceptor(options...)
	if err != nil {
		slog.Warn("connect rpc tracing is disabled", "error", err)
		return connect.WithInterceptors()
	}
	// The renaming interceptor has to run inside the otelconnect one so
	// the span it renames already exists.
	return connect.WithInterceptors(interceptor, rpcSpanNameInterceptor())
}

// TracerProvider returns the provider Setup built for serviceName, so work
// that shares a process with another service can record its spans under its
// own service.name instead of the process default. A name Setup was not given
// — every name while tracing is disabled — falls back to the global provider,
// which is the no-op one when tracing is off.
func TracerProvider(serviceName string) trace.TracerProvider {
	if provider, ok := serviceProvider(serviceName); ok {
		return provider
	}
	return otel.GetTracerProvider()
}

func serviceProvider(serviceName string) (trace.TracerProvider, bool) {
	providers := serviceProviders.Load()
	if providers == nil {
		return nil, false
	}
	provider, ok := (*providers)[serviceName]
	return provider, ok
}

// rpcSpanNameInterceptor shortens the span name otelconnect derives from
// the procedure. The proto package prefix is the same for every RPC a
// server handles, so it costs width in a trace UI without telling anyone
// anything; rpc.system, rpc.service, and rpc.method keep the full detail
// as attributes.
func rpcSpanNameInterceptor() connect.Interceptor {
	return connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if name := RPCSpanName(req.Spec().Procedure); name != "" {
				trace.SpanFromContext(ctx).SetName(name)
			}
			return next(ctx, req)
		}
	})
}

// RPCSpanName turns a Connect procedure into the span name, dropping the
// proto package: "/publira.admin.v1.AdminSeriesService/ListSeries" becomes
// "AdminSeriesService/ListSeries". It returns an empty string for a
// procedure it cannot parse, so the caller leaves the name as it was.
func RPCSpanName(procedure string) string {
	qualified, method, ok := strings.Cut(strings.TrimPrefix(procedure, "/"), "/")
	if !ok || qualified == "" || method == "" {
		return ""
	}
	if index := strings.LastIndex(qualified, "."); index >= 0 {
		qualified = qualified[index+1:]
	}
	if qualified == "" {
		return ""
	}
	return qualified + "/" + method
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
