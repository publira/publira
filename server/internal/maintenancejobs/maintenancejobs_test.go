package maintenancejobs

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

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
	for _, args := range everyArgs() {
		opts := insertOptsOf(t, args)
		if opts.Queue != QueueName {
			t.Fatalf("%s queue = %q, want %q", args.Kind(), opts.Queue, QueueName)
		}
		if opts.MaxAttempts != maxAttempts {
			t.Fatalf("%s max attempts = %d, want %d", args.Kind(), opts.MaxAttempts, maxAttempts)
		}
		for _, state := range inFlight() {
			if !slices.Contains(opts.UniqueOpts.ByState, state) {
				t.Fatalf("%s unique states = %v, want them to include %s", args.Kind(), opts.UniqueOpts.ByState, state)
			}
		}
	}
}

// The rebuild chain keeps no completed run as a reason to skip one: each link
// only reads what a tenant has recorded, so a run that finds nothing to do is
// the answer rather than a waste.
func TestTheRebuildChainIsUniqueOnlyWhileInFlight(t *testing.T) {
	for _, args := range []river.JobArgs{
		ProjectEpisodeReadsArgs{},
		AggregateContentStatsArgs{},
		AggregateRankingsArgs{},
		BuildRecommendFeaturesArgs{},
	} {
		opts := insertOptsOf(t, args)
		if !slices.Equal(opts.UniqueOpts.ByState, inFlight()) {
			t.Fatalf("%s unique states = %v, want %v", args.Kind(), opts.UniqueOpts.ByState, inFlight())
		}
		if opts.UniqueOpts.ByPeriod != 0 {
			t.Fatalf("%s unique period = %v, want none", args.Kind(), opts.UniqueOpts.ByPeriod)
		}
	}
}

// A purge runs on start, so without a completed run counting against the
// insert every restart would be a pass of its own. Each is kept to one run per
// interval, the same interval it is scheduled on.
func TestEveryPurgeRunsOncePerInterval(t *testing.T) {
	for args, interval := range map[river.JobArgs]time.Duration{
		PurgeContentEventsArgs{}:     contentEventPurgeInterval,
		PurgeRankingSnapshotsArgs{}:  rankingSnapshotPurgeInterval,
		PurgeMfaChallengesArgs{}:     mfaChallengePurgeInterval,
		PurgeWithdrawnCommentsArgs{}: withdrawnCommentPurgeInterval,
		PurgeOrphanImagesArgs{}:      orphanImagePurgeInterval,
	} {
		opts := insertOptsOf(t, args)
		if opts.UniqueOpts.ByPeriod != interval {
			t.Fatalf("%s unique period = %v, want %v", args.Kind(), opts.UniqueOpts.ByPeriod, interval)
		}
		want := append(inFlight(), rivertype.JobStateCompleted)
		if !slices.Equal(opts.UniqueOpts.ByState, want) {
			t.Fatalf("%s unique states = %v, want %v", args.Kind(), opts.UniqueOpts.ByState, want)
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

// Only the head of the daily rebuild chain is scheduled, since each link
// enqueues the next, and every purge is scheduled on its own.
func TestTheChainHeadAndEveryPurgeAreScheduled(t *testing.T) {
	jobs := newJobs(t, Config{DB: &sql.DB{}})

	if got, want := len(jobs.PeriodicJobs()), 6; got != want {
		t.Fatalf("periodic jobs = %d, want %d: the chain head and five purges", got, want)
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

	err := (&purgeOrphanImagesWorker{jobs: jobs}).Work(context.Background(), jobOf(PurgeOrphanImagesArgs{}))
	var cancel *river.JobCancelError
	if !errors.As(err, &cancel) {
		t.Fatalf("Work error = %v, want a JobCancelError", err)
	}
	if !errors.Is(err, storage.ErrNotConfigured) {
		t.Fatalf("Work error = %v, want it to wrap %v", err, storage.ErrNotConfigured)
	}
}

// A failed pass is found from a trace or a log line, and both have to lead to
// the river_job row that holds its error and its retries.
func TestAFailedPassNamesItsJobInTheTraceAndTheLog(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder)))
	t.Cleanup(func() { otel.SetTracerProvider(previous) })

	var logs bytes.Buffer
	jobs := newJobs(t, Config{
		DB:      &sql.DB{},
		Storage: stubSource{err: errors.New("bucket unreachable")},
		Logger:  slog.New(slog.NewJSONHandler(&logs, nil)),
	})
	job := jobOf(PurgeOrphanImagesArgs{})
	job.ID = 42
	job.Attempt = 2

	if err := (&purgeOrphanImagesWorker{jobs: jobs}).Work(context.Background(), job); err == nil {
		t.Fatal("Work succeeded, want the storage error")
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	span := spans[0]
	if span.Name() != kindPurgeOrphanImages {
		t.Fatalf("span name = %q, want %q", span.Name(), kindPurgeOrphanImages)
	}
	if span.Status().Code != codes.Error {
		t.Fatalf("span status = %v, want %v", span.Status().Code, codes.Error)
	}
	attrs := map[attribute.Key]attribute.Value{}
	for _, kv := range span.Attributes() {
		attrs[kv.Key] = kv.Value
	}
	if got := attrs["river.job.id"].AsInt64(); got != 42 {
		t.Fatalf("river.job.id = %d, want 42", got)
	}
	if got := attrs["river.job.attempt"].AsInt64(); got != 2 {
		t.Fatalf("river.job.attempt = %d, want 2", got)
	}

	var line struct {
		Kind    string `json:"job_kind"`
		ID      int64  `json:"job_id"`
		Attempt int    `json:"attempt"`
	}
	if err := json.Unmarshal(logs.Bytes(), &line); err != nil {
		t.Fatalf("decode the pass's log line %q: %v", logs.String(), err)
	}
	if line.Kind != kindPurgeOrphanImages || line.ID != 42 || line.Attempt != 2 {
		t.Fatalf("log line names job %+v, want %s 42 attempt 2", line, kindPurgeOrphanImages)
	}
}

// jobOf wraps args in the row River hands a worker, as a job of its kind.
func jobOf[T river.JobArgs](args T) *river.Job[T] {
	return &river.Job[T]{JobRow: &rivertype.JobRow{Kind: args.Kind()}, Args: args}
}

func inFlight() []rivertype.JobState {
	return []rivertype.JobState{
		rivertype.JobStateAvailable,
		rivertype.JobStatePending,
		rivertype.JobStateRunning,
		rivertype.JobStateRetryable,
		rivertype.JobStateScheduled,
	}
}

func insertOptsOf(t *testing.T, args river.JobArgs) river.InsertOpts {
	t.Helper()
	withOpts, ok := args.(river.JobArgsWithInsertOpts)
	if !ok {
		t.Fatalf("%s does not declare insert options", args.Kind())
	}
	return withOpts.InsertOpts()
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
