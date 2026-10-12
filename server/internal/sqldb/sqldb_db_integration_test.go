package sqldb

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"

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

	db, err := Open(env.PublicURL)
	if err != nil {
		t.Fatalf("sqldb.Open: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("db.Close: %v", err)
		}
	})

	ctx, parent := provider.Tracer("test").Start(t.Context(), "inbound request")

	// Shaped like a generated statement so the span carries the same
	// attributes a sqlc query would produce.
	const query = `-- name: GetTenantCount :one
SELECT count(*) FROM tenants
`
	var tenants int
	if err := db.QueryRowContext(ctx, query).Scan(&tenants); err != nil {
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
		if span.Name() != querySpanName {
			continue
		}
		queryChildren++
		assertQueryAttributes(t, span.Attributes())
	}
	if queryChildren == 0 {
		t.Fatalf("no %q span was recorded as a child of the request span; recorded %d spans",
			querySpanName, len(spans))
	}
}

// The bound is what a burst of requests runs into: past it a caller waits for
// a connection to be returned instead of opening one more against the
// database's max_connections.
func TestDBOpenBoundsThePool(t *testing.T) {
	env := testutil.StartPostgres(t)
	const bound = 3
	t.Setenv(maxOpenConnsEnv, "3")
	t.Setenv(maxIdleConnsEnv, "")
	t.Setenv(connMaxIdleTimeEnv, "")

	db, err := Open(env.PublicURL)
	if err != nil {
		t.Fatalf("sqldb.Open: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("db.Close: %v", err)
		}
	})

	if got := db.Stats().MaxOpenConnections; got != bound {
		t.Fatalf("MaxOpenConnections = %d, want %d", got, bound)
	}
	held := make([]*sql.Conn, 0, bound)
	t.Cleanup(func() {
		for _, conn := range held {
			_ = conn.Close()
		}
	})
	for range bound {
		conn, err := db.Conn(t.Context())
		if err != nil {
			t.Fatalf("db.Conn: %v", err)
		}
		held = append(held, conn)
	}

	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	extra, err := db.Conn(ctx)
	if err == nil {
		_ = extra.Close()
		t.Fatalf("a connection past the bound of %d was opened", bound)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("db.Conn past the bound: %v, want it to wait until the deadline", err)
	}
	if got := db.Stats().OpenConnections; got != bound {
		t.Fatalf("OpenConnections = %d, want %d", got, bound)
	}
}

// assertQueryAttributes pins what a statement span is allowed to say: the
// operation and the sqlc query name identify it at low cardinality, and the
// statement text is the generated SQL with placeholders, never argument
// values.
func assertQueryAttributes(t *testing.T, attributes []attribute.KeyValue) {
	t.Helper()

	values := map[attribute.Key]string{}
	for _, kv := range attributes {
		values[kv.Key] = kv.Value.AsString()
	}

	if got := values[semconv.DBOperationNameKey]; got != "SELECT" {
		t.Errorf("%s = %q, want SELECT", semconv.DBOperationNameKey, got)
	}
	if got := values[semconv.DBQuerySummaryKey]; got != "GetTenantCount" {
		t.Errorf("%s = %q, want GetTenantCount", semconv.DBQuerySummaryKey, got)
	}
	if got := values[semconv.DBSystemNameKey]; got != "postgresql" {
		t.Errorf("%s = %q, want postgresql", semconv.DBSystemNameKey, got)
	}
	if got := values[semconv.DBQueryTextKey]; !strings.Contains(got, "SELECT count(*) FROM tenants") {
		t.Errorf("%s = %q, want the generated statement", semconv.DBQueryTextKey, got)
	}
}
