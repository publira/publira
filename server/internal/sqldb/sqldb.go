// Package sqldb opens the PostgreSQL pool the server processes share.
//
// Every entrypoint goes through Open so the pgx driver is wrapped once,
// in one place: that is what turns each sqlc-generated query into a child
// span of whatever request or batch cycle issued it. Connections borrowed
// per tenant (internal/tenantconn) come from the same pool and are
// instrumented along with it.
//
// Span names and attributes follow the observability specification agreed
// in https://github.com/publira/publira/issues/502.
package sqldb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/XSAM/otelsql"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"

	// Registers the "pgx" database/sql driver that otelsql wraps below.
	_ "github.com/jackc/pgx/v5/stdlib"
)

// driverName is the database/sql driver registered by pgx/v5/stdlib.
const driverName = "pgx"

// querySpanName is the span name every statement shares. What each one
// actually ran is carried by db.operation.name and db.query.summary,
// which stay low cardinality; the statement text never reaches the name.
const querySpanName = "db.query"

// PingTimeout bounds the startup connectivity check. Neither the default
// DSNs nor database/sql set a connect timeout, so an unreachable host
// would otherwise hold the process in Open until the kernel gives up on
// the TCP handshake — minutes on some networks, during which the
// orchestrator sees a container that never becomes ready and never says
// why. Failing in 10s turns that into a startup error with a log line.
const PingTimeout = 10 * time.Second

// The variables that bound every pool Open creates. One value applies to
// each pool in the process rather than to the process as a whole, so what an
// install needs from the database is the number of pools times the bound:
// `publira server` and `publira worker` hold three pools each, or fewer when
// `--role` or `--queue` narrows what they host.
const (
	maxOpenConnsEnv    = "PUBLIRA_DB_MAX_OPEN_CONNS"
	maxIdleConnsEnv    = "PUBLIRA_DB_MAX_IDLE_CONNS"
	connMaxIdleTimeEnv = "PUBLIRA_DB_CONN_MAX_IDLE_TIME"
)

// defaultMaxOpenConns keeps the six pools of a server and a worker at 60
// connections together, inside the 100 PostgreSQL allows by default with
// room left for publiractl and the superuser's reserved slots.
const defaultMaxOpenConns = 10

// MinMaxOpenConns is the smallest bound a pool works at. A holder of one
// connection may wait for a second — tenantconn pins one per request and
// leaves at least one free for the rest, and the worker's migration lock is
// held while River migrates on the same pool — so a pool of one would wait on
// itself. The worker's maintenance pool has two such holders at once: a
// maintenance pass holds its turn on one connection and the search index build
// its lock on another, and each then works on a third, which a pool of two
// would leave to neither of them.
const MinMaxOpenConns = 3

// defaultConnMaxIdleTime closes a connection nobody has used for a while,
// so a pool that grew for a burst gives the database its slots back.
const defaultConnMaxIdleTime = 5 * time.Minute

// poolLimits bounds one pool.
type poolLimits struct {
	// MaxOpenConns is the most connections the pool holds at once,
	// in use and idle together. A caller over it waits for one to be
	// returned.
	MaxOpenConns int
	// MaxIdleConns is how many returned connections the pool keeps open.
	MaxIdleConns int
	// ConnMaxIdleTime closes a connection idle for longer; zero keeps it.
	ConnMaxIdleTime time.Duration
}

// limitsFromEnv reads the bound from the environment, filling in the default
// for every variable that is unset and failing on one that is set and invalid.
func limitsFromEnv() (poolLimits, error) {
	limits := poolLimits{
		MaxOpenConns:    defaultMaxOpenConns,
		ConnMaxIdleTime: defaultConnMaxIdleTime,
	}
	if raw := strings.TrimSpace(os.Getenv(maxOpenConnsEnv)); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < MinMaxOpenConns {
			return poolLimits{}, fmt.Errorf("%s must be a whole number of at least %d, got %q", maxOpenConnsEnv, MinMaxOpenConns, raw)
		}
		limits.MaxOpenConns = n
	}
	// Every connection the pool may open is kept once returned, so a pool
	// that has grown for a burst serves the next one without reconnecting.
	limits.MaxIdleConns = limits.MaxOpenConns
	if raw := strings.TrimSpace(os.Getenv(maxIdleConnsEnv)); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 || n > limits.MaxOpenConns {
			return poolLimits{}, fmt.Errorf("%s must be a whole number from 0 to %s (%d), got %q", maxIdleConnsEnv, maxOpenConnsEnv, limits.MaxOpenConns, raw)
		}
		limits.MaxIdleConns = n
	}
	if raw := strings.TrimSpace(os.Getenv(connMaxIdleTimeEnv)); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d < 0 {
			return poolLimits{}, fmt.Errorf("%s must be a Go duration of zero or more, got %q", connMaxIdleTimeEnv, raw)
		}
		limits.ConnMaxIdleTime = d
	}
	return limits, nil
}

// Open opens an instrumented pool for url, bounded by [limitsFromEnv], and
// verifies it with a ping, so an unreachable database fails at startup
// instead of on the first query.
func Open(url string) (*sql.DB, error) {
	limits, err := limitsFromEnv()
	if err != nil {
		return nil, err
	}
	db, err := otelsql.Open(driverName, url,
		otelsql.WithAttributes(semconv.DBSystemNamePostgreSQL),
		otelsql.WithSpanNameFormatter(spanName),
		otelsql.WithAttributesGetter(queryAttributes),
		otelsql.WithSpanOptions(otelsql.SpanOptions{
			// driver.ErrSkip is how a driver declines an optional
			// fast path; recording it marks healthy spans as errors.
			DisableErrSkip: true,
			// Emitted on every pool checkout and never explains
			// anything about the query that follows.
			OmitConnResetSession: true,
		}),
	)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(limits.MaxOpenConns)
	db.SetMaxIdleConns(limits.MaxIdleConns)
	db.SetConnMaxIdleTime(limits.ConnMaxIdleTime)
	ctx, cancel := context.WithTimeout(context.Background(), PingTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

// spanName names statement spans after the operation rather than the
// method otelsql used to run it, and leaves the connection- and
// transaction-level spans under their own names.
func spanName(_ context.Context, method otelsql.Method, _ string) string {
	switch method {
	case otelsql.MethodConnQuery, otelsql.MethodConnExec,
		otelsql.MethodStmtQuery, otelsql.MethodStmtExec:
		return querySpanName
	default:
		return string(method)
	}
}

// queryAttributes describes a statement without quoting it in full.
//
// db.operation.name is the SQL keyword, and db.query.summary is the sqlc
// query name from the generated `-- name: GetTenantByID :one` header,
// which identifies the statement far better than "SELECT" does while
// staying one of a fixed set of values.
func queryAttributes(_ context.Context, _ otelsql.Method, query string, _ []driver.NamedValue) []attribute.KeyValue {
	attributes := make([]attribute.KeyValue, 0, 2)
	if operation := sqlOperation(query); operation != "" {
		attributes = append(attributes, semconv.DBOperationName(operation))
	}
	if name := sqlcQueryName(query); name != "" {
		attributes = append(attributes, semconv.DBQuerySummary(name))
	}
	return attributes
}

// sqlOperation returns the leading SQL keyword in upper case, skipping the
// comment lines sqlc puts above the statement.
func sqlOperation(query string) string {
	for line := range strings.Lines(query) {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		keyword, _, _ := strings.Cut(line, " ")
		return strings.ToUpper(strings.TrimSpace(keyword))
	}
	return ""
}

// sqlcQueryName reads the query name out of the header sqlc emits:
//
//	-- name: GetTenantByID :one
func sqlcQueryName(query string) string {
	for line := range strings.Lines(query) {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		rest, ok := strings.CutPrefix(line, "-- name:")
		if !ok {
			// The header is the first thing in a generated
			// statement; anything else means there is none.
			return ""
		}
		name, _, _ := strings.Cut(strings.TrimSpace(rest), " ")
		return name
	}
	return ""
}
