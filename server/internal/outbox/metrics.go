package outbox

import (
	"context"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const meterName = "github.com/publira/publira/server/internal/outbox"

type otelInstruments struct {
	claimed          metric.Int64Counter
	done             metric.Int64Counter
	retry            metric.Int64Counter
	dead             metric.Int64Counter
	handlerDuration  metric.Float64Histogram
	eventTypeAttrKey attribute.Key
}

func newOTELInstruments() otelInstruments {
	meter := otel.Meter(meterName)
	claimed, _ := meter.Int64Counter("publira.outbox.events.claimed",
		metric.WithDescription("Outbox rows claimed from pending into processing"),
		metric.WithUnit("{event}"),
	)
	done, _ := meter.Int64Counter("publira.outbox.events.done",
		metric.WithDescription("Outbox rows marked done"),
		metric.WithUnit("{event}"),
	)
	retry, _ := meter.Int64Counter("publira.outbox.events.retry",
		metric.WithDescription("Outbox rows returned to pending after a handler failure"),
		metric.WithUnit("{event}"),
	)
	dead, _ := meter.Int64Counter("publira.outbox.events.dead",
		metric.WithDescription("Outbox rows marked dead after exhausting retries or a permanent error"),
		metric.WithUnit("{event}"),
	)
	handlerDuration, _ := meter.Float64Histogram("publira.outbox.handler.duration",
		metric.WithDescription("Handler wall time"),
		metric.WithUnit("s"),
	)
	return otelInstruments{
		claimed:          claimed,
		done:             done,
		retry:            retry,
		dead:             dead,
		handlerDuration:  handlerDuration,
		eventTypeAttrKey: attribute.Key("outbox.event_type"),
	}
}

// Metrics is the in-process view of the same counters the worker exports
// through OpenTelemetry. Tests read the atomics; operators read the
// instruments (no-op unless a MeterProvider is installed).
type Metrics struct {
	Claimed atomic.Int64
	Done    atomic.Int64
	Retry   atomic.Int64
	Dead    atomic.Int64

	otel otelInstruments
}

func newMetrics() *Metrics {
	return &Metrics{otel: newOTELInstruments()}
}

func (m *Metrics) recordClaimed(ctx context.Context, eventType string) {
	if m == nil {
		return
	}
	m.Claimed.Add(1)
	m.otel.claimed.Add(ctx, 1, metric.WithAttributes(m.otel.eventTypeAttrKey.String(eventType)))
}

func (m *Metrics) recordDone(ctx context.Context, eventType string) {
	if m == nil {
		return
	}
	m.Done.Add(1)
	m.otel.done.Add(ctx, 1, metric.WithAttributes(m.otel.eventTypeAttrKey.String(eventType)))
}

func (m *Metrics) recordRetry(ctx context.Context, eventType string) {
	if m == nil {
		return
	}
	m.Retry.Add(1)
	m.otel.retry.Add(ctx, 1, metric.WithAttributes(m.otel.eventTypeAttrKey.String(eventType)))
}

func (m *Metrics) recordDead(ctx context.Context, eventType string) {
	if m == nil {
		return
	}
	m.Dead.Add(1)
	m.otel.dead.Add(ctx, 1, metric.WithAttributes(m.otel.eventTypeAttrKey.String(eventType)))
}

func (m *Metrics) recordHandlerDuration(ctx context.Context, eventType string, d time.Duration) {
	if m == nil {
		return
	}
	m.otel.handlerDuration.Record(ctx, d.Seconds(), metric.WithAttributes(m.otel.eventTypeAttrKey.String(eventType)))
}
