package logging

import (
	"io"
	"log/slog"
)

// New returns the logger the server processes install as their own and as
// the slog default: text records written to out, annotated with the trace
// and span IDs of the context each record is logged with.
func New(out io.Writer, opts *slog.HandlerOptions) *slog.Logger {
	return slog.New(NewTraceHandler(slog.NewTextHandler(out, opts)))
}
