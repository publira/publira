// Package dayroll turns over the public site cache entries whose answer is a
// tenant's own calendar day.
//
// One module asks that question today: the storefront's weekly schedule, which
// opens on the day it is where the tenant publishes. Nothing in the database
// changes at midnight — the schedule itself is the same seven days it was
// yesterday — and the page that shows it is prerendered, so the day it names
// is the day its cache entry was filled on. This runner is what turns that
// entry over, once per tenant per calendar day.
//
// It drops a tag of its own rather than the catalog's. A daily drop aimed at
// the series tags would rebuild every list and every series page for the sake
// of one number on one module, and making the page request-time instead would
// give up the prerender of everything else on it.
package dayroll

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/publira/publira/server/internal/tenantday"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/dayroll")

// Lister enumerates the tenants and the zones their days are counted in.
// tenantday.List satisfies it once its database handle is bound.
type Lister func(ctx context.Context) ([]tenantday.Tenant, error)

// Revalidator drops Next.js cache tags. *revalidate.Client satisfies it, and a
// nil client of that type is a no-op.
type Revalidator interface {
	RevalidateTags(ctx context.Context, tags []string) error
}

// Runner drops each tenant's day-dependent caches when that tenant's calendar
// day turns.
type Runner struct {
	list   Lister
	reval  Revalidator
	logger *slog.Logger
	// rolled holds the local date each tenant's last drop answered for.
	//
	// In memory on purpose. A drop is idempotent, so the worst a restart can
	// do is drop one narrow tag per tenant a second time — which is cheaper
	// than the column it would take to remember otherwise, and safer than the
	// alternative failure: a process that came up believing it had already
	// rolled a day it had not would leave the site naming yesterday until the
	// next midnight.
	rolled map[uuid.UUID]string
}

// New constructs a runner over list. reval may be nil, which makes every pass
// record the day it saw without dropping anything.
func New(list Lister, reval Revalidator, logger *slog.Logger) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	return &Runner{
		list:   list,
		logger: logger,
		reval:  reval,
		rolled: make(map[uuid.UUID]string),
	}
}

// RevalidateTags names what a tenant's public site caches a day-dependent
// answer under. It is one tag per tenant, and it is the only thing this runner
// ever drops.
func RevalidateTags(tenantID uuid.UUID) []string {
	return []string{fmt.Sprintf("tenant:%s:today", tenantID.String())}
}

// RunOnce drops the caches of every tenant that has entered a new calendar day
// since this process last looked.
//
// One tenant's failure never stops the rest: a zone that will not load and a
// revalidation that will not go through are both logged and left for the next
// pass, which is what a ticker is for.
func (r *Runner) RunOnce(ctx context.Context, now time.Time) {
	ctx, span := tracer.Start(ctx, "dayroll.RunOnce")
	defer span.End()

	tenants, err := r.list(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list tenants", "error", err)
		return
	}

	rolled := 0
	for _, tenant := range tenants {
		if ctx.Err() != nil {
			return
		}
		if r.rollTenant(ctx, tenant, now) {
			rolled++
		}
	}

	span.SetAttributes(
		attribute.Int("publira.tenant_day.tenants", len(tenants)),
		attribute.Int("publira.tenant_day.rolled", rolled),
	)
}

// rollTenant reports whether this tenant's caches were turned over.
func (r *Runner) rollTenant(ctx context.Context, tenant tenantday.Tenant, now time.Time) bool {
	today, err := tenant.Today(now)
	if err != nil {
		r.logger.WarnContext(ctx, "failed to resolve a tenant's calendar day",
			"tenant_id", tenant.ID.String(),
			"time_zone", tenant.TimeZone,
			"error", err,
		)
		return false
	}

	date := today.Format(time.DateOnly)
	if r.rolled[tenant.ID] == date {
		return false
	}

	if r.reval != nil {
		// Recorded only once the drop went through, so a failed revalidation
		// is retried on the next pass instead of leaving the site on the day
		// before.
		if err := r.reval.RevalidateTags(ctx, RevalidateTags(tenant.ID)); err != nil {
			r.logger.WarnContext(ctx, "failed to revalidate after a tenant's day turned",
				"tenant_id", tenant.ID.String(),
				"date", date,
				"error", err,
			)
			return false
		}
	}

	r.rolled[tenant.ID] = date
	r.logger.InfoContext(ctx, "rolled a tenant's day-dependent caches",
		"tenant_id", tenant.ID.String(),
		"time_zone", tenant.TimeZone,
		"date", date,
	)
	return true
}
