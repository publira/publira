// Package pinnedannouncements takes down the banners whose pinned window has
// passed.
//
// The read behind a banner already compares NOW() against the stored instant,
// so the API answers correctly the moment a window closes. What does not follow
// on its own is what a site cached — the band stays above every page until
// something drops the tag it is held under. Clearing the flag is what makes a
// boundary stop being due, so a run that was down over one still catches up on
// its next pass instead of leaving the banner there.
package pinnedannouncements

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/pinnedannouncements")

// Queries is the part of the generated querier this runner uses. The connection
// behind it must bypass RLS: the listing spans every tenant.
type Queries interface {
	ListPinnedAnnouncementsDue(ctx context.Context) ([]dbmodels.ListPinnedAnnouncementsDueRow, error)
	ClearAnnouncementPin(ctx context.Context, id uuid.UUID) error
}

// Revalidator records Next.js cache tags as owed. *revalidate.Requester
// satisfies it, and a nil requester of that type is a no-op, so a deployment
// with revalidation turned off still clears the flags instead of collecting
// them.
type Revalidator interface {
	RevalidateTags(ctx context.Context, tenantID uuid.UUID, tags []string) error
}

// Runner clears every pinned window that has closed.
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

// RevalidateTags names what a tenant's site caches its banner under. It is a
// tag of its own rather than the announcements list's, because a window that
// closes says nothing about the list and would otherwise rebuild every reader's
// inbox with it. The console drops the same tag when it pins or unpins one.
func RevalidateTags(tenantID uuid.UUID) []string {
	return []string{fmt.Sprintf("tenant:%s:announcements:pinned", tenantID.String())}
}

// RunOnce clears every window that has closed, one tenant at a time.
//
// The cycle runs under one span so the queries it issues hang off a single
// trace instead of arriving as one root span per statement.
func (r *Runner) RunOnce(ctx context.Context) {
	ctx, span := tracer.Start(ctx, "pinnedannouncements.RunOnce")
	defer span.End()

	rows, err := r.queries.ListPinnedAnnouncementsDue(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list pinned announcements due", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	span.SetAttributes(attribute.Int("publira.pinned_announcements.due", len(rows)))
	r.logger.InfoContext(ctx, "found pinned announcements to take down", "count", len(rows))

	byTenant := make(map[uuid.UUID][]dbmodels.ListPinnedAnnouncementsDueRow)
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

// applyTenant records one tenant's drop and then clears the flags that drop
// answers for. The order matters: a flag cleared before the drop is owed would
// never be retried, and the site would keep showing a banner whose window has
// closed.
func (r *Runner) applyTenant(ctx context.Context, tenantID uuid.UUID, rows []dbmodels.ListPinnedAnnouncementsDueRow) {
	if r.reval != nil {
		if err := r.reval.RevalidateTags(ctx, tenantID, RevalidateTags(tenantID)); err != nil {
			r.logger.WarnContext(ctx, "failed to record a revalidation after a pinned window closed",
				"tenant_id", tenantID.String(),
				"announcements", len(rows),
				"error", err,
			)
			return
		}
	}

	for _, row := range rows {
		if err := r.queries.ClearAnnouncementPin(ctx, row.ID); err != nil {
			r.logger.ErrorContext(ctx, "failed to clear an announcement pin",
				"tenant_id", tenantID.String(),
				"announcement_id", row.ID.String(),
				"error", err,
			)
			continue
		}
		r.logger.InfoContext(ctx, "took down a pinned announcement",
			"tenant_id", tenantID.String(),
			"announcement_id", row.ID.String(),
		)
	}
}
