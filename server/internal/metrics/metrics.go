// Package metrics exports the OpenTelemetry metrics the server processes
// record.
//
// The instruments themselves are created where the work happens — the
// Outbox drain, the asynchronous audit log, the otelhttp and otelsql
// instrumentation — against the global MeterProvider. Until Setup installs
// one, that provider is OpenTelemetry's no-op, so every instrument records
// nothing and no collector has to exist.
//
// Metrics are opt-in, like tracing, and with a flag of their own: a backend
// that accepts traces does not necessarily accept metrics, and the Dev
// Container's Jaeger is one that does not. The exporter is configured
// through the environment variables the OpenTelemetry SDK reads itself
// (OTEL_METRICS_EXPORTER, OTEL_EXPORTER_OTLP_*, OTEL_EXPORTER_PROMETHEUS_*,
// OTEL_METRIC_EXPORT_INTERVAL), so an operator configures it with the names
// the OpenTelemetry documentation uses.
package metrics

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"

	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/otel"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/publira/publira/server/internal/tracing"
)

// EnabledEnv is the environment variable that turns metrics on.
const EnabledEnv = "PUBLIRA_METRICS_ENABLED"

// noopShutdown is returned whenever no provider was installed, so callers
// can register the result without a nil check.
func noopShutdown(context.Context) error { return nil }

// Enabled reports whether PUBLIRA_METRICS_ENABLED asks for metrics.
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

// Setup installs the global MeterProvider, reporting under serviceName, and
// returns a shutdown that exports what was recorded since the last export
// and closes the exporter. When metrics are disabled Setup installs nothing
// and returns a no-op shutdown and a nil error.
//
// A process gets one provider, under its default service.name, even where
// its traces are split across several: a counter such as the Outbox's
// describes the process, not one of the namespaces it serves.
//
// The shutdown is shaped as an httpserver.Serve hook, so the counts of a
// process's last interval are exported rather than lost with it.
func Setup(ctx context.Context, serviceName string) (func(context.Context) error, error) {
	if !Enabled() {
		return noopShutdown, nil
	}

	reader, err := autoexport.NewMetricReader(ctx)
	if err != nil {
		return noopShutdown, err
	}
	res, err := tracing.NewResource(ctx, serviceName)
	if err != nil {
		// Nothing is installed yet, so the reader — which for Prometheus is
		// already listening — has no other way back.
		return noopShutdown, errors.Join(err, reader.Shutdown(ctx))
	}

	provider := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(reader),
		sdkmetric.WithResource(res),
	)
	tracing.InstallErrorHandler()
	otel.SetMeterProvider(provider)

	return provider.Shutdown, nil
}
