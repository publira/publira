package auditlog

import (
	"context"
	"sync/atomic"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const meterName = "github.com/publira/publira/server/internal/auditlog"

type otelInstruments struct {
	enqueued   metric.Int64Counter
	persisted  metric.Int64Counter
	failed     metric.Int64Counter
	dropped    metric.Int64Counter
	queueDepth metric.Int64ObservableGauge
	entryType  attribute.Key
	dropReason attribute.Key
}

func newOTELInstruments() otelInstruments {
	meter := otel.Meter(meterName)
	enqueued, _ := meter.Int64Counter("publira.auditlog.entries.enqueued",
		metric.WithDescription("Audit log entries accepted by the asynchronous queue"),
		metric.WithUnit("{entry}"),
	)
	persisted, _ := meter.Int64Counter("publira.auditlog.entries.persisted",
		metric.WithDescription("Audit log entries persisted asynchronously"),
		metric.WithUnit("{entry}"),
	)
	failed, _ := meter.Int64Counter("publira.auditlog.persist.failures",
		metric.WithDescription("Failed asynchronous audit log persistence attempts"),
		metric.WithUnit("{attempt}"),
	)
	dropped, _ := meter.Int64Counter("publira.auditlog.entries.dropped",
		metric.WithDescription("Audit log entries dropped before persistence"),
		metric.WithUnit("{entry}"),
	)
	queueDepth, _ := meter.Int64ObservableGauge("publira.auditlog.queue.depth",
		metric.WithDescription("Audit log entries waiting in the asynchronous queue"),
		metric.WithUnit("{entry}"),
	)
	return otelInstruments{
		enqueued:   enqueued,
		persisted:  persisted,
		failed:     failed,
		dropped:    dropped,
		queueDepth: queueDepth,
		entryType:  attribute.Key("auditlog.entry_type"),
		dropReason: attribute.Key("auditlog.drop_reason"),
	}
}

// Metrics is the in-process view of the counters exported through
// OpenTelemetry. Tests and diagnostics can read these atomics directly.
type Metrics struct {
	QueueDepth atomic.Int64
	InFlight   atomic.Int64
	Enqueued   atomic.Int64
	Persisted  atomic.Int64
	Failed     atomic.Int64
	Dropped    atomic.Int64

	otel otelInstruments
}

func newMetrics() *Metrics {
	m := &Metrics{otel: newOTELInstruments()}
	_, _ = otel.Meter(meterName).RegisterCallback(func(_ context.Context, observer metric.Observer) error {
		observer.ObserveInt64(m.otel.queueDepth, m.QueueDepth.Load())
		return nil
	}, m.otel.queueDepth)
	return m
}

func (m *Metrics) recordEnqueued(entryType string) {
	m.Enqueued.Add(1)
	m.otel.enqueued.Add(context.Background(), 1, metric.WithAttributes(m.otel.entryType.String(entryType)))
}

func (m *Metrics) recordPersisted(entryType string) {
	m.Persisted.Add(1)
	m.otel.persisted.Add(context.Background(), 1, metric.WithAttributes(m.otel.entryType.String(entryType)))
}

func (m *Metrics) recordFailed(entryType string) {
	m.Failed.Add(1)
	m.otel.failed.Add(context.Background(), 1, metric.WithAttributes(m.otel.entryType.String(entryType)))
}

func (m *Metrics) recordDropped(entryType, reason string) {
	m.Dropped.Add(1)
	m.otel.dropped.Add(context.Background(), 1, metric.WithAttributes(
		m.otel.entryType.String(entryType),
		m.otel.dropReason.String(reason),
	))
}
