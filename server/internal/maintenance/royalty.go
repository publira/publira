package maintenance

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/royalties"
	"github.com/publira/publira/server/internal/tenantday"
)

// RoyaltyStatementClose closes, for every tenant that chose automatic closing,
// each month whose close day has come and that is not closed yet. It has no
// tunables, and therefore no Load function.
type RoyaltyStatementClose struct{}

// Run closes every month owed at the current time.
func (s RoyaltyStatementClose) Run(ctx context.Context, deps Deps) error {
	return s.run(ctx, deps, time.Now())
}

// run is Run at now, which is how a test places a pass on a given day. Each
// tenant's owed months are closed oldest first, the ones a missed pass left
// behind included, and a month someone closed by hand is left as it is.
func (s RoyaltyStatementClose) run(ctx context.Context, deps Deps, now time.Time) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()
	started := time.Now()

	// Under row-level security the configs would read as empty, and the pass
	// would succeed having closed nothing.
	if err := requireBypassRLS(ctx, deps.DB); err != nil {
		return err
	}
	queries := dbmodels.New(deps.DB)
	configs, err := queries.ListAutomaticRoyaltyConfigs(ctx)
	if err != nil {
		return fmt.Errorf("list automatic royalty configs: %w", err)
	}
	tenants, err := tenantday.List(ctx, deps.DB)
	if err != nil {
		return fmt.Errorf("list tenants: %w", err)
	}
	zones := make(map[uuid.UUID]string, len(tenants))
	for _, tenant := range tenants {
		zones[tenant.ID] = tenant.TimeZone
	}

	var (
		failures    []error
		closedCount int
	)
	for _, config := range configs {
		n, err := closeTenant(ctx, logger, deps, queries, config, zones[config.TenantID], now)
		closedCount += n
		if err != nil {
			failures = append(failures, fmt.Errorf("tenant %s: %w", config.TenantID, err))
			logger.ErrorContext(ctx, "royalty statement close failed",
				"tenant_id", config.TenantID,
				"error", err,
			)
			// A cancelled context fails every remaining tenant the same way.
			if ctx.Err() != nil {
				break
			}
		}
	}

	attrs := []any{
		"tenant_count", len(configs),
		"closed_count", closedCount,
		"duration", time.Since(started),
	}
	if err := errors.Join(failures...); err != nil {
		logger.ErrorContext(ctx, "royalty statement close pass failed", append(attrs, "error", err)...)
		return err
	}
	logger.InfoContext(ctx, "royalty statement close pass completed", attrs...)
	return nil
}

// closeTenant closes every month the tenant is owed and reports how many it
// closed. It stops at the first month that fails, so a later month is never
// closed ahead of an earlier one left open.
func closeTenant(
	ctx context.Context,
	logger *slog.Logger,
	deps Deps,
	queries *dbmodels.Queries,
	config dbmodels.TenantRoyaltyConfig,
	timeZone string,
	now time.Time,
) (int, error) {
	if !config.AutoCloseDay.Valid || !config.AutomaticSince.Valid {
		return 0, errors.New("automatic closing has no close day or no start")
	}
	// A tenant deleted between the two listings has nothing left to close.
	if timeZone == "" {
		return 0, nil
	}
	instruction := royalties.AutomaticClose{
		CloseDay: int(config.AutoCloseDay.Int32),
		Since:    config.AutomaticSince.Time,
	}
	schedule, err := instruction.Schedule(timeZone, now)
	if err != nil {
		return 0, err
	}
	logger = logger.With("tenant_id", config.TenantID)

	if !schedule.PreviousIsAutomatic() {
		logger.InfoContext(ctx, "royalty statement skipped: before automatic closing",
			"period", royalties.FormatPeriod(schedule.Previous),
			"automatic_since", config.AutomaticSince.Time.Format(time.RFC3339),
		)
		return 0, nil
	}

	closed := make(map[time.Time]bool)
	if schedule.Owes() {
		periods, err := queries.ListRoyaltyStatementPeriodsFrom(ctx, dbmodels.ListRoyaltyStatementPeriodsFromParams{
			TenantID:   config.TenantID,
			FromPeriod: schedule.First,
		})
		if err != nil {
			return 0, fmt.Errorf("list closed months: %w", err)
		}
		for _, period := range periods {
			closed[civilDate(period)] = true
		}
	}

	var closedCount int
	for period := schedule.First; !period.After(schedule.Last); period = period.AddDate(0, 1, 0) {
		if closed[period] {
			continue
		}
		month := royalties.Month{TenantID: config.TenantID, Period: period, TimeZone: timeZone}
		statement, err := royalties.CloseStatement(ctx, deps.DB, month, uuid.NullUUID{}, now,
			func(ctx context.Context, queries *dbmodels.Queries, _ dbmodels.RoyaltyStatement) error {
				return auditlog.WriteTenant(ctx, queries, logger, auditlog.TenantEntry{
					TenantID:   config.TenantID,
					ActorRole:  auditlog.RoleSystem,
					Action:     "royalty_statement_closed",
					TargetType: "royalty_statement",
					TargetID:   royalties.FormatPeriod(period),
					Outcome:    auditlog.OutcomeSuccess,
					Reason:     "automatic close",
				})
			})
		switch {
		case errors.Is(err, royalties.ErrAlreadyClosed):
			// Someone closed it by hand since the months were listed.
			logger.InfoContext(ctx, "royalty statement already closed",
				"period", royalties.FormatPeriod(period),
			)
		case err != nil:
			return closedCount, fmt.Errorf("close %s: %w", royalties.FormatPeriod(period), err)
		default:
			closedCount++
			logger.InfoContext(ctx, "royalty statement closed",
				"period", royalties.FormatPeriod(period),
				"total_gross", statement.TotalGross,
				"total_refunded", statement.TotalRefunded,
				"total_payout", statement.TotalPayout,
			)
		}
	}

	switch {
	case !schedule.PreviousIsDue():
		logger.InfoContext(ctx, "royalty statement not yet due",
			"period", royalties.FormatPeriod(schedule.Previous),
			"due_on", schedule.PreviousDueOn.Format(time.DateOnly),
		)
	case closed[schedule.Previous]:
		logger.InfoContext(ctx, "royalty statement already closed",
			"period", royalties.FormatPeriod(schedule.Previous),
		)
	}
	return closedCount, nil
}
