package logging

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"regexp"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/trace"
)

// timeAttr matches the one field two records written a moment apart differ
// in.
var timeAttr = regexp.MustCompile(`^time=\S+ `)

func newLogger(t *testing.T, buf *bytes.Buffer, level slog.Level) *slog.Logger {
	t.Helper()

	logger, err := New(buf, level)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return logger
}

func lines(buf *bytes.Buffer) []string {
	return strings.Split(strings.TrimSuffix(buf.String(), "\n"), "\n")
}

// Without either variable, a record is the line slog's text handler writes,
// with the trace IDs after the record's own attributes.
func TestNewWritesTextByDefault(t *testing.T) {
	t.Setenv(FormatEnv, "")
	t.Setenv(LevelEnv, "")

	var got, want bytes.Buffer
	spanCtx := spanContext(t)
	ctx := trace.ContextWithSpanContext(t.Context(), spanCtx)
	newLogger(t, &got, slog.LevelInfo).ErrorContext(ctx, "outbox event dead", "event_id", "e-1", "attempts", 10)
	slog.New(slog.NewTextHandler(&want, nil)).Error("outbox event dead",
		"event_id", "e-1", "attempts", 10,
		TraceIDKey, spanCtx.TraceID().String(), SpanIDKey, spanCtx.SpanID().String())

	if g, w := timeAttr.ReplaceAllString(got.String(), ""), timeAttr.ReplaceAllString(want.String(), ""); g != w {
		t.Errorf("record = %q, want %q", g, w)
	}
}

func TestNewWritesOneJSONObjectPerLine(t *testing.T) {
	t.Setenv(FormatEnv, "json")
	t.Setenv(LevelEnv, "")

	var buf bytes.Buffer
	logger := newLogger(t, &buf, slog.LevelInfo)
	spanCtx := spanContext(t)
	ctx := trace.ContextWithSpanContext(t.Context(), spanCtx)
	logger.ErrorContext(ctx, "outbox event dead", "event_id", "e-1", "attempts", 10)
	logger.Info("next revalidate is enabled")

	got := lines(&buf)
	if len(got) != 2 {
		t.Fatalf("wrote %d lines, want 2: %q", len(got), buf.String())
	}
	var record map[string]any
	if err := json.Unmarshal([]byte(got[0]), &record); err != nil {
		t.Fatalf("unmarshal %q: %v", got[0], err)
	}
	for key, want := range map[string]any{
		"level":    "ERROR",
		"msg":      "outbox event dead",
		"event_id": "e-1",
		"attempts": float64(10),
		TraceIDKey: spanCtx.TraceID().String(),
		SpanIDKey:  spanCtx.SpanID().String(),
	} {
		if record[key] != want {
			t.Errorf("%s = %v, want %v", key, record[key], want)
		}
	}
	if _, ok := record["time"]; !ok {
		t.Error("time is missing")
	}
}

func TestNewWritesNothingBelowTheLevelVariable(t *testing.T) {
	t.Setenv(FormatEnv, "")
	t.Setenv(LevelEnv, "warn")

	var buf bytes.Buffer
	logger := newLogger(t, &buf, slog.LevelInfo)
	logger.Info("readiness check passed")
	logger.Warn("readiness check slow")

	got := lines(&buf)
	if len(got) != 1 || !strings.Contains(got[0], `msg="readiness check slow"`) {
		t.Errorf("records = %q, want the WARN record alone", got)
	}
}

func TestNewWritesDebugWhenTheLevelVariableAsks(t *testing.T) {
	t.Setenv(FormatEnv, "")
	t.Setenv(LevelEnv, "DEBUG")

	var buf bytes.Buffer
	newLogger(t, &buf, slog.LevelWarn).Debug("claimed", "count", 3)

	if !strings.Contains(buf.String(), "level=DEBUG msg=claimed count=3") {
		t.Errorf("record = %q, want the DEBUG record", buf.String())
	}
}

// The variable quiets the log, and the audit record is not part of what it
// quiets.
func TestAuditWritesThroughTheLevelVariable(t *testing.T) {
	for _, format := range []string{"text", "json"} {
		t.Run(format, func(t *testing.T) {
			t.Setenv(FormatEnv, format)
			t.Setenv(LevelEnv, "error")

			var buf bytes.Buffer
			logger := newLogger(t, &buf, slog.LevelInfo).With("component", "adminapi")
			logger.Info("handled")
			Audit(logger).Info("audit", "action", "series.create")

			got := lines(&buf)
			if len(got) != 1 {
				t.Fatalf("records = %q, want the audit record alone", got)
			}
			for _, want := range []string{"INFO", "audit", "series.create", "adminapi"} {
				if !strings.Contains(got[0], want) {
					t.Errorf("record = %q, want it to contain %q", got[0], want)
				}
			}
		})
	}
}

// A command that passes a level above INFO, as publiractl setup does, keeps
// the audit record off its console whatever the variable says.
func TestAuditHoldsToTheCommandsOwnLevel(t *testing.T) {
	t.Setenv(FormatEnv, "")
	t.Setenv(LevelEnv, "debug")

	var buf bytes.Buffer
	logger := newLogger(t, &buf, slog.LevelWarn)
	Audit(logger).Info("audit", "action", "tenant.create")
	logger.Debug("prompting")

	got := lines(&buf)
	if len(got) != 1 || !strings.Contains(got[0], "msg=prompting") {
		t.Errorf("records = %q, want the DEBUG record alone", got)
	}
}

func TestAuditLeavesALoggerNewDidNotBuildAlone(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.DiscardHandler)
	if got := Audit(logger); got != logger {
		t.Errorf("Audit = %p, want the logger it was given, %p", got, logger)
	}
}

func TestNewRefusesAValueItDoesNotKnow(t *testing.T) {
	for _, tc := range []struct {
		name, format, level, variable string
	}{
		{name: "format", format: "logfmt", variable: FormatEnv},
		{name: "level", level: "verbose", variable: LevelEnv},
		{name: "numeric level", level: "4", variable: LevelEnv},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(FormatEnv, tc.format)
			t.Setenv(LevelEnv, tc.level)

			_, err := New(&bytes.Buffer{}, slog.LevelInfo)
			if err == nil || !strings.Contains(err.Error(), tc.variable) {
				t.Errorf("New = %v, want an error naming %s", err, tc.variable)
			}
		})
	}
}
