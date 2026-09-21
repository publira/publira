package maintenancejobs

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/publira/publira/server/internal/storage"
)

func TestNewRejectsAMissingPool(t *testing.T) {
	if _, err := New(Config{}); err == nil {
		t.Fatal("New with no DB returned no error, want one")
	}
}

// The tunables are read once, at startup, so a value an operator mistyped stops
// the worker with the variable's name instead of failing every scheduled pass
// from then on.
func TestNewRejectsAMistypedTunable(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE", "0")
	_, err := New(Config{DB: &sql.DB{}})
	if err == nil {
		t.Fatal("New with an invalid chunk size returned no error, want one")
	}
	if !strings.Contains(err.Error(), "PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE") {
		t.Fatalf("error = %v, want it to name the variable", err)
	}
}

// Every run of one of these spans every tenant, so two at once would restate
// the same rows or delete the same chunk twice. The unique states are what stop
// a second instance of the worker and a pass that outlasts its own interval.
func TestEveryJobIsUniqueWhileOneIsInFlight(t *testing.T) {
	inFlight := []rivertype.JobState{
		rivertype.JobStateAvailable,
		rivertype.JobStatePending,
		rivertype.JobStateRunning,
		rivertype.JobStateRetryable,
		rivertype.JobStateScheduled,
	}

	for _, args := range everyArgs() {
		withOpts, ok := args.(river.JobArgsWithInsertOpts)
		if !ok {
			t.Fatalf("%s does not declare insert options", args.Kind())
		}
		opts := withOpts.InsertOpts()
		if opts.Queue != QueueName {
			t.Fatalf("%s queue = %q, want %q", args.Kind(), opts.Queue, QueueName)
		}
		if opts.MaxAttempts != maxAttempts {
			t.Fatalf("%s max attempts = %d, want %d", args.Kind(), opts.MaxAttempts, maxAttempts)
		}
		if !slices.Equal(opts.UniqueOpts.ByState, inFlight) {
			t.Fatalf("%s unique states = %v, want %v", args.Kind(), opts.UniqueOpts.ByState, inFlight)
		}
	}
}

// A rebuild walks every tenant and a purge drains a table, so they run on a
// queue of their own rather than holding workers the outbox drain is sized for.
func TestJobsRunOnTheirOwnQueue(t *testing.T) {
	jobs := newJobs(t, Config{DB: &sql.DB{}})

	queues := jobs.Queues()
	if len(queues) != 1 {
		t.Fatalf("queues = %v, want exactly one", queues)
	}
	queue, ok := queues[QueueName]
	if !ok {
		t.Fatalf("queues = %v, want one named %q", queues, QueueName)
	}
	if queue.MaxWorkers != queueMaxWorkers {
		t.Fatalf("%s max workers = %d, want %d", QueueName, queue.MaxWorkers, queueMaxWorkers)
	}
	if _, ok := queues[river.QueueDefault]; ok {
		t.Fatalf("queues = %v, want the default queue left to the outbox drain", queues)
	}
}

// Only the head of the daily rebuild chain is scheduled, and it runs on start
// so a worker that was down picks up the days it missed without waiting an
// interval. Each link enqueues the next.
func TestTheDailyRebuildChainIsScheduledFromItsHead(t *testing.T) {
	jobs := newJobs(t, Config{DB: &sql.DB{}})

	periodic := jobs.PeriodicJobs()
	if len(periodic) != 1 {
		t.Fatalf("periodic jobs = %d, want only the head of the chain", len(periodic))
	}
}

func TestEveryKindIsNamespacedAndDistinct(t *testing.T) {
	seen := make(map[string]bool)
	for _, args := range everyArgs() {
		kind := args.Kind()
		if !strings.HasPrefix(kind, "maintenance.") {
			t.Fatalf("kind %q is not namespaced under maintenance.", kind)
		}
		if seen[kind] {
			t.Fatalf("kind %q is declared twice", kind)
		}
		seen[kind] = true
	}
}

// A trace UI attributes a trace to the service of its root span, so a kind with
// no name of its own would report its runs as the worker process itself.
func TestServiceNamesCoverEveryKind(t *testing.T) {
	names := ServiceNames()
	if len(names) != len(everyArgs()) {
		t.Fatalf("service names = %d, want one per kind (%d)", len(names), len(everyArgs()))
	}
	seen := make(map[string]bool, len(names))
	for _, name := range names {
		if !strings.HasPrefix(name, "publira-") {
			t.Fatalf("service name %q does not name a publira service", name)
		}
		if seen[name] {
			t.Fatalf("service name %q is listed twice", name)
		}
		seen[name] = true
	}
}

func TestRegisterAddsAWorkerForEveryKind(t *testing.T) {
	jobs := newJobs(t, Config{DB: &sql.DB{}, Storage: stubSource{}})

	workers := river.NewWorkers()
	if err := jobs.Register(workers); err != nil {
		t.Fatalf("Register: %v", err)
	}
	for kind, probe := range probes() {
		if err := probe(workers); err == nil {
			t.Fatalf("kind %q has no registered worker", kind)
		}
	}
}

// A platform that has not configured its object store yet cannot sweep it, and
// no retry would change that, so the run is cancelled with the reason rather
// than retried until River discards it.
func TestPurgeOrphanImagesCancelsWithoutConfiguredStorage(t *testing.T) {
	jobs := newJobs(t, Config{DB: &sql.DB{}, Storage: stubSource{err: storage.ErrNotConfigured}})

	err := (&purgeOrphanImagesWorker{jobs: jobs}).Work(context.Background(), &river.Job[PurgeOrphanImagesArgs]{})
	var cancel *river.JobCancelError
	if !errors.As(err, &cancel) {
		t.Fatalf("Work error = %v, want a JobCancelError", err)
	}
	if !errors.Is(err, storage.ErrNotConfigured) {
		t.Fatalf("Work error = %v, want it to wrap %v", err, storage.ErrNotConfigured)
	}
}

func newJobs(t *testing.T, cfg Config) *Jobs {
	t.Helper()
	jobs, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return jobs
}

func everyArgs() []river.JobArgs {
	return []river.JobArgs{
		ProjectEpisodeReadsArgs{},
		AggregateContentStatsArgs{},
		AggregateRankingsArgs{},
		BuildRecommendFeaturesArgs{},
		PurgeContentEventsArgs{},
		PurgeRankingSnapshotsArgs{},
		PurgeMfaChallengesArgs{},
		PurgeWithdrawnCommentsArgs{},
		PurgeOrphanImagesArgs{},
	}
}

// probes re-registers one worker per kind. River refuses a kind its registry
// already holds, so an error is how a registered kind reports itself — which is
// the only way to read a Workers bundle back.
func probes() map[string]func(*river.Workers) error {
	return map[string]func(*river.Workers) error{
		kindProjectEpisodeReads: func(w *river.Workers) error {
			return river.AddWorkerSafely(w, &projectEpisodeReadsWorker{})
		},
		kindAggregateContentStats: func(w *river.Workers) error {
			return river.AddWorkerSafely(w, &aggregateContentStatsWorker{})
		},
		kindAggregateRankings: func(w *river.Workers) error {
			return river.AddWorkerSafely(w, &aggregateRankingsWorker{})
		},
		kindBuildRecommendFeatures: func(w *river.Workers) error {
			return river.AddWorkerSafely(w, &buildRecommendFeaturesWorker{})
		},
		kindPurgeContentEvents: func(w *river.Workers) error {
			return river.AddWorkerSafely(w, &purgeContentEventsWorker{})
		},
		kindPurgeRankingSnapshots: func(w *river.Workers) error {
			return river.AddWorkerSafely(w, &purgeRankingSnapshotsWorker{})
		},
		kindPurgeMfaChallenges: func(w *river.Workers) error {
			return river.AddWorkerSafely(w, &purgeMfaChallengesWorker{})
		},
		kindPurgeWithdrawnComments: func(w *river.Workers) error {
			return river.AddWorkerSafely(w, &purgeWithdrawnCommentsWorker{})
		},
		kindPurgeOrphanImages: func(w *river.Workers) error {
			return river.AddWorkerSafely(w, &purgeOrphanImagesWorker{})
		},
	}
}

// stubSource stands in for the resolved bucket. It answers err, and no
// reclaimer, because no test here reaches a listing.
type stubSource struct{ err error }

func (s stubSource) Reclaimer(context.Context) (storage.Reclaimer, string, error) {
	return nil, "", s.err
}
