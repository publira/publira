package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/tracing"
)

var jobGroup = commandGroup{
	name:     "job",
	summary:  "Run one of the worker's maintenance jobs by hand",
	synopsis: "<kind>",
	heading:  "Jobs",
	note:     "Every job reads its settings from the environment.",
	commands: []command{
		jobCommand("project-episode-reads", "File the missing episode_complete events for stored episode reads", runProjectEpisodeReads),
		jobCommand("aggregate-content-stats", "Rebuild one calendar day of content_daily_stats for every tenant", runAggregateContentStats),
		jobCommand("aggregate-rankings", "Rebuild the daily and weekly ranking snapshots for every tenant", runAggregateRankings),
		jobCommand("purge-content-events", "Delete content_events rows past their retention window", runPurgeContentEvents),
		jobCommand("purge-ranking-snapshots", "Delete content_ranking_snapshots rows past their retention window", runPurgeRankingSnapshots),
		jobCommand("purge-mfa-challenges", "Delete the spent admin MFA challenges whose tokens have expired", runPurgeMfaChallenges),
		jobCommand("purge-withdrawn-comments", "Delete the comments their authors withdrew past the retention window", runPurgeWithdrawnComments),
		jobCommand("purge-orphan-images", "Delete the image rows and storage objects nothing references", runPurgeOrphanImages),
		jobCommand("build-recommend-features", "Rebuild the daily user and item recommend feature snapshots", runBuildRecommendFeatures),
		jobCommand("close-royalty-statements", "Close the royalty statements tenants on automatic closing are owed", runCloseRoyaltyStatements),
		jobCommand("sync-google-play-voided-purchases", "Take back the purchases Google Play refunded in the last 30 days", runSyncGooglePlayVoidedPurchases),
		jobCommand("build-search-index", "Build the catalog index on the saved search engine, if one is due, and move the search onto it", runBuildSearchIndex),
	},
}

// jobCommand is the command that runs one maintenance job, logging to stdout
// and tracing under the service name the worker's River kind reports.
//
// run logs its own failure with the context that matters for that job, so the
// returned error only decides the exit status.
func jobCommand(name, summary string, run func(ctx context.Context, logger *slog.Logger, cfg *config.Config) error) command {
	return command{
		name:    name,
		summary: summary,
		setup: func(*commandFlags) func(context.Context, *commandEnv) error {
			return func(ctx context.Context, env *commandEnv) error {
				logger := logging.New(env.stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
				slog.SetDefault(logger)

				shutdownTracing, err := tracing.Setup(ctx, "publira-"+name)
				if err != nil {
					// Telemetry is not worth refusing to run the job over.
					logger.Error("failed to initialize tracing", "error", err)
				}
				defer func() {
					if err := shutdownTracing(context.Background()); err != nil {
						logger.Error("failed to flush pending spans", "error", err)
					}
				}()

				cfg, err := config.New()
				if err != nil {
					logger.Error("failed to load config", "error", err)
					return errLogged
				}
				if err := run(ctx, logger, cfg); err != nil {
					return errLogged
				}
				return nil
			}
		},
	}
}
