// Command batch runs this repository's batch jobs. The first argument names
// the job; every job is configured through environment variables and owns its
// own lifecycle, from the publish-episodes ticker to the one-shot rebuilds.
package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/tracing"
)

// subcommand is one batch job.
type subcommand struct {
	name    string
	summary string
	// run logs its own failure with the context that matters for that job, so
	// the returned error only decides the exit status. Returning instead of
	// calling os.Exit lets pending spans flush on the way out.
	run func(ctx context.Context, logger *slog.Logger, cfg *config.Config) error
}

var subcommands = []subcommand{
	{
		name:    "publish-episodes",
		summary: "Promote scheduled episodes on a ticker until interrupted",
		run:     runPublishEpisodes,
	},
	{
		name:    "aggregate-content-stats",
		summary: "Rebuild one UTC day of content_daily_stats for every tenant",
		run:     runAggregateContentStats,
	},
	{
		name:    "aggregate-rankings",
		summary: "Rebuild the daily and weekly ranking snapshots for every tenant",
		run:     runAggregateRankings,
	},
	{
		name:    "purge-content-events",
		summary: "Delete content_events rows past their retention window",
		run:     runPurgeContentEvents,
	},
	{
		name:    "purge-ranking-snapshots",
		summary: "Delete content_ranking_snapshots rows past their retention window",
		run:     runPurgeRankingSnapshots,
	},
	{
		name:    "build-recommend-features",
		summary: "Rebuild the daily user and item recommend feature snapshots",
		run:     runBuildRecommendFeatures,
	},
}

func main() {
	os.Exit(run(os.Args[1:], os.Stderr))
}

func run(args []string, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "a subcommand is required")
	}
	cmd := lookup(args[0])
	if cmd == nil {
		return usageError(stderr, fmt.Sprintf("unknown subcommand %q", args[0]))
	}
	if len(args) > 1 {
		return usageError(stderr, fmt.Sprintf("%s takes no arguments, got %q", cmd.name, strings.Join(args[1:], " ")))
	}

	logger := logging.New(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	slog.SetDefault(logger)

	shutdownTracing, err := tracing.Setup(context.Background(), "publira-"+cmd.name)
	if err != nil {
		// Telemetry is not worth refusing to run the batch over.
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
		return 1
	}

	if err := cmd.run(context.Background(), logger, cfg); err != nil {
		return 1
	}
	return 0
}

func lookup(name string) *subcommand {
	for i := range subcommands {
		if subcommands[i].name == name {
			return &subcommands[i]
		}
	}
	return nil
}

// usageError reports a bad invocation on w and returns the exit status for it.
func usageError(w io.Writer, reason string) int {
	_, _ = io.WriteString(w, "batch: "+reason+"\n"+usage())
	return 2
}

func usage() string {
	var b strings.Builder
	b.WriteString("\nUsage: batch <subcommand>\n\nSubcommands:\n")
	for _, cmd := range subcommands {
		fmt.Fprintf(&b, "  %-25s %s\n", cmd.name, cmd.summary)
	}
	b.WriteString("\nEvery subcommand reads its settings from the environment.\n")
	return b.String()
}

// resolveDBURL returns the first non-empty environment variable in names, so a
// batch can be pointed at the role it needs without disturbing the other
// processes, and falls back to the shared connection string when none is set.
func resolveDBURL(fallback string, names ...string) string {
	for _, name := range names {
		if url := strings.TrimSpace(os.Getenv(name)); url != "" {
			return url
		}
	}
	return fallback
}
