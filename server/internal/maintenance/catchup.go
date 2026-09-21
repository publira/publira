package maintenance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/contentranking"
	"github.com/publira/publira/server/internal/contentstats"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/recommendfeatures"
	"github.com/publira/publira/server/internal/retention"
	"github.com/publira/publira/server/internal/tenantday"
)

// The CatchUp methods below are the scheduled form of the daily rebuild chain:
// episode read projection, content stats, rankings, recommend features. Each
// link records in daily_rebuild_progress how far it has got for every tenant,
// and rebuilds every day between there and how far the link before it has got,
// so a day the worker missed while it was down is rebuilt on its return rather
// than skipped, and a link never reads a day its input has not finished.
//
// A tenant's progress stops at the first day that fails, which keeps the gap
// in front of the next pass instead of behind a later day that succeeded. The
// other tenants carry on, and the pass returns every failure together so the
// job that ran it is recorded as failed and retried.

// CatchUp projects every pending episode read and records for every tenant the
// instant the pass began, before which every day it ended may be aggregated. A
// tenant with no record yet starts its chain on its own yesterday.
func (s EpisodeReadProjection) CatchUp(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	started := time.Now()
	if err := s.Run(ctx, deps); err != nil {
		return err
	}

	tenants, err := tenantday.List(ctx, deps.DB)
	if err != nil {
		return fmt.Errorf("list tenants: %w", err)
	}
	queries := dbmodels.New(deps.DB)
	var failures []error
	for _, tenant := range tenants {
		yesterday, err := tenant.Date(time.Time{}, started)
		if err != nil {
			failures = append(failures, fmt.Errorf("resolve the day of tenant %s: %w", tenant.ID, err))
			continue
		}
		if err := queries.RecordEpisodeReadProjection(ctx, dbmodels.RecordEpisodeReadProjectionParams{
			TenantID:     tenant.ID,
			ProjectedAt:  started,
			StartThrough: yesterday.AddDate(0, 0, -1),
		}); err != nil {
			failures = append(failures, fmt.Errorf("record the projection of tenant %s: %w", tenant.ID, err))
			if ctx.Err() != nil {
				break
			}
		}
	}
	if err := errors.Join(failures...); err != nil {
		deps.logger().ErrorContext(ctx, "episode read projection progress not recorded",
			"projected_at", started,
			"error", err,
		)
		return err
	}
	return nil
}

// CatchUp rebuilds, for every tenant, each day from the one after its last
// rebuilt day through the last day its episode reads were projected past. A day
// that began before the tenant's content event retention cutoff has lost its
// events, so it is logged as missing and passed over rather than rebuilt from
// what is left.
func (s ContentStatsAggregation) CatchUp(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	table, err := retention.LoadTable(ctx, dbmodels.New(deps.DB))
	if err != nil {
		return fmt.Errorf("load retention periods: %w", err)
	}
	now := time.Now()
	aggregator := contentstats.New(deps.DB)
	return catchUp(ctx, deps, catchUpLink{
		name: "content stats",
		lost: func(tenant tenantday.Tenant, day time.Time) (bool, error) {
			location, err := time.LoadLocation(tenant.TimeZone)
			if err != nil {
				return false, fmt.Errorf("load time zone %q: %w", tenant.TimeZone, err)
			}
			start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, location)
			return start.Before(table.For(tenant.ID).ContentEventCutoff(now)), nil
		},
		pending: func(tenant tenantday.Tenant, p dbmodels.ListDailyRebuildProgressRow) (time.Time, time.Time, error) {
			last, err := tenant.Date(time.Time{}, p.EpisodeReadsProjectedAt)
			return civilDate(p.ContentStatsThrough).AddDate(0, 0, 1), last, err
		},
		rebuild: func(ctx context.Context, tenant tenantday.Tenant, day time.Time) (int64, error) {
			return aggregator.RunTenant(ctx, tenant, day)
		},
		advance: func(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, day time.Time) error {
			return q.AdvanceContentStatsThrough(ctx, dbmodels.AdvanceContentStatsThroughParams{TenantID: tenantID, Through: day})
		},
	})
}

// CatchUp ranks, for every tenant, each day from the one after its last ranked
// day through its last day of rebuilt content stats. Each day is its own set
// of snapshots, so every one of them is ranked.
func (s RankingAggregation) CatchUp(ctx context.Context, deps Deps) error {
	aggregator := contentranking.New(deps.DB)
	return catchUp(ctx, deps, catchUpLink{
		name: "ranking",
		pending: func(_ tenantday.Tenant, p dbmodels.ListDailyRebuildProgressRow) (time.Time, time.Time, error) {
			return civilDate(p.RankingsThrough).AddDate(0, 0, 1), civilDate(p.ContentStatsThrough), nil
		},
		rebuild: func(ctx context.Context, tenant tenantday.Tenant, day time.Time) (int64, error) {
			_, items, err := aggregator.RunTenant(ctx, tenant.ID, day, s.ItemLimit)
			return int64(items), err
		},
		advance: func(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, day time.Time) error {
			return q.AdvanceRankingsThrough(ctx, dbmodels.AdvanceRankingsThroughParams{TenantID: tenantID, Through: day})
		},
	})
}

// CatchUp builds, for every tenant whose rankings have moved past its features,
// the features of its last ranked day: the tables hold one snapshot per tenant,
// so an earlier day would only be overwritten.
func (s RecommendFeatureBuild) CatchUp(ctx context.Context, deps Deps) error {
	builder := recommendfeatures.New(deps.DB)
	return catchUp(ctx, deps, catchUpLink{
		name: "recommend feature",
		pending: func(_ tenantday.Tenant, p dbmodels.ListDailyRebuildProgressRow) (time.Time, time.Time, error) {
			last := civilDate(p.RankingsThrough)
			if last.After(civilDate(p.RecommendFeaturesThrough)) {
				return last, last, nil
			}
			return last.AddDate(0, 0, 1), last, nil
		},
		rebuild: func(ctx context.Context, tenant tenantday.Tenant, day time.Time) (int64, error) {
			users, items, err := builder.RunTenant(ctx, tenant, day, s.WindowDays)
			return users + items, err
		},
		advance: func(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, day time.Time) error {
			return q.AdvanceRecommendFeaturesThrough(ctx, dbmodels.AdvanceRecommendFeaturesThroughParams{TenantID: tenantID, Through: day})
		},
	})
}

// catchUpLink is one link of the chain as catchUp drives it.
type catchUpLink struct {
	// name words the link in the log.
	name string
	// pending is the first and last day the link owes a tenant. A first day
	// after the last means it owes nothing.
	pending func(tenantday.Tenant, dbmodels.ListDailyRebuildProgressRow) (first, last time.Time, err error)
	// lost reports a day whose input is gone and can no longer be rebuilt. Nil
	// means every day can be.
	lost func(tenantday.Tenant, time.Time) (bool, error)
	// rebuild rebuilds one day and reports the rows it wrote.
	rebuild func(context.Context, tenantday.Tenant, time.Time) (int64, error)
	// advance records the day as rebuilt.
	advance func(context.Context, *dbmodels.Queries, uuid.UUID, time.Time) error
}

func catchUp(ctx context.Context, deps Deps, link catchUpLink) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()
	started := time.Now()

	// Under row-level security the progress would read as empty, and the pass
	// would succeed having rebuilt nothing.
	if err := requireBypassRLS(ctx, deps.DB); err != nil {
		return err
	}
	queries := dbmodels.New(deps.DB)
	tenants, err := tenantday.List(ctx, deps.DB)
	if err != nil {
		return fmt.Errorf("list tenants: %w", err)
	}
	rows, err := queries.ListDailyRebuildProgress(ctx)
	if err != nil {
		return fmt.Errorf("list daily rebuild progress: %w", err)
	}
	progress := make(map[uuid.UUID]dbmodels.ListDailyRebuildProgressRow, len(rows))
	for _, row := range rows {
		progress[row.TenantID] = row
	}

	var (
		failures    []error
		tenantCount int
		dayCount    int
		rowCount    int64
	)
tenants:
	for _, tenant := range tenants {
		// A tenant with no row has not been through a projection yet, and has
		// no day this link may rebuild until it has.
		p, ok := progress[tenant.ID]
		if !ok {
			continue
		}
		first, last, err := link.pending(tenant, p)
		if err != nil {
			failures = append(failures, fmt.Errorf("resolve the days of tenant %s: %w", tenant.ID, err))
			continue
		}
		if first.After(last) {
			continue
		}
		tenantCount++
		first, err = skipLost(ctx, logger, queries, link, tenant, first, last)
		if err != nil {
			failures = append(failures, fmt.Errorf("tenant %s: %w", tenant.ID, err))
			if ctx.Err() != nil {
				break tenants
			}
			continue tenants
		}
		for day := first; !day.After(last); day = day.AddDate(0, 0, 1) {
			n, err := link.rebuild(ctx, tenant, day)
			if err == nil {
				err = link.advance(ctx, queries, tenant.ID, day)
			}
			if err != nil {
				failures = append(failures, fmt.Errorf("tenant %s on %s: %w", tenant.ID, day.Format(time.DateOnly), err))
				logger.ErrorContext(ctx, link.name+" catch-up stopped",
					"tenant_id", tenant.ID,
					"date", day.Format(time.DateOnly),
					"error", err,
				)
				// A cancelled context fails every remaining day the same way.
				if ctx.Err() != nil {
					break tenants
				}
				continue tenants
			}
			dayCount++
			rowCount += n
			logger.InfoContext(ctx, link.name+" rebuilt",
				"tenant_id", tenant.ID,
				"date", day.Format(time.DateOnly),
				"row_count", n,
			)
		}
	}

	attrs := []any{
		"tenant_count", tenantCount,
		"day_count", dayCount,
		"row_count", rowCount,
		"duration", time.Since(started),
	}
	if err := errors.Join(failures...); err != nil {
		logger.ErrorContext(ctx, link.name+" catch-up failed", append(attrs, "error", err)...)
		return err
	}
	logger.InfoContext(ctx, link.name+" catch-up completed", attrs...)
	return nil
}

// skipLost records as rebuilt the lost days at the front of first..last and
// logs them as missing, returning the first day that can still be rebuilt. The
// lost days are always the oldest, since a retention cutoff only moves forward.
func skipLost(ctx context.Context, logger *slog.Logger, queries *dbmodels.Queries, link catchUpLink, tenant tenantday.Tenant, first, last time.Time) (time.Time, error) {
	if link.lost == nil {
		return first, nil
	}
	day := first
	for ; !day.After(last); day = day.AddDate(0, 0, 1) {
		lost, err := link.lost(tenant, day)
		if err != nil {
			return first, err
		}
		if !lost {
			break
		}
	}
	if day.Equal(first) {
		return first, nil
	}
	through := day.AddDate(0, 0, -1)
	if err := link.advance(ctx, queries, tenant.ID, through); err != nil {
		return first, err
	}
	logger.ErrorContext(ctx, link.name+" missing: its input is past retention",
		"tenant_id", tenant.ID,
		"from", first.Format(time.DateOnly),
		"through", through.Format(time.DateOnly),
	)
	return day, nil
}

func requireBypassRLS(ctx context.Context, db *sql.DB) error {
	var bypasses bool
	if err := db.QueryRowContext(ctx, `
		SELECT rolsuper OR rolbypassrls
		FROM pg_roles
		WHERE rolname = current_user
	`).Scan(&bypasses); err != nil {
		return fmt.Errorf("check database role: %w", err)
	}
	if !bypasses {
		return errors.New("maintenance requires a database role with BYPASSRLS")
	}
	return nil
}

// civilDate reads a stored date as midnight UTC of that day, the form tenantday
// answers in.
func civilDate(at time.Time) time.Time {
	year, month, day := at.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}
