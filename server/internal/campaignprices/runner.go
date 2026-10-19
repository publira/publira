// Package campaignprices applies the boundaries of scheduled episode campaign
// prices to what a tenant's site cached of them.
//
// Nothing in the database has to change when a campaign starts or ends: the
// checkout and the public reads compare NOW() against the stored period, so
// the price charged is right the moment a boundary passes. What does not
// follow on its own is the price a site cached — an episode page or a series'
// episode list held under the series detail tag keeps quoting the price of the
// side of the boundary it was read on until something drops that tag. Each
// boundary is recorded as applied once that drop is owed, so a run that was
// down over one still catches up on its next pass.
package campaignprices

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/campaignprices")

// Queries is the part of the generated querier this runner uses. The
// connection behind it must bypass RLS: the listing spans every tenant.
type Queries interface {
	ListEpisodeCampaignPriceBoundariesDue(ctx context.Context) ([]dbmodels.ListEpisodeCampaignPriceBoundariesDueRow, error)
	MarkEpisodeCampaignPriceStartRevalidated(ctx context.Context, id uuid.UUID) error
	MarkEpisodeCampaignPriceEndRevalidated(ctx context.Context, id uuid.UUID) error
}

// Revalidator records Next.js cache tags as owed. *revalidate.Requester
// satisfies it, and a nil requester of that type is a no-op, so a deployment
// with revalidation turned off still records the boundaries it passed instead
// of collecting them.
type Revalidator interface {
	RevalidateTags(ctx context.Context, tenantID uuid.UUID, tags []string) error
}

// Runner applies every campaign price boundary that has passed.
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
// under. Every cached read of an episode or of the series it belongs to
// carries the series detail tag, which names no series, so one tag per tenant
// answers for every campaign that tenant crossed. A series list quotes no
// episode's price, so its tag is left alone.
func RevalidateTags(tenantID uuid.UUID) []string {
	return []string{fmt.Sprintf("tenant:%s:series:detail", tenantID.String())}
}

// RunOnce applies every boundary that has passed, one tenant at a time.
//
// The cycle runs under one span so the queries it issues hang off a single
// trace instead of arriving as one root span per statement.
func (r *Runner) RunOnce(ctx context.Context) {
	ctx, span := tracer.Start(ctx, "campaignprices.RunOnce")
	defer span.End()

	rows, err := r.queries.ListEpisodeCampaignPriceBoundariesDue(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list due campaign price boundaries", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	span.SetAttributes(attribute.Int("publira.campaign_prices.due", len(rows)))
	r.logger.InfoContext(ctx, "found campaign price boundaries to apply", "count", len(rows))

	byTenant := make(map[uuid.UUID][]dbmodels.ListEpisodeCampaignPriceBoundariesDueRow)
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

// applyTenant records one tenant's drop and then marks the boundaries it
// answers for. The order matters: a boundary marked before the drop is owed
// would never be retried, and the site would keep quoting the price of the
// side of the boundary it has already left.
func (r *Runner) applyTenant(ctx context.Context, tenantID uuid.UUID, rows []dbmodels.ListEpisodeCampaignPriceBoundariesDueRow) {
	if r.reval != nil {
		if err := r.reval.RevalidateTags(ctx, tenantID, RevalidateTags(tenantID)); err != nil {
			r.logger.WarnContext(ctx, "failed to record a revalidation after a campaign price boundary",
				"tenant_id", tenantID.String(),
				"boundaries", len(rows),
				"error", err,
			)
			return
		}
	}

	for _, row := range rows {
		if row.StartDue.Valid && row.StartDue.Bool {
			if err := r.queries.MarkEpisodeCampaignPriceStartRevalidated(ctx, row.ID); err != nil {
				r.logger.ErrorContext(ctx, "failed to mark campaign price start applied",
					"tenant_id", tenantID.String(),
					"campaign_price_id", row.ID.String(),
					"error", err,
				)
				continue
			}
		}
		if row.EndDue.Valid && row.EndDue.Bool {
			if err := r.queries.MarkEpisodeCampaignPriceEndRevalidated(ctx, row.ID); err != nil {
				r.logger.ErrorContext(ctx, "failed to mark campaign price end applied",
					"tenant_id", tenantID.String(),
					"campaign_price_id", row.ID.String(),
					"error", err,
				)
				continue
			}
		}
		r.logger.InfoContext(ctx, "applied campaign price boundary",
			"tenant_id", tenantID.String(),
			"campaign_price_id", row.ID.String(),
			"episode_id", row.EpisodePublicID,
			"start_applied", row.StartDue.Bool,
			"end_applied", row.EndDue.Bool,
		)
	}
}
