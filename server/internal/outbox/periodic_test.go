package outbox

import (
	"strings"
	"testing"
	"time"

	"github.com/riverqueue/river"
)

// The process hosts more than one set of periodic jobs, and each brings its own
// queue. Merging them is what lets them share the one River client the outbox
// drain already owns.
func TestRegisterPeriodicMergesEverySetsQueues(t *testing.T) {
	workers := river.NewWorkers()
	queues := map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 8}}

	scheduled, err := registerPeriodic(workers, queues, []PeriodicRegistrar{
		fakeRegistrar{queue: "ticker", maxWorkers: 4, scheduled: 2},
		nil,
		fakeRegistrar{queue: "maintenance", maxWorkers: 2, scheduled: 1},
	})
	if err != nil {
		t.Fatalf("registerPeriodic: %v", err)
	}
	if len(scheduled) != 3 {
		t.Fatalf("periodic jobs = %d, want 3", len(scheduled))
	}
	if got := queues["ticker"].MaxWorkers; got != 4 {
		t.Fatalf("ticker max workers = %d, want 4", got)
	}
	if got := queues["maintenance"].MaxWorkers; got != 2 {
		t.Fatalf("maintenance max workers = %d, want 2", got)
	}
	if got := queues[river.QueueDefault].MaxWorkers; got != 8 {
		t.Fatalf("default max workers = %d, want the drain's own 8", got)
	}
}

// The drain sizes the default queue, and a job long enough to want a queue of
// its own is one that must not hold a worker the drain is counting on.
func TestRegisterPeriodicRefusesTheDefaultQueue(t *testing.T) {
	err := registerPeriodicError(t, []PeriodicRegistrar{
		fakeRegistrar{queue: river.QueueDefault, maxWorkers: 1},
	})
	if !strings.Contains(err.Error(), "may not resize") {
		t.Fatalf("error = %v, want the default queue refused", err)
	}
}

// Merging two sets onto one queue name would leave one of them running at the
// concurrency the other chose, with nothing said about it.
func TestRegisterPeriodicRefusesTwoSetsOnOneQueue(t *testing.T) {
	err := registerPeriodicError(t, []PeriodicRegistrar{
		fakeRegistrar{queue: "shared", maxWorkers: 4},
		fakeRegistrar{queue: "shared", maxWorkers: 1},
	})
	if !strings.Contains(err.Error(), `"shared"`) {
		t.Fatalf("error = %v, want the contested queue named", err)
	}
}

func registerPeriodicError(t *testing.T, registrars []PeriodicRegistrar) error {
	t.Helper()
	_, err := registerPeriodic(river.NewWorkers(), map[string]river.QueueConfig{
		river.QueueDefault: {MaxWorkers: 8},
	}, registrars)
	if err == nil {
		t.Fatal("error = nil, want a refusal")
	}
	return err
}

// fakeRegistrar stands in for a set of periodic jobs. Registration of the
// workers themselves is each set's own test; what is asserted here is how their
// queues and schedules are merged.
type fakeRegistrar struct {
	queue      string
	maxWorkers int
	scheduled  int
}

func (fakeRegistrar) Register(*river.Workers) error { return nil }

func (r fakeRegistrar) PeriodicJobs() []*river.PeriodicJob {
	jobs := make([]*river.PeriodicJob, 0, r.scheduled)
	for range r.scheduled {
		jobs = append(jobs, river.NewPeriodicJob(
			river.PeriodicInterval(time.Minute),
			func() (river.JobArgs, *river.InsertOpts) { return DrainArgs{}, nil },
			nil,
		))
	}
	return jobs
}

func (r fakeRegistrar) Queues() map[string]river.QueueConfig {
	return map[string]river.QueueConfig{r.queue: {MaxWorkers: r.maxWorkers}}
}
