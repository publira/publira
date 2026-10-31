package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
)

const (
	// FormatEnv names the format of every record: text, the default, writes
	// key=value pairs, and json one JSON object per line with the same keys.
	FormatEnv = "PUBLIRA_LOG_FORMAT"
	// LevelEnv names the lowest level written: debug, info, warn, or error.
	LevelEnv = "PUBLIRA_LOG_LEVEL"
)

// New returns the logger the server processes install as their own and as
// the slog default: records written to out in the format FormatEnv names,
// annotated with the trace and span IDs of the context each record is logged
// with. level is the lowest level written when LevelEnv is unset.
//
// An audit record, one logged through Audit, is held to level alone, never to
// LevelEnv: the variable quiets what an operator finds noisy, and the audit
// line is a record of who did what rather than noise. A command that passes a
// level above INFO is choosing not to mirror its audit entries at all.
//
// A value of either variable that is not one of its own is an error naming
// the variable, so a process refuses to start rather than log in a format or
// at a level nobody asked for.
func New(out io.Writer, level slog.Level) (*slog.Logger, error) {
	threshold := level
	if v := strings.TrimSpace(os.Getenv(LevelEnv)); v != "" {
		parsed, err := parseLevel(v)
		if err != nil {
			return nil, err
		}
		threshold = parsed
	}
	opts := &slog.HandlerOptions{Level: min(threshold, level)}

	var base slog.Handler
	switch v := strings.TrimSpace(os.Getenv(FormatEnv)); strings.ToLower(v) {
	case "", "text":
		base = slog.NewTextHandler(out, opts)
	case "json":
		base = slog.NewJSONHandler(out, opts)
	default:
		return nil, fmt.Errorf("%s must be text or json, not %q", FormatEnv, v)
	}
	return slog.New(&levelHandler{inner: NewTraceHandler(base), level: threshold, audit: level}), nil
}

func parseLevel(v string) (slog.Level, error) {
	switch strings.ToLower(v) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("%s must be debug, info, warn, or error, not %q", LevelEnv, v)
	}
}

// Audit returns the logger an audit record is written through: logger itself,
// with the level the command passed to New in place of LevelEnv's. A logger
// New did not build, such as a test's, is returned unchanged.
func Audit(logger *slog.Logger) *slog.Logger {
	h, ok := logger.Handler().(*levelHandler)
	if !ok {
		return logger
	}
	return slog.New(&levelHandler{inner: h.inner, level: h.audit, audit: h.audit})
}

// levelHandler writes the records at or above level. The handler it wraps
// was built to write anything at or above the lower of level and audit, so
// Audit can lower the bar without building a second handler on the same
// writer.
type levelHandler struct {
	inner slog.Handler
	level slog.Level
	audit slog.Level
}

func (h *levelHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= h.level && h.inner.Enabled(ctx, level)
}

func (h *levelHandler) Handle(ctx context.Context, record slog.Record) error {
	return h.inner.Handle(ctx, record)
}

func (h *levelHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &levelHandler{inner: h.inner.WithAttrs(attrs), level: h.level, audit: h.audit}
}

func (h *levelHandler) WithGroup(name string) slog.Handler {
	return &levelHandler{inner: h.inner.WithGroup(name), level: h.level, audit: h.audit}
}
