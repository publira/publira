// Package campaignbanners applies the boundaries of scheduled campaign banners
// to what a tenant's site cached of them.
//
// Nothing in the database has to change when a banner's window opens or
// closes: the public read compares NOW() against the stored instants, so the
// API answers correctly the moment a boundary passes. What does not follow on
// its own is the band a site cached — it keeps showing the banners of the
// window it was read in until something drops the tag it is held under. Each
// boundary is recorded as applied once that drop is owed, so a run that was
// down over one still catches up on its next pass.
package campaignbanners

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/campaignbanners")

// Queries is the part of the generated querier this runner uses. The
// connection behind it must bypass RLS: the listing spans every tenant.
type Queries interface {
	ListCampaignBannerBoundariesDue(ctx context.Context) ([]dbmodels.ListCampaignBannerBoundariesDueRow, error)
	MarkCampaignBannerStartRevalidated(ctx context.Context, id uuid.UUID) error
	MarkCampaignBannerEndRevalidated(ctx context.Context, id uuid.UUID) error
}

// Revalidator records Next.js cache tags as owed. *revalidate.Requester
// satisfies it, and a nil requester of that type is a no-op, so a deployment
// with revalidation turned off still records the boundaries it passed instead
// of collecting them.
type Revalidator interface {
	RevalidateTags(ctx context.Context, tenantID uuid.UUID, tags []string) error
}

// Runner applies every campaign banner boundary that has passed.
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

// RevalidateTags names what a tenant's site caches its campaign banners under.
// It is a tag of its own because the band goes stale on its own schedule, and
// a boundary passing says nothing about the catalog sections around it. The
// console drops the same tag whenever it changes a banner a reader may see.
func RevalidateTags(tenantID uuid.UUID) []string {
	return []string{fmt.Sprintf("tenant:%s:campaign-banners", tenantID.String())}
}

// RunOnce applies every boundary that has passed, one tenant at a time.
//
// The cycle runs under one span so the queries it issues hang off a single
// trace instead of arriving as one root span per statement.
func (r *Runner) RunOnce(ctx context.Context) {
	ctx, span := tracer.Start(ctx, "campaignbanners.RunOnce")
	defer span.End()

	rows, err := r.queries.ListCampaignBannerBoundariesDue(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list due campaign banner boundaries", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	span.SetAttributes(attribute.Int("publira.campaign_banners.due", len(rows)))
	r.logger.InfoContext(ctx, "found campaign banner boundaries to apply", "count", len(rows))

	byTenant := make(map[uuid.UUID][]dbmodels.ListCampaignBannerBoundariesDueRow)
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
// would never be retried, and the site would keep showing the side of the
// window it has already left.
func (r *Runner) applyTenant(ctx context.Context, tenantID uuid.UUID, rows []dbmodels.ListCampaignBannerBoundariesDueRow) {
	if r.reval != nil {
		if err := r.reval.RevalidateTags(ctx, tenantID, RevalidateTags(tenantID)); err != nil {
			r.logger.WarnContext(ctx, "failed to record a revalidation after a campaign banner boundary",
				"tenant_id", tenantID.String(),
				"boundaries", len(rows),
				"error", err,
			)
			return
		}
	}

	for _, row := range rows {
		if row.StartDue.Valid && row.StartDue.Bool {
			if err := r.queries.MarkCampaignBannerStartRevalidated(ctx, row.ID); err != nil {
				r.logger.ErrorContext(ctx, "failed to mark campaign banner start applied",
					"tenant_id", tenantID.String(),
					"campaign_banner_id", row.PublicID,
					"error", err,
				)
				continue
			}
		}
		if row.EndDue.Valid && row.EndDue.Bool {
			if err := r.queries.MarkCampaignBannerEndRevalidated(ctx, row.ID); err != nil {
				r.logger.ErrorContext(ctx, "failed to mark campaign banner end applied",
					"tenant_id", tenantID.String(),
					"campaign_banner_id", row.PublicID,
					"error", err,
				)
				continue
			}
		}
		r.logger.InfoContext(ctx, "applied campaign banner boundary",
			"tenant_id", tenantID.String(),
			"campaign_banner_id", row.PublicID,
			"start_applied", row.StartDue.Bool,
			"end_applied", row.EndDue.Bool,
		)
	}
}
