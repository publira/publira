package maintenance

import (
	"context"
	"time"

	"github.com/publira/publira/server/internal/commentretention"
	"github.com/publira/publira/server/internal/contentevents"
	"github.com/publira/publira/server/internal/contentranking"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfachallenges"
	"github.com/publira/publira/server/internal/orphanimages"
	"github.com/publira/publira/server/internal/retention"
)

// Run deletes the content_events rows past their retention window.
func (s ContentEventPurge) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()

	table, err := retention.LoadTable(ctx, dbmodels.New(deps.DB))
	if err != nil {
		logger.ErrorContext(ctx, "failed to read retention periods", "error", err)
		return err
	}

	now := time.Now().UTC()
	started := time.Now()
	result, err := contentevents.New(deps.DB).Run(ctx, contentevents.Options{
		Now:       now,
		Retention: table,
		ChunkSize: s.ChunkSize,
		DryRun:    s.DryRun,
	})
	if err != nil {
		logger.ErrorContext(ctx, "content events purge failed",
			"now", now.Format(time.RFC3339),
			"dry_run", s.DryRun,
			"tenant_count", result.TenantCount,
			"row_count", result.RowCount,
			"error", err,
		)
		return err
	}
	logger.InfoContext(ctx, "content events purge completed",
		"now", now.Format(time.RFC3339),
		"default_retention_days", table.Defaults().ContentEventDays,
		"tenant_override_count", table.OverrideCount(),
		"chunk_size", s.ChunkSize,
		"dry_run", result.DryRun,
		"tenant_count", result.TenantCount,
		"row_count", result.RowCount,
		"chunk_count", result.ChunkCount,
		"duration", time.Since(started),
	)
	return nil
}

// Run deletes the content_ranking_snapshots rows past their retention window.
func (s RankingSnapshotPurge) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()

	table, err := retention.LoadTable(ctx, dbmodels.New(deps.DB))
	if err != nil {
		logger.ErrorContext(ctx, "failed to read retention periods", "error", err)
		return err
	}

	now := time.Now().UTC()
	started := time.Now()
	result, err := contentranking.NewPurger(deps.DB).Run(ctx, contentranking.PurgeOptions{
		Now:       now,
		Retention: table,
		ChunkSize: s.ChunkSize,
		DryRun:    s.DryRun,
	})
	if err != nil {
		logger.ErrorContext(ctx, "ranking snapshot purge failed",
			"now", now.Format(time.RFC3339),
			"dry_run", s.DryRun,
			"tenant_count", result.TenantCount,
			"row_count", result.RowCount,
			"chunk_count", result.ChunkCount,
			"duration", time.Since(started),
			"error", err,
		)
		return err
	}
	logger.InfoContext(ctx, "ranking snapshot purge completed",
		"now", now.Format(time.RFC3339),
		"default_daily_retention_days", table.Defaults().DailyRankingSnapshotDays,
		"default_weekly_retention_days", table.Defaults().WeeklyRankingSnapshotDays,
		"tenant_override_count", table.OverrideCount(),
		"chunk_size", s.ChunkSize,
		"dry_run", result.DryRun,
		"tenant_count", result.TenantCount,
		"row_count", result.RowCount,
		"chunk_count", result.ChunkCount,
		"duration", time.Since(started),
	)
	return nil
}

// Run deletes the spent admin MFA challenges whose tokens have expired.
//
// The purge has no retention window of its own: a spent challenge is kept only
// to refuse the token it names, and that token expires five minutes after
// login. The cutoff is therefore the current time.
func (s MfaChallengePurge) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()

	cutoff := time.Now().UTC()
	started := time.Now()
	result, err := mfachallenges.New(deps.DB).Run(ctx, mfachallenges.Options{
		Cutoff:    cutoff,
		ChunkSize: s.ChunkSize,
		DryRun:    s.DryRun,
	})
	if err != nil {
		logger.ErrorContext(ctx, "mfa challenge purge failed",
			"cutoff", cutoff.Format(time.RFC3339),
			"dry_run", s.DryRun,
			"row_count", result.RowCount,
			"error", err,
		)
		return err
	}
	logger.InfoContext(ctx, "mfa challenge purge completed",
		"cutoff", cutoff.Format(time.RFC3339),
		"chunk_size", s.ChunkSize,
		"dry_run", result.DryRun,
		"row_count", result.RowCount,
		"chunk_count", result.ChunkCount,
		"duration", time.Since(started),
	)
	return nil
}

// Run deletes the comments their authors withdrew past the retention window.
func (s WithdrawnCommentPurge) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()

	table, err := retention.LoadTable(ctx, dbmodels.New(deps.DB))
	if err != nil {
		logger.ErrorContext(ctx, "failed to read retention periods", "error", err)
		return err
	}

	now := time.Now().UTC()
	started := time.Now()
	result, err := commentretention.NewPurger(deps.DB).Run(ctx, commentretention.PurgeOptions{
		Now:       now,
		Retention: table,
		ChunkSize: s.ChunkSize,
		DryRun:    s.DryRun,
	})
	if err != nil {
		logger.ErrorContext(ctx, "withdrawn comment purge failed",
			"now", now.Format(time.RFC3339),
			"dry_run", s.DryRun,
			"tenant_count", result.TenantCount,
			"row_count", result.RowCount,
			"chunk_count", result.ChunkCount,
			"duration", time.Since(started),
			"error", err,
		)
		return err
	}
	logger.InfoContext(ctx, "withdrawn comment purge completed",
		"now", now.Format(time.RFC3339),
		"default_retention_days", table.Defaults().WithdrawnCommentDays,
		"tenant_override_count", table.OverrideCount(),
		"chunk_size", s.ChunkSize,
		"dry_run", result.DryRun,
		"tenant_count", result.TenantCount,
		"row_count", result.RowCount,
		"chunk_count", result.ChunkCount,
		"duration", time.Since(started),
	)
	return nil
}

// Run deletes the image rows and the storage objects nothing references.
func (s OrphanImagePurge) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	if deps.Storage == nil {
		return errNoStorage
	}
	logger := deps.logger()

	cutoff := time.Now().UTC().Add(-s.MinAge)
	started := time.Now()
	result, err := orphanimages.New(deps.DB, deps.Storage).Run(ctx, orphanimages.Options{
		Cutoff:   cutoff,
		PageSize: s.PageSize,
		DryRun:   s.DryRun,
	})
	if err != nil {
		logger.ErrorContext(ctx, "orphan image reclamation failed",
			"cutoff", cutoff.Format(time.RFC3339),
			"dry_run", s.DryRun,
			"bucket", deps.Bucket,
			"row_count", result.RowCount,
			"scanned_count", result.ScannedCount,
			"deleted_count", result.DeletedCount,
			"error", err,
		)
		return err
	}
	logger.InfoContext(ctx, "orphan image reclamation completed",
		"cutoff", cutoff.Format(time.RFC3339),
		"min_age", s.MinAge,
		"page_size", s.PageSize,
		"bucket", deps.Bucket,
		"dry_run", result.DryRun,
		"row_count", result.RowCount,
		"scanned_count", result.ScannedCount,
		"deleted_count", result.DeletedCount,
		"page_count", result.PageCount,
		"duration", time.Since(started),
	)
	return nil
}
