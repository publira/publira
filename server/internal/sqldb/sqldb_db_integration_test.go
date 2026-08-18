package sqldb_test

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/testutil"
)

// A query issued inside a request must show up as a child of that
// request's span. Without it a trace says a handler took 400ms but not
// that the database did.
func TestDBQueriesBecomeChildSpans(t *testing.T) {
	env := testutil.StartPostgres(t)

	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))

	// The instrumented driver reads the global provider, the same way it
	// does in a server process where tracing.Setup installed it.
	previousProvider := otel.GetTracerProvider()
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		if err := provider.Shutdown(context.Background()); err != nil {
			t.Errorf("provider.Shutdown: %v", err)
		}
	})
	otel.SetTracerProvider(provider)

	db, err := sqldb.Open(env.PublicURL)
	if err != nil {
		t.Fatalf("sqldb.Open: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("db.Close: %v", err)
		}
	})

	ctx, parent := provider.Tracer("test").Start(t.Context(), "inbound request")

	var one int
	if err := db.QueryRowContext(ctx, "SELECT 1").Scan(&one); err != nil {
		t.Fatalf("QueryRowContext: %v", err)
	}
	parent.End()

	spans := recorder.Ended()
	var queryChildren int
	for _, span := range spans {
		if span.SpanContext().SpanID() == parent.SpanContext().SpanID() {
			continue
		}
		if span.Parent().SpanID() != parent.SpanContext().SpanID() {
			continue
		}
		if span.SpanContext().TraceID() != parent.SpanContext().TraceID() {
			t.Errorf("span %q trace = %s, want the parent's trace %s",
				span.Name(), span.SpanContext().TraceID(), parent.SpanContext().TraceID())
		}
		queryChildren++
	}
	if queryChildren == 0 {
		t.Fatalf("no DB span was recorded as a child of the request span; recorded %d spans", len(spans))
	}
}
