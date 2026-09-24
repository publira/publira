// Command publiractl operates a Publira install from a command line. It
// connects to PostgreSQL directly rather than through ConnectRPC, so it works
// on a deployment that serves no platform API.
//
// The first argument names a command group. db applies db/migrations to the
// database PUBLIRA_DB_URL names and reports its schema version. job runs one of
// the worker's maintenance jobs by hand: the second argument names the job,
// which is configured through environment variables, rebuilds, purges, or
// closes a period of data once, and exits. The worker schedules the same jobs,
// so nothing needs to schedule this command.
//
// Each job is a thin invocation of internal/maintenance, which the worker's
// River jobs invoke as well, so an operator's explicit run and a scheduled one
// are the same implementation.
//
// The jobs that have to act the moment a stored instant passes are not here:
// they run as River periodic jobs inside the worker (internal/tickerjobs).
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/tracing"
)

// job is one maintenance job the job group runs.
type job struct {
	name    string
	summary string
	// run logs its own failure with the context that matters for that job, so
	// the returned error only decides the exit status. Returning instead of
	// calling os.Exit lets pending spans flush on the way out.
	run func(ctx context.Context, logger *slog.Logger, cfg *config.Config) error
}

var jobs = []job{
	{
		name:    "project-episode-reads",
		summary: "File the missing episode_complete events for stored episode reads",
		run:     runProjectEpisodeReads,
	},
	{
		name:    "aggregate-content-stats",
		summary: "Rebuild one calendar day of content_daily_stats for every tenant",
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
		name:    "purge-mfa-challenges",
		summary: "Delete the spent admin MFA challenges whose tokens have expired",
		run:     runPurgeMfaChallenges,
	},
	{
		name:    "purge-withdrawn-comments",
		summary: "Delete the comments their authors withdrew past the retention window",
		run:     runPurgeWithdrawnComments,
	},
	{
		name:    "purge-orphan-images",
		summary: "Delete the image rows and storage objects nothing references",
		run:     runPurgeOrphanImages,
	},
	{
		name:    "build-recommend-features",
		summary: "Rebuild the daily user and item recommend feature snapshots",
		run:     runBuildRecommendFeatures,
	},
	{
		name:    "close-royalty-statements",
		summary: "Close the royalty statements tenants on automatic closing are owed",
		run:     runCloseRoyaltyStatements,
	},
	{
		name:    "sync-google-play-voided-purchases",
		summary: "Take back the purchases Google Play refunded in the last 30 days",
		run:     runSyncGooglePlayVoidedPurchases,
	},
}

func main() {
	os.Exit(run(os.Args[1:], os.Stderr))
}

func run(args []string, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "a command is required", usage())
	}
	switch args[0] {
	case "db":
		return runDB(args[1:], stderr)
	case "job":
		return runJob(args[1:], stderr)
	default:
		return usageError(stderr, fmt.Sprintf("unknown command %q", args[0]), usage())
	}
}

func runJob(args []string, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "a job is required", jobUsage())
	}
	j := lookup(args[0])
	if j == nil {
		return usageError(stderr, fmt.Sprintf("unknown job %q", args[0]), jobUsage())
	}
	if len(args) > 1 {
		return usageError(stderr, fmt.Sprintf("job %s takes no arguments, got %q", j.name, strings.Join(args[1:], " ")), jobUsage())
	}

	logger := logging.New(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	slog.SetDefault(logger)

	shutdownTracing, err := tracing.Setup(context.Background(), "publira-"+j.name)
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
		return 1
	}

	if err := j.run(context.Background(), logger, cfg); err != nil {
		return 1
	}
	return 0
}

func lookup(name string) *job {
	for i := range jobs {
		if jobs[i].name == name {
			return &jobs[i]
		}
	}
	return nil
}

// usageError reports a bad invocation on w, followed by the usage text for the
// level it happened at, and returns the exit status for it.
func usageError(w io.Writer, reason, usage string) int {
	_, _ = io.WriteString(w, "publiractl: "+reason+"\n"+usage)
	return 2
}

func usage() string {
	return "\nUsage: publiractl <command>\n\nCommands:\n" +
		"  db                        Apply the database migrations and report the schema version\n" +
		"  job                       Run one of the worker's maintenance jobs by hand\n"
}

func jobUsage() string {
	var b strings.Builder
	b.WriteString("\nUsage: publiractl job <kind>\n\nJobs:\n")
	for _, j := range jobs {
		fmt.Fprintf(&b, "  %-25s %s\n", j.name, j.summary)
	}
	b.WriteString("\nEvery job reads its settings from the environment.\n")
	return b.String()
}

// resolveDBURL returns the first non-empty environment variable in names, so a
// job can be pointed at the role it needs without disturbing the other
// processes, and falls back to the shared connection string when none is set.
//
// PUBLIRA_WORKER_DB_URL belongs to no chain here. The jobs once shared it
// with the worker because both ran on the same connection, but it now names
// publira_outbox, a role that owns River's schema and that the daily jobs
// must not be able to alter. A job left unconfigured falls through to
// PUBLIRA_DB_URL, which is where it ran before the dedicated stats role existed.
func resolveDBURL(fallback string, names ...string) string {
	for _, name := range names {
		if url := strings.TrimSpace(os.Getenv(name)); url != "" {
			return url
		}
	}
	return fallback
}

// resolveTenantLocalDate reads the calendar date a daily job covers from the
// named variable. The date is each tenant's own local one, so an unset variable
// cannot be answered here with a single day: it yields the zero time, and the
// job resolves every tenant's yesterday in that tenant's zone.
func resolveTenantLocalDate(name string) (time.Time, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.DateOnly, raw)
}

// resolveDryRun reads the switch that turns one purge into a report of what it
// would delete. It is a control over a single invocation rather than a setting
// of the deployment, which is why it is read here and not alongside the
// tunables every caller of internal/maintenance shares.
func resolveDryRun(name string) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return false, nil
	}
	dryRun, err := strconv.ParseBool(raw)
	if err != nil {
		return false, errors.New("dry-run must be a boolean such as true or false")
	}
	return dryRun, nil
}
