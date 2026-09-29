// Package logging holds the slog wiring shared by the server processes.
//
// The trace handler is what makes a log line and a trace findable from
// one another: every record logged with a context that carries a span
// gains the same trace_id the exporter sends to the collector, so an
// error in the log can be pasted into the trace UI and vice versa.
package logging

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel/trace"
)

const (
	// TraceIDKey and SpanIDKey are the attribute names the correlation
	// relies on. They match the field names OpenTelemetry-aware log
	// backends expect.
	TraceIDKey = "trace_id"
	SpanIDKey  = "span_id"
)

// traceHandler adds trace_id / span_id to every record whose context
// carries a valid span context.
type traceHandler struct {
	inner slog.Handler
}

// NewTraceHandler wraps inner so records logged through the *Context
// methods (ErrorContext, InfoContext, ...) carry the current trace and
// span IDs. Records logged without a context, or outside a span, are
// passed through unchanged.
func NewTraceHandler(inner slog.Handler) slog.Handler {
	return &traceHandler{inner: inner}
}

func (h *traceHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *traceHandler) Handle(ctx context.Context, record slog.Record) error {
	spanCtx := trace.SpanContextFromContext(ctx)
	if spanCtx.IsValid() {
		record = record.Clone()
		record.AddAttrs(
			slog.String(TraceIDKey, spanCtx.TraceID().String()),
			slog.String(SpanIDKey, spanCtx.SpanID().String()),
		)
	}
	return h.inner.Handle(ctx, record)
}

func (h *traceHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &traceHandler{inner: h.inner.WithAttrs(attrs)}
}

func (h *traceHandler) WithGroup(name string) slog.Handler {
	return &traceHandler{inner: h.inner.WithGroup(name)}
}
