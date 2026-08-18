package logging

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/trace"
)

func spanContext(t *testing.T) trace.SpanContext {
	t.Helper()

	traceID, err := trace.TraceIDFromHex("4bf92f3577b34da6a3ce929d0e0e4736")
	if err != nil {
		t.Fatalf("TraceIDFromHex: %v", err)
	}
	spanID, err := trace.SpanIDFromHex("00f067aa0ba902b7")
	if err != nil {
		t.Fatalf("SpanIDFromHex: %v", err)
	}
	return trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: traceID,
		SpanID:  spanID,
	})
}

func decode(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()

	line := strings.TrimSpace(buf.String())
	if line == "" {
		t.Fatal("no record was written")
	}
	var record map[string]any
	if err := json.Unmarshal([]byte(line), &record); err != nil {
		t.Fatalf("unmarshal %q: %v", line, err)
	}
	return record
}

func TestHandleAddsTraceIDsFromContext(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(NewTraceHandler(slog.NewJSONHandler(&buf, nil)))
	spanCtx := spanContext(t)
	ctx := trace.ContextWithSpanContext(t.Context(), spanCtx)

	logger.ErrorContext(ctx, "failed to get tenant", "tenant_id", "t-1")

	record := decode(t, &buf)
	if got := record[TraceIDKey]; got != spanCtx.TraceID().String() {
		t.Errorf("%s = %v, want %s", TraceIDKey, got, spanCtx.TraceID())
	}
	if got := record[SpanIDKey]; got != spanCtx.SpanID().String() {
		t.Errorf("%s = %v, want %s", SpanIDKey, got, spanCtx.SpanID())
	}
	if got := record["tenant_id"]; got != "t-1" {
		t.Errorf("tenant_id = %v, want t-1", got)
	}
}

func TestHandleLeavesRecordsOutsideASpanAlone(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(NewTraceHandler(slog.NewJSONHandler(&buf, nil)))

	logger.Error("failed to load config", "error", "boom")

	record := decode(t, &buf)
	if _, ok := record[TraceIDKey]; ok {
		t.Errorf("%s must be absent without a span, got %v", TraceIDKey, record[TraceIDKey])
	}
	if _, ok := record[SpanIDKey]; ok {
		t.Errorf("%s must be absent without a span, got %v", SpanIDKey, record[SpanIDKey])
	}
}

// WithAttrs and WithGroup delegate to the wrapped handler, so an open
// group nests the trace IDs along with the rest of the record's
// attributes. No server package opens a group today; this pins the
// behaviour so a future one is not surprised by where the IDs land.
func TestWithAttrsAndWithGroupDelegateToInner(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	logger := slog.New(NewTraceHandler(slog.NewJSONHandler(&buf, nil))).
		With("component", "adminapi").
		WithGroup("request")
	spanCtx := spanContext(t)
	ctx := trace.ContextWithSpanContext(t.Context(), spanCtx)

	logger.InfoContext(ctx, "handled", "procedure", "ListSeries")

	record := decode(t, &buf)
	if got := record["component"]; got != "adminapi" {
		t.Errorf("component = %v, want adminapi", got)
	}
	group, ok := record["request"].(map[string]any)
	if !ok {
		t.Fatalf("request group = %v, want an object", record["request"])
	}
	if got := group["procedure"]; got != "ListSeries" {
		t.Errorf("request.procedure = %v, want ListSeries", got)
	}
	if got := group[TraceIDKey]; got != spanCtx.TraceID().String() {
		t.Errorf("request.%s = %v, want %s", TraceIDKey, got, spanCtx.TraceID())
	}
}

func TestEnabledDelegatesToInner(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	handler := NewTraceHandler(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn}))

	if handler.Enabled(t.Context(), slog.LevelInfo) {
		t.Error("Enabled(Info) = true, want false at level Warn")
	}
	if !handler.Enabled(t.Context(), slog.LevelError) {
		t.Error("Enabled(Error) = false, want true at level Warn")
	}
}
