package tickerjobs

import (
	"database/sql"
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
		DB:                 &sql.DB{},
		PublishInterval:    5 * time.Second,
		FreeWindowInterval: 7 * time.Second,
		TenantDayInterval:  11 * time.Second,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	periodic := jobs.PeriodicJobs()
	if len(periodic) != 3 {
		t.Fatalf("periodic jobs = %d, want 3", len(periodic))
	}
}

func TestPeriodicJobsFallBackToTheDefaultIntervals(t *testing.T) {
	jobs, err := New(Config{DB: &sql.DB{}})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	settings := jobs.Settings()
	for _, want := range []struct {
		key   string
		value any
	}{
		{key: "publish_interval", value: DefaultPublishInterval},
		{key: "free_window_interval", value: DefaultFreeWindowInterval},
		{key: "tenant_day_interval", value: DefaultTenantDayInterval},
	} {
		index := slices.Index(settings, any(want.key))
		if index < 0 || index+1 >= len(settings) {
			t.Fatalf("settings = %v, want a %q entry", settings, want.key)
		}
		if settings[index+1] != want.value {
			t.Fatalf("%s = %v, want %v", want.key, settings[index+1], want.value)
		}
	}
}

// Every one of the three spans every tenant, so two runs of the same job at
// once would write the same rows twice. The unique states are what stop a
// second worker's copy and a pass that outlasts its own interval alike.
func TestEveryJobIsUniqueWhileOneIsInFlight(t *testing.T) {
	inFlight := []rivertype.JobState{
		rivertype.JobStateAvailable,
		rivertype.JobStatePending,
		rivertype.JobStateRunning,
		rivertype.JobStateRetryable,
		rivertype.JobStateScheduled,
	}

	for _, args := range []river.JobArgs{PublishEpisodesArgs{}, ApplyFreeWindowsArgs{}, RollTenantDayArgs{}} {
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

// The three are long and rare next to an outbox job, so they run on a queue of
// their own rather than holding workers the drain is sized for.
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
	if queue.MaxWorkers != 3 {
		t.Fatalf("%s max workers = %d, want 3", QueueName, queue.MaxWorkers)
	}
	if _, ok := queues[river.QueueDefault]; ok {
		t.Fatalf("queues = %v, want the default queue left to the outbox drain", queues)
	}
}

func TestServiceNamesCoverEveryJob(t *testing.T) {
	want := []string{"publira-publish-episodes", "publira-apply-free-windows", "publira-roll-tenant-day"}
	if got := ServiceNames(); !slices.Equal(got, want) {
		t.Fatalf("ServiceNames() = %v, want %v", got, want)
	}
}
