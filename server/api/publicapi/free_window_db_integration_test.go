package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A free window is decided by the database comparing NOW() against the stored
// period, so only a real PostgreSQL shows that an episode changes sides at the
// instant it should. The periods below are stated as the tenant's own midnight
// — the boundary an editor picks — and reach the queries as the absolute
// instants that wall clock names.

// tenantMidnight is the tenant's local midnight, dayOffset days from the day
// `now` falls on. Offset 0 is the midnight that started that day, 1 the one
// that ends it.
//
// Every boundary of one test is derived from a single `now`. Reading the clock
// per call would let a run that crosses the tenant's midnight between two calls
// build a period the test did not mean — an empty one, or one that is open when
// it should be over.
func tenantMidnight(t *testing.T, tenant testutil.Tenant, now time.Time, dayOffset int) time.Time {
	t.Helper()

	location, err := time.LoadLocation(tenant.TimeZone)
	if err != nil {
		t.Fatalf("load tenant time zone %q: %v", tenant.TimeZone, err)
	}
	local := now.In(location)
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	return midnight.AddDate(0, 0, dayOffset)
}

func TestDBGetEpisodeDetailOpensAPaidEpisodeInsideItsFreeWindow(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEWIN01",
		Title:    "Free This Week",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)

	client := env.catalogClient()
	request := func() *publirav1.GetEpisodeDetailRequest {
		return &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID}
	}

	before, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(request()))
	if err != nil {
		t.Fatalf("GetEpisodeDetail before the window: %v", err)
	}
	if before.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("access without a window = %v, want locked", before.Msg.Access)
	}
	if before.Msg.FreeUntil != "" {
		t.Fatalf("free_until without a window = %q, want empty", before.Msg.FreeUntil)
	}

	// "Free until the end of today", as the tenant's own calendar states it.
	now := time.Now()
	endsAt := tenantMidnight(t, tenant, now, 1)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, episode.ID, tenantMidnight(t, tenant, now, 0), endsAt)

	inside, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(request()))
	if err != nil {
		t.Fatalf("GetEpisodeDetail inside the window: %v", err)
	}
	if inside.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_FREE {
		t.Fatalf("access inside the window = %v, want free", inside.Msg.Access)
	}
	if len(inside.Msg.Images) != 1 {
		t.Fatalf("images inside the window = %d, want the page the window opens", len(inside.Msg.Images))
	}
	if want := endsAt.UTC().Format(time.RFC3339); inside.Msg.FreeUntil != want {
		t.Fatalf("free_until = %q, want the window end %q", inside.Msg.FreeUntil, want)
	}
}

func TestDBGetEpisodeDetailLocksAPaidEpisodeOutsideItsFreeWindow(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})

	// One episode whose window closed at the midnight that started the tenant's
	// day, and one whose window opens at the midnight that ends it. Both are
	// outside their period right now, from either side of it.
	now := time.Now()
	over := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEOVR01",
		Title:    "Was Free Yesterday",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, over.ID, 1)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, over.ID, tenantMidnight(t, tenant, now, -1), tenantMidnight(t, tenant, now, 0))

	upcoming := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEUPC01",
		Title:    "Free Tomorrow",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, upcoming.ID, 1)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, upcoming.ID, tenantMidnight(t, tenant, now, 1), tenantMidnight(t, tenant, now, 2))

	client := env.catalogClient()
	for _, publicID := range []string{over.PublicID, upcoming.PublicID} {
		resp, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: publicID,
		}))
		if err != nil {
			t.Fatalf("GetEpisodeDetail %s: %v", publicID, err)
		}
		if resp.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
			t.Errorf("%s access = %v, want locked", publicID, resp.Msg.Access)
		}
		if len(resp.Msg.Images) != 0 {
			t.Errorf("%s images = %d, want none", publicID, len(resp.Msg.Images))
		}
		if resp.Msg.FreeUntil != "" {
			t.Errorf("%s free_until = %q, want empty", publicID, resp.Msg.FreeUntil)
		}
	}
}

// A free episode is not "free until" anything: the window field stays empty so a
// client does not render a countdown on a body that never expires.
func TestDBGetEpisodeDetailLeavesFreeUntilEmptyForAFreeEpisode(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Free Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEFRE01",
		Title:    "Always Free",
		Status:   testutil.EpisodeStatusPublished,
		Price:    0,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)

	resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if resp.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_FREE {
		t.Fatalf("access = %v, want free", resp.Msg.Access)
	}
	if resp.Msg.FreeUntil != "" {
		t.Fatalf("free_until = %q, want empty", resp.Msg.FreeUntil)
	}
}
