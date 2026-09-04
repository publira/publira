package contentevents

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// DefaultProjectionBatchSize bounds one projection statement, the same trade
// the purge chunk makes: how long a statement holds locks and how much WAL it
// writes, against how many round trips a full reconciliation costs.
const DefaultProjectionBatchSize = 1000

// projectionQuerier is the one generated query a reconciliation run needs.
type projectionQuerier interface {
	ProjectPendingEpisodeCompleteEvents(ctx context.Context, limit int32) (dbmodels.ProjectPendingEpisodeCompleteEventsRow, error)
}

// Projector files the analytics event for every episode_reads row that has
// none. The request path writes that event beside the read it came from and
// swallows its failure, so this is what closes the gap a lost write leaves.
//
// Its database connection must use a role with BYPASSRLS (or be a superuser),
// because one run spans every tenant.
type Projector struct {
	db      *sql.DB
	queries projectionQuerier
}

// ProjectionOptions describes one reconciliation run.
type ProjectionOptions struct {
	// BatchSize is the row limit of a single statement. Zero means
	// DefaultProjectionBatchSize. It is int32 because it becomes a PostgreSQL
	// LIMIT: a wider type would let a caller wrap into a negative limit that
	// the database rejects.
	BatchSize int32
}

// ProjectionResult describes what one reconciliation run did.
type ProjectionResult struct {
	// RowCount is the number of events written. It is smaller than the reads
	// claimed when the request path wrote one of them first.
	RowCount int64
	// BatchCount is how many statements ran. It is at least one, because a run
	// always probes for unprojected reads.
	BatchCount int
}

// NewProjector constructs a Projector backed by db.
func NewProjector(db *sql.DB) *Projector {
	if db == nil {
		return &Projector{}
	}
	return &Projector{db: db, queries: dbmodels.New(db)}
}

// Run projects every unprojected read, in batches of opts.BatchSize. Each batch
// commits on its own, and each one takes the oldest reads still missing an
// event, so a cancelled run keeps what it finished and the next run resumes
// from there.
//
// Running it again after it has caught up writes nothing: a read that already
// has its event is neither selected by the anti-join nor accepted by the
// source unique index.
func (p *Projector) Run(ctx context.Context, opts ProjectionOptions) (ProjectionResult, error) {
	if p == nil || p.db == nil {
		return ProjectionResult{}, errors.New("episode read projection requires a database")
	}
	batchSize := opts.BatchSize
	if batchSize <= 0 {
		batchSize = DefaultProjectionBatchSize
	}
	if err := p.requireBypassRLS(ctx); err != nil {
		return ProjectionResult{}, err
	}

	var result ProjectionResult
	for {
		batch, err := p.queries.ProjectPendingEpisodeCompleteEvents(ctx, batchSize)
		if err != nil {
			return result, fmt.Errorf("project pending episode reads: %w", err)
		}
		result.RowCount += batch.InsertedCount
		result.BatchCount++
		// Continuation follows the reads this batch claimed, not the events it
		// wrote. A request-path write that lands mid-statement makes the second
		// smaller than the first, and looping on it would end the run with
		// reads still unprojected.
		if batch.CandidateCount < int64(batchSize) {
			return result, nil
		}
		if err := ctx.Err(); err != nil {
			return result, err
		}
	}
}

func (p *Projector) requireBypassRLS(ctx context.Context) error {
	var bypasses bool
	err := p.db.QueryRowContext(ctx, `
		SELECT rolsuper OR rolbypassrls
		FROM pg_roles
		WHERE rolname = current_user
	`).Scan(&bypasses)
	if err != nil {
		return fmt.Errorf("check database role: %w", err)
	}
	if !bypasses {
		return errors.New("episode read projection requires a database role with BYPASSRLS")
	}
	return nil
}
