// Package seriespublications applies the publication of scheduled series to
// what holds a copy of the catalog: the public site caches.
//
// A series saved with a publication instant in the future needs nothing in the
// database to change when that instant passes: the catalog reads compare it
// against NOW(), so the API lists the series from that moment. What does not
// change on its own is what was copied out of it — a series list, a creator's
// page, or the series' own page cached while the series was still hidden keeps
// leaving it out until something drops the tags they are cached under. Asking
// for that drop is this runner's whole job, and it is why each publication is
// recorded as applied: a run that was down over one still catches up on its
// next pass.
//
// The search index needs no such pass: a series' document carries its
// published_at, and the search filters on it at the moment it is asked.
package seriespublications

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/seriespublications")

// Queries is the part of the generated querier this runner uses. The
// connection behind it must bypass RLS: the listing spans every tenant.
type Queries interface {
	ListSeriesPublicationsDue(ctx context.Context) ([]dbmodels.ListSeriesPublicationsDueRow, error)
	MarkSeriesPublicationRevalidated(ctx context.Context, id uuid.UUID) error
}

// Revalidator records Next.js cache tags as owed. *revalidate.Requester
// satisfies it, and a nil requester of that type is a no-op, so a deployment
// with revalidation turned off still records the publications it passed
// instead of collecting them.
type Revalidator interface {
	RevalidateTags(ctx context.Context, tenantID uuid.UUID, tags []string) error
}

// Runner applies every series publication whose instant has passed.
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

// RevalidateTags names what a tenant's public site caches the answers a series
// publication changes under. Every cached series list — the top page's modules,
// the series list, a label's, a genre's and a tag's, the search, and the
// sitemap — carries the series list tag; every creator page carries the
// creators tag; and the series' own page, held while the series was not found,
// carries both the series detail tag and the series' own.
func RevalidateTags(tenantID uuid.UUID, seriesPublicIDs ...string) []string {
	tags := []string{
		fmt.Sprintf("tenant:%s:series:list", tenantID.String()),
		fmt.Sprintf("tenant:%s:series:detail", tenantID.String()),
		fmt.Sprintf("tenant:%s:creators", tenantID.String()),
	}
	for _, publicID := range seriesPublicIDs {
		tags = append(tags, fmt.Sprintf("tenant:%s:series:%s", tenantID.String(), publicID))
	}
	return tags
}

// RunOnce applies every publication that has passed, one tenant at a time.
//
// The cycle runs under one span so the queries it issues hang off a single
// trace instead of arriving as one root span per statement.
func (r *Runner) RunOnce(ctx context.Context) {
	ctx, span := tracer.Start(ctx, "seriespublications.RunOnce")
	defer span.End()

	rows, err := r.queries.ListSeriesPublicationsDue(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list due series publications", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	span.SetAttributes(attribute.Int("publira.series_publications.due", len(rows)))
	r.logger.InfoContext(ctx, "found series publications to apply", "count", len(rows))

	byTenant := make(map[uuid.UUID][]dbmodels.ListSeriesPublicationsDueRow)
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

// applyTenant records one tenant's drop and then marks the publications it
// answers for. The order matters: a publication marked before its drop is owed
// would never be retried, and the site would keep leaving the series out.
func (r *Runner) applyTenant(ctx context.Context, tenantID uuid.UUID, rows []dbmodels.ListSeriesPublicationsDueRow) {
	if r.reval != nil {
		publicIDs := make([]string, 0, len(rows))
		for _, row := range rows {
			publicIDs = append(publicIDs, row.PublicID)
		}
		if err := r.reval.RevalidateTags(ctx, tenantID, RevalidateTags(tenantID, publicIDs...)); err != nil {
			r.logger.WarnContext(ctx, "failed to record a revalidation after a series publication",
				"tenant_id", tenantID.String(),
				"series", len(rows),
				"error", err,
			)
			return
		}
	}

	for _, row := range rows {
		if err := r.queries.MarkSeriesPublicationRevalidated(ctx, row.ID); err != nil {
			r.logger.ErrorContext(ctx, "failed to mark series publication applied",
				"tenant_id", tenantID.String(),
				"series_id", row.PublicID,
				"error", err,
			)
			continue
		}
		r.logger.InfoContext(ctx, "applied series publication",
			"tenant_id", tenantID.String(),
			"series_id", row.PublicID,
			"series_title", row.Title,
		)
	}
}
