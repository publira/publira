// Package freeafter applies each series' free-after-publication rule: every
// published, priced episode of the series becomes free to everyone a set
// number of days after it was published, except the newest ones the rule keeps
// for buyers.
//
// The rule is applied by writing ordinary free windows, each one marked with
// the series whose rule wrote it and running to the far end, so every read
// that decides access, every cache, and the search index treat it as the
// windows an editor schedules. A pass writes the window an episode is due and
// does not have yet; it never removes one. Saving the rule removes the windows
// it no longer covers, which is the one change that takes an episode back out
// of it.
package freeafter

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/publira/publira/server/internal/catalogindex"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/freewindows"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/revalidate"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/freeafter")

// Runner writes the windows every enabled rule is due.
type Runner struct {
	db      *sql.DB
	queries *dbmodels.Queries
	reval   *revalidate.Requester
	logger  *slog.Logger
}

// New constructs a runner over db, whose connection must bypass RLS: the
// listing of the rules spans every tenant. reval may be nil.
func New(db *sql.DB, queries *dbmodels.Queries, reval *revalidate.Requester, logger *slog.Logger) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	if queries == nil {
		queries = dbmodels.New(db)
	}
	return &Runner{db: db, queries: queries, reval: reval, logger: logger}
}

// KeptEpisodeIDs is the episodes of covered that already carry the rule's
// window, which is what saving the rule leaves in place.
func KeptEpisodeIDs(covered []dbmodels.ListSeriesFreeAfterEpisodesRow) []uuid.UUID {
	kept := make([]uuid.UUID, 0, len(covered))
	for _, row := range covered {
		if row.RuleWindowID.Valid {
			kept = append(kept, row.EpisodeID)
		}
	}
	return kept
}

// RunOnce writes, for every rule that is on, the windows its series' episodes
// are due, one series at a time.
//
// The cycle runs under one span so the queries it issues hang off a single
// trace instead of arriving as one root span per statement.
func (r *Runner) RunOnce(ctx context.Context) {
	ctx, span := tracer.Start(ctx, "freeafter.RunOnce")
	defer span.End()

	rules, err := r.queries.ListEnabledSeriesFreeAfterSettings(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list free-after-publication rules", "error", err)
		return
	}
	span.SetAttributes(attribute.Int("publira.free_after.rules", len(rules)))

	for _, rule := range rules {
		if ctx.Err() != nil {
			return
		}
		opened, err := r.applySeries(ctx, rule.TenantID, rule.SeriesID)
		if err != nil {
			// A window scheduled by hand on one of the episodes since the
			// listing is the one conflict expected here; the next pass reads
			// it and starts the rule's window where it ends.
			r.logger.WarnContext(ctx, "failed to apply a free-after-publication rule",
				"tenant_id", rule.TenantID.String(),
				"series_id", rule.SeriesID.String(),
				"overlap", dberr.IsExclusionViolation(err),
				"error", err,
			)
			continue
		}
		if opened > 0 {
			r.logger.InfoContext(ctx, "applied free-after-publication rule",
				"tenant_id", rule.TenantID.String(),
				"series_id", rule.SeriesID.String(),
				"windows", opened,
			)
		}
	}
}

// applySeries writes the windows one series' rule is due, under the series
// lock, and reports how many it wrote.
//
// A window that is open the moment it is written records the drop of the
// public caches and the sync of the series' search document on the same
// transaction, and writes off its start, as an editor's open window does; one
// whose start is still ahead is left to apply-free-windows, which asks for
// both when it opens.
func (r *Runner) applySeries(ctx context.Context, tenantID, seriesID uuid.UUID) (int, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	q := r.queries.WithTx(tx)
	if _, err := q.LockSeriesForFreeAfterRule(ctx, dbmodels.LockSeriesForFreeAfterRuleParams{TenantID: tenantID, ID: seriesID}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, fmt.Errorf("lock series: %w", err)
	}
	rule, err := q.GetSeriesFreeAfterSettings(ctx, dbmodels.GetSeriesFreeAfterSettingsParams{TenantID: tenantID, SeriesID: seriesID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, fmt.Errorf("read rule: %w", err)
	}
	if !rule.Enabled {
		return 0, nil
	}

	covered, err := q.ListSeriesFreeAfterEpisodes(ctx, dbmodels.ListSeriesFreeAfterEpisodesParams{
		TenantID:             tenantID,
		SeriesID:             seriesID,
		DaysAfterPublication: rule.DaysAfterPublication,
		ExcludedLatestCount:  rule.ExcludedLatestCount,
	})
	if err != nil {
		return 0, fmt.Errorf("list covered episodes: %w", err)
	}

	now := time.Now()
	opened := 0
	var open []uuid.UUID
	for _, episode := range covered {
		if episode.RuleWindowID.Valid {
			continue
		}
		windowID, err := uuid.NewV7()
		if err != nil {
			return 0, fmt.Errorf("new window id: %w", err)
		}
		created, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.CreateSeriesFreeAfterWindowRow, error) {
			return q.CreateSeriesFreeAfterWindow(ctx, dbmodels.CreateSeriesFreeAfterWindowParams{
				ID:        windowID,
				TenantID:  tenantID,
				PublicID:  publicID,
				EpisodeID: episode.EpisodeID,
				StartsAt:  episode.StartsAt,
				SeriesID:  seriesID,
			})
		})
		if err != nil {
			return 0, fmt.Errorf("create window on episode %s: %w", episode.EpisodeID, err)
		}
		opened++
		if !created.StartsAt.After(now) {
			open = append(open, created.ID)
		}
	}

	if len(open) > 0 {
		if _, err := r.reval.Record(ctx, q, tenantID, freewindows.RevalidateTags(tenantID)); err != nil {
			return 0, fmt.Errorf("record cache invalidation: %w", err)
		}
		if err := catalogindex.Queue(ctx, q, tenantID, catalogindex.SeriesRef(seriesID)); err != nil {
			return 0, fmt.Errorf("queue catalog index sync: %w", err)
		}
		for _, windowID := range open {
			if err := q.MarkEpisodeFreeWindowStartRevalidated(ctx, windowID); err != nil {
				return 0, fmt.Errorf("mark window %s start revalidated: %w", windowID, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit transaction: %w", err)
	}
	return opened, nil
}
