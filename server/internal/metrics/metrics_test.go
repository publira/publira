package metrics

import (
	"context"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/metric/noop"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

// installGlobal points the global MeterProvider at provider and restores the
// previous one afterwards, so tests that rely on it do not leak into each
// other.
func installGlobal(t *testing.T, provider metric.MeterProvider) {
	t.Helper()

	previous := otel.GetMeterProvider()
	t.Cleanup(func() { otel.SetMeterProvider(previous) })
	otel.SetMeterProvider(provider)
}

// An empty value is how these tests express "unset": Enabled treats it that
// way, and t.Setenv cannot unset.
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
		{name: "uninterpretable", value: "yes please", want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(EnabledEnv, tc.value)
			if got := Enabled(); got != tc.want {
				t.Errorf("Enabled() with %q = %v, want %v", tc.value, got, tc.want)
			}
		})
	}
}

func TestSetupDisabledLeavesTheGlobalAlone(t *testing.T) {
	t.Setenv(EnabledEnv, "")
	before := noop.NewMeterProvider()
	installGlobal(t, before)

	shutdown, err := Setup(t.Context(), "publira-test")
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := shutdown(t.Context()); err != nil {
		t.Errorf("shutdown: %v", err)
	}

	if got := otel.GetMeterProvider(); got != before {
		t.Errorf("MeterProvider = %T, want the provider installed before Setup", got)
	}
}

func TestSetupEnabledInstallsAProvider(t *testing.T) {
	installGlobal(t, noop.NewMeterProvider())
	t.Setenv(EnabledEnv, "true")
	// "none" keeps the test from reaching for a collector.
	t.Setenv("OTEL_METRICS_EXPORTER", "none")

	shutdown, err := Setup(t.Context(), "publira-test")
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	t.Cleanup(func() {
		if err := shutdown(context.Background()); err != nil {
			t.Errorf("shutdown: %v", err)
		}
	})

	if _, ok := otel.GetMeterProvider().(*sdkmetric.MeterProvider); !ok {
		t.Errorf("MeterProvider = %T, want *sdkmetric.MeterProvider", otel.GetMeterProvider())
	}
}

// TestSetupExportsWhatTheGlobalMeterRecords follows a count from an
// instrument created the way the Outbox creates its own — from otel.Meter,
// with no reference to this package — to the exporter, scraping it over the
// Prometheus endpoint an operator would point a scraper at.
func TestSetupExportsWhatTheGlobalMeterRecords(t *testing.T) {
	installGlobal(t, noop.NewMeterProvider())
	t.Setenv(EnabledEnv, "true")
	t.Setenv("OTEL_METRICS_EXPORTER", "prometheus")
	t.Setenv("OTEL_EXPORTER_PROMETHEUS_HOST", "127.0.0.1")
	port := freePort(t)
	t.Setenv("OTEL_EXPORTER_PROMETHEUS_PORT", port)

	shutdown, err := Setup(t.Context(), "publira-test")
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	t.Cleanup(func() {
		if err := shutdown(context.Background()); err != nil {
			t.Errorf("shutdown: %v", err)
		}
	})

	counter, err := otel.Meter("github.com/publira/publira/server/internal/metrics_test").
		Int64Counter("publira.test.events.dead", metric.WithUnit("{event}"))
	if err != nil {
		t.Fatalf("Int64Counter: %v", err)
	}
	counter.Add(t.Context(), 3)

	body := scrape(t, "http://127.0.0.1:"+port+"/metrics")
	if !strings.Contains(body, "publira_test_events_dead_total") {
		t.Errorf("scrape does not carry the counter:\n%s", body)
	}
	if !strings.Contains(body, `service_name="publira-test"`) {
		t.Errorf("scrape does not name the service:\n%s", body)
	}
}

func freePort(t *testing.T) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return strconv.Itoa(port)
}

func scrape(t *testing.T, url string) string {
	t.Helper()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	body, err := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET %s = %d:\n%s", url, res.StatusCode, body)
	}
	return string(body)
}
