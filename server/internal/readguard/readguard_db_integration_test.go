package readguard

import (
	"context"
	"log/slog"
	"testing"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/testutil"
)

// The read limits are the ones saved as the platform's policy, through the
// save publiractl policy set makes, and read the way every running server
// reads it: two instances over the counters they share charge a client against
// what was saved, and against a raised value once it is saved.
func TestDBInstancesChargeTheSavedReadLimits(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	savePolicy := func(search int) {
		t.Helper()
		policy := platformpolicy.Defaults()
		policy.AnonymousReads.Search = search
		if _, err := platformpolicy.Save(context.Background(), pg.DB, slog.Default(), auditlog.SystemPlatformActor, platformpolicy.SaveParams{Policy: policy}, revalidate.RecordCatalogDrop); err != nil {
			t.Fatalf("save the platform policy: %v", err)
		}
	}
	shared := ratelimit.NewMemoryStoreWithClock(fixedClock)
	instance := func() *Guard {
		return New(ratelimit.NewWithClock(shared, fixedClock), platformpolicy.NewResolver(dbmodels.New(pg.DB), 0, slog.Default()))
	}
	first, second := instance(), instance()
	reader := requestFrom(t, "203.0.113.10")

	saved := 2 * platformpolicy.EdgeReadLimits().Search
	savePolicy(saved)
	for i := range saved {
		guard := first
		if i%2 == 1 {
			guard = second
		}
		if !allow(t, guard, reader, Search).Allowed {
			t.Fatalf("search %d of the saved %d refused, want the whole allowance served", i+1, saved)
		}
	}
	if allow(t, first, reader, Search).Allowed || allow(t, second, reader, Search).Allowed {
		t.Fatalf("search past the saved %d allowed, want it refused on both instances", saved)
	}

	// The refused reads were counted as well, so the raised limit has to
	// clear them too.
	savePolicy(saved + 10)
	if !allow(t, second, reader, Search).Allowed {
		t.Fatal("search after the limit was raised refused, want the raised limit charged")
	}
}
