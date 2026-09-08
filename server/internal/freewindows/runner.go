// Package freewindows applies the boundaries of scheduled episode free windows
// to the public site caches.
//
// Nothing in the database has to change when a window opens or closes: the
// access predicates compare NOW() against the stored period, so the API answers
// correctly the moment a boundary passes. What does not change on its own is
// what the web apps already cached — an episode page held under a series tag
// keeps showing the price, or the free body, until something drops the tag.
// That is this runner's whole job, and it is why each boundary is recorded as
// applied: a run that was down over one still catches up on its next pass.
package freewindows

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/freewindows")

// Queries is the part of the generated querier this runner uses. The
// connection behind it must bypass RLS: the listing spans every tenant.
type Queries interface {
	ListEpisodeFreeWindowBoundariesDue(ctx context.Context) ([]dbmodels.ListEpisodeFreeWindowBoundariesDueRow, error)
	MarkEpisodeFreeWindowStartRevalidated(ctx context.Context, id uuid.UUID) error
	MarkEpisodeFreeWindowEndRevalidated(ctx context.Context, id uuid.UUID) error
}

// Revalidator drops Next.js cache tags. *revalidate.Client satisfies it, and a
// nil client of that type is a no-op, so a deployment with revalidation turned
// off still records the boundaries it passed instead of collecting them.
type Revalidator interface {
	RevalidateTags(ctx context.Context, tags []string) error
}

// Runner applies every free window boundary that has passed.
type Runner struct {
	queries Queries
	reval   Revalidator
	logger  *slog.Logger
}

// New constructs a runner over queries. reval may be nil.
func New(queries Queries, reval Revalidator, logger *slog.Logger) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	return &Runner{queries: queries, reval: reval, logger: logger}
}

// RevalidateTags names what a tenant's public site caches an episode's price
// under. Every cached read of an episode or of the series it belongs to carries
// this tag, so one tag per tenant answers for every window that tenant crossed.
func RevalidateTags(tenantID uuid.UUID) []string {
	return []string{fmt.Sprintf("tenant:%s:series:detail", tenantID.String())}
}

// RunOnce applies every boundary that has passed, one tenant at a time.
//
// The cycle runs under one span so the queries it issues hang off a single
// trace instead of arriving as one root span per statement.
func (r *Runner) RunOnce(ctx context.Context) {
	ctx, span := tracer.Start(ctx, "freewindows.RunOnce")
	defer span.End()

	rows, err := r.queries.ListEpisodeFreeWindowBoundariesDue(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list due free window boundaries", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	span.SetAttributes(attribute.Int("publira.free_windows.due", len(rows)))
	r.logger.InfoContext(ctx, "found free window boundaries to apply", "count", len(rows))

	byTenant := make(map[uuid.UUID][]dbmodels.ListEpisodeFreeWindowBoundariesDueRow)
	tenants := make([]uuid.UUID, 0)
	for _, row := range rows {
		if _, seen := byTenant[row.TenantID]; !seen {
			tenants = append(tenants, row.TenantID)
		}
		byTenant[row.TenantID] = append(byTenant[row.TenantID], row)
	}

	for _, tenantID := range tenants {
		if ctx.Err() != nil {
			return
		}
		r.applyTenant(ctx, tenantID, byTenant[tenantID])
	}
}

// applyTenant drops one tenant's caches and then records the boundaries that
// drop answered for. The order matters: a boundary marked before the caches are
// dropped would never be retried, and the site would keep serving the side of
// the window it has already left.
func (r *Runner) applyTenant(ctx context.Context, tenantID uuid.UUID, rows []dbmodels.ListEpisodeFreeWindowBoundariesDueRow) {
	if r.reval != nil {
		if err := r.reval.RevalidateTags(ctx, RevalidateTags(tenantID)); err != nil {
			r.logger.WarnContext(ctx, "failed to revalidate after free window boundary",
				"tenant_id", tenantID.String(),
				"boundaries", len(rows),
				"error", err,
			)
			return
		}
	}

	for _, row := range rows {
		if row.StartDue.Valid && row.StartDue.Bool {
			if err := r.queries.MarkEpisodeFreeWindowStartRevalidated(ctx, row.ID); err != nil {
				r.logger.ErrorContext(ctx, "failed to mark free window start applied",
					"tenant_id", tenantID.String(),
					"free_window_id", row.ID.String(),
					"error", err,
				)
				continue
			}
		}
		if row.EndDue.Valid && row.EndDue.Bool {
			if err := r.queries.MarkEpisodeFreeWindowEndRevalidated(ctx, row.ID); err != nil {
				r.logger.ErrorContext(ctx, "failed to mark free window end applied",
					"tenant_id", tenantID.String(),
					"free_window_id", row.ID.String(),
					"error", err,
				)
				continue
			}
		}
		r.logger.InfoContext(ctx, "applied free window boundary",
			"tenant_id", tenantID.String(),
			"episode_id", row.EpisodePublicID,
			"episode_title", row.EpisodeTitle,
			"series_id", row.SeriesPublicID,
			"start_applied", row.StartDue.Bool,
			"end_applied", row.EndDue.Bool,
		)
	}
}
