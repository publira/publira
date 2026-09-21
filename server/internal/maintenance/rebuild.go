package maintenance

import (
	"context"
	"time"

	"github.com/publira/publira/server/internal/contentevents"
	"github.com/publira/publira/server/internal/contentranking"
	"github.com/publira/publira/server/internal/contentstats"
	"github.com/publira/publira/server/internal/recommendfeatures"
)

// Run files the analytics counterpart of every stored episode read that does
// not have one yet. Run it before ContentStatsAggregation for the same day: a
// late projection still files the event on the day the member finished, but
// only a rebuild of that day picks it up.
func (s EpisodeReadProjection) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()

	started := time.Now()
	result, err := contentevents.NewProjector(deps.DB).Run(ctx, contentevents.ProjectionOptions{
		BatchSize: s.BatchSize,
	})
	if err != nil {
		logger.ErrorContext(ctx, "episode read projection failed",
			"batch_size", s.BatchSize,
			"row_count", result.RowCount,
			"error", err,
		)
		return err
	}
	logger.InfoContext(ctx, "episode read projection completed",
		"batch_size", s.BatchSize,
		"row_count", result.RowCount,
		"batch_count", result.BatchCount,
		"duration", time.Since(started),
	)
	return nil
}

// Run rebuilds one calendar day of content_daily_stats across every tenant.
func (s ContentStatsAggregation) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()

	started := time.Now()
	result, err := contentstats.New(deps.DB).Run(ctx, contentstats.Options{StatDate: s.Date})
	if err != nil {
		logger.ErrorContext(ctx, "content stats aggregation failed",
			"stat_date", dateLogValue(s.Date),
			"tenant_count", result.TenantCount,
			"row_count", result.RowCount,
			"duration", time.Since(started),
			"error", err,
		)
		return err
	}
	logger.InfoContext(ctx, "content stats aggregation completed",
		"stat_date", dateLogValue(s.Date),
		"tenant_count", result.TenantCount,
		"row_count", result.RowCount,
		"duration", time.Since(started),
	)
	return nil
}

// Run rebuilds every tenant's ranking snapshots from the content_daily_stats
// rows ContentStatsAggregation produces, so it follows one for the same day.
func (s RankingAggregation) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()

	started := time.Now()
	result, err := contentranking.New(deps.DB).Run(ctx, contentranking.Options{
		ReferenceDate: s.Date,
		ItemLimit:     s.ItemLimit,
	})
	if err != nil {
		logger.ErrorContext(ctx, "ranking aggregation failed",
			"reference_date", dateLogValue(s.Date),
			"item_limit", s.ItemLimit,
			"algorithm_version", contentranking.AlgorithmVersion,
			"tenant_count", result.TenantCount,
			"snapshot_count", result.SnapshotCount,
			"item_count", result.ItemCount,
			"duration", time.Since(started),
			"error", err,
		)
		return err
	}
	logger.InfoContext(ctx, "ranking aggregation completed",
		"reference_date", dateLogValue(s.Date),
		"item_limit", s.ItemLimit,
		"algorithm_version", contentranking.AlgorithmVersion,
		"tenant_count", result.TenantCount,
		"snapshot_count", result.SnapshotCount,
		"item_count", result.ItemCount,
		"duration", time.Since(started),
	)
	return nil
}

// Run rebuilds the daily user and item recommend feature snapshots.
func (s RecommendFeatureBuild) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()

	started := time.Now()
	result, err := recommendfeatures.New(deps.DB).Run(ctx, recommendfeatures.Options{
		ReferenceDate: s.Date,
		WindowDays:    s.WindowDays,
	})
	if err != nil {
		logger.ErrorContext(ctx, "recommend feature build failed",
			"reference_date", dateLogValue(s.Date),
			"window_days", s.WindowDays,
			"tenant_count", result.TenantCount,
			"user_row_count", result.UserRowCount,
			"item_row_count", result.ItemRowCount,
			"error", err,
		)
		return err
	}
	logger.InfoContext(ctx, "recommend feature build completed",
		"reference_date", dateLogValue(s.Date),
		"window_days", s.WindowDays,
		"feature_version", recommendfeatures.FeatureVersion,
		"tenant_count", result.TenantCount,
		"user_row_count", result.UserRowCount,
		"item_row_count", result.ItemRowCount,
		"duration", time.Since(started),
	)
	return nil
}
