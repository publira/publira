package tickerjobs

import (
	"database/sql"
	"maps"
	"slices"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
)

func TestNewRejectsAMissingPool(t *testing.T) {
	if _, err := New(Config{}); err == nil {
		t.Fatal("New with no DB returned no error, want one")
	}
}

func TestPeriodicJobsTakeTheConfiguredIntervals(t *testing.T) {
	jobs, err := New(Config{
		DB:                         &sql.DB{},
		PublishInterval:            5 * time.Second,
		FreeWindowInterval:         7 * time.Second,
		TenantDayInterval:          11 * time.Second,
		PinnedAnnouncementInterval: 13 * time.Second,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	assertIntervals(t, jobs, map[string]time.Duration{
		kindPublishEpisodes:           5 * time.Second,
		kindApplyFreeWindows:          7 * time.Second,
		kindRollTenantDay:             11 * time.Second,
		kindExpirePinnedAnnouncements: 13 * time.Second,
	})
}

func TestPeriodicJobsFallBackToTheDefaultIntervals(t *testing.T) {
	jobs, err := New(Config{DB: &sql.DB{}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	assertIntervals(t, jobs, map[string]time.Duration{
		kindPublishEpisodes:           DefaultPublishInterval,
		kindApplyFreeWindows:          DefaultFreeWindowInterval,
		kindRollTenantDay:             DefaultTenantDayInterval,
		kindExpirePinnedAnnouncements: DefaultPinnedAnnouncementInterval,
	})
}

// assertIntervals reads the interval back off each job's own schedule, so a
// wrong one — a default where a setting was passed, or two jobs' intervals
// swapped — fails here rather than running at the other job's cadence.
func assertIntervals(t *testing.T, jobs *Jobs, want map[string]time.Duration) {
	t.Helper()

	entries := jobs.schedule()
	if len(entries) != len(want) {
		t.Fatalf("scheduled jobs = %d, want %d", len(entries), len(want))
	}
	if periodic := jobs.PeriodicJobs(); len(periodic) != len(entries) {
		t.Fatalf("periodic jobs = %d, want one per scheduled job (%d)", len(periodic), len(entries))
	}

	now := time.Now()
	for _, entry := range entries {
		kind := entry.args.Kind()
		wanted, ok := want[kind]
		if !ok {
			t.Fatalf("scheduled an unexpected job kind %q", kind)
		}
		if got := entry.schedule.Next(now).Sub(now); got != wanted {
			t.Fatalf("%s interval = %s, want %s", kind, got, wanted)
		}
		delete(want, kind)
	}
	if len(want) != 0 {
		t.Fatalf("job kinds with no schedule: %v", slices.Collect(maps.Keys(want)))
	}
}

// Every one of them spans every tenant, so two runs of the same job at once
// would write the same rows twice. The unique states are what stop a
// second worker's copy and a pass that outlasts its own interval alike.
func TestEveryJobIsUniqueWhileOneIsInFlight(t *testing.T) {
	inFlight := []rivertype.JobState{
		rivertype.JobStateAvailable,
		rivertype.JobStatePending,
		rivertype.JobStateRunning,
		rivertype.JobStateRetryable,
		rivertype.JobStateScheduled,
	}

	for _, args := range []river.JobArgs{
		PublishEpisodesArgs{},
		ApplyFreeWindowsArgs{},
		RollTenantDayArgs{},
		ExpirePinnedAnnouncementsArgs{},
	} {
		withOpts, ok := args.(river.JobArgsWithInsertOpts)
		if !ok {
			t.Fatalf("%s does not declare insert options", args.Kind())
		}
		opts := withOpts.InsertOpts()
		if opts.Queue != QueueName {
			t.Fatalf("%s queue = %q, want %q", args.Kind(), opts.Queue, QueueName)
		}
		if opts.MaxAttempts != 1 {
			t.Fatalf("%s max attempts = %d, want 1", args.Kind(), opts.MaxAttempts)
		}
		if !slices.Equal(opts.UniqueOpts.ByState, inFlight) {
			t.Fatalf("%s unique states = %v, want %v", args.Kind(), opts.UniqueOpts.ByState, inFlight)
		}
	}
}

// They are long and rare next to an outbox job, so they run on a queue of their
// own rather than holding workers the drain is sized for.
func TestJobsRunOnTheirOwnQueue(t *testing.T) {
	jobs, err := New(Config{DB: &sql.DB{}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	queues := jobs.Queues()
	if len(queues) != 1 {
		t.Fatalf("queues = %v, want exactly one", queues)
	}
	queue, ok := queues[QueueName]
	if !ok {
		t.Fatalf("queues = %v, want one named %q", queues, QueueName)
	}
	if queue.MaxWorkers != 4 {
		t.Fatalf("%s max workers = %d, want 4", QueueName, queue.MaxWorkers)
	}
	if _, ok := queues[river.QueueDefault]; ok {
		t.Fatalf("queues = %v, want the default queue left to the outbox drain", queues)
	}
}

func TestServiceNamesCoverEveryJob(t *testing.T) {
	want := []string{
		"publira-publish-episodes",
		"publira-apply-free-windows",
		"publira-roll-tenant-day",
		"publira-expire-pinned-announcements",
	}
	if got := ServiceNames(); !slices.Equal(got, want) {
		t.Fatalf("ServiceNames() = %v, want %v", got, want)
	}
}
