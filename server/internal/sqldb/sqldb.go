// Package sqldb opens the PostgreSQL pool the server processes share.
//
// Every entrypoint goes through Open so the pgx driver is wrapped once,
// in one place: that is what turns each sqlc-generated query into a child
// span of whatever request or batch cycle issued it. Connections borrowed
// per tenant (internal/tenantconn) come from the same pool and are
// instrumented along with it.
package sqldb

import (
	"database/sql"

	"github.com/XSAM/otelsql"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"

	// Registers the "pgx" database/sql driver that otelsql wraps below.
	_ "github.com/jackc/pgx/v5/stdlib"
)

// driverName is the database/sql driver registered by pgx/v5/stdlib.
const driverName = "pgx"

// Open opens an instrumented pool for url and verifies it with a ping, so
// an unreachable database fails at startup instead of on the first query.
//
// The spans carry the SQL text of each query. sqlc emits static
// statements with placeholders, so the text holds no argument values.
func Open(url string) (*sql.DB, error) {
	db, err := otelsql.Open(driverName, url,
		otelsql.WithAttributes(semconv.DBSystemNamePostgreSQL),
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
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}
