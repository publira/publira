// Package coinexpiry records the coins that lapsed unspent once the grant
// they came from expired.
//
// Nothing about a balance waits on it: every read and every spend counts only
// the grants that have not expired, so a reader stops holding their coins the
// moment the grant expires. What does not follow on its own is the reader's
// history, which has to say where the coins went. Each pass writes an expiry
// for every grant that lapsed with coins remaining and zeroes what the grant
// has left, which is what stops it being due, so a run that was down over an
// expiry still records it on its next pass. Expired coins are never restored.
package coinexpiry

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/coinexpiry")

// batchSize bounds the grants one statement expires, so a backlog after an
// outage is worked through in transactions that each hold few row locks.
const batchSize = 500

// Queries is the part of the generated querier this runner uses. The
// connection behind it must bypass RLS: the grants due span every tenant.
type Queries interface {
	ExpireLapsedCoinGrants(ctx context.Context, batch int32) ([]dbmodels.ExpireLapsedCoinGrantsRow, error)
}

// Runner records every lapsed grant's expiry.
type Runner struct {
	queries Queries
	logger  *slog.Logger
}

// New constructs a runner over queries.
func New(queries Queries, logger *slog.Logger) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	return &Runner{queries: queries, logger: logger}
}

// RunOnce expires every grant due, a batch at a time, until a batch comes
// back short. A grant a spend holds locked is passed over and expired by the
// next pass.
//
// The cycle runs under one span so the queries it issues hang off a single
// trace instead of arriving as one root span per statement.
func (r *Runner) RunOnce(ctx context.Context) {
	ctx, span := tracer.Start(ctx, "coinexpiry.RunOnce")
	defer span.End()

	expired := 0
	for {
		rows, err := r.queries.ExpireLapsedCoinGrants(ctx, batchSize)
		if err != nil {
			r.logger.ErrorContext(ctx, "failed to expire lapsed coin grants", "error", err, "expired", expired)
			break
		}
		expired += len(rows)
		if len(rows) < batchSize {
			break
		}
	}
	span.SetAttributes(attribute.Int("publira.coin_expiry.expired", expired))
	if expired > 0 {
		r.logger.InfoContext(ctx, "expired lapsed coin grants", "count", expired)
	}
}
