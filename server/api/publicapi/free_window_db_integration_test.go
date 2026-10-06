package publicapi

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/freewindows"
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

// seriesDetailFreeUntil is the free_until each episode of a series detail
// carries, by public ID.
func seriesDetailFreeUntil(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, seriesPublicID string) map[string]string {
	t.Helper()

	resp, err := env.catalogClient().GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: seriesPublicID,
	}))
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	freeUntil := make(map[string]string, len(resp.Msg.Episodes))
	for _, episode := range resp.Msg.Episodes {
		freeUntil[episode.PublicId] = episode.FreeUntil
	}
	return freeUntil
}

// The series detail's episode list is what the storefront's episode rows and
// the top page's new-episode rows are drawn from, so each row carries the end of
// its own window and nothing for the rows around it.
func TestDBGetSeriesDetailCarriesTheEndOfEachEpisodesOpenFreeWindow(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	newEpisode := func(publicID, title string, price int32) testutil.Episode {
		return env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: publicID, Title: title, Status: testutil.EpisodeStatusPublished, Price: price})
	}

	now := time.Now()
	open := newEpisode("EPISODEWIN01", "Free This Week", 500)
	endsAt := tenantMidnight(t, tenant, now, 1)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, open.ID, tenantMidnight(t, tenant, now, 0), endsAt)

	over := newEpisode("EPISODEOVR01", "Was Free Yesterday", 500)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, over.ID, tenantMidnight(t, tenant, now, -1), tenantMidnight(t, tenant, now, 0))

	upcoming := newEpisode("EPISODEUPC01", "Free Tomorrow", 500)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, upcoming.ID, tenantMidnight(t, tenant, now, 1), tenantMidnight(t, tenant, now, 2))

	paid := newEpisode("EPISODEPAY01", "Never Free", 500)
	free := newEpisode("EPISODEFRE01", "Always Free", 0)

	// A window on an episode that costs nothing ends nothing: the episode is
	// still free after it, so there is no instant to count down to.
	freeInWindow := newEpisode("EPISODEFRE02", "Always Free Anyway", 0)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, freeInWindow.ID, tenantMidnight(t, tenant, now, 0), endsAt)

	got := seriesDetailFreeUntil(t, env, tenant, series.PublicID)
	want := map[string]string{
		open.PublicID:         endsAt.UTC().Format(time.RFC3339),
		over.PublicID:         "",
		upcoming.PublicID:     "",
		paid.PublicID:         "",
		free.PublicID:         "",
		freeInWindow.PublicID: "",
	}
	if len(got) != len(want) {
		t.Fatalf("series detail episodes = %v, want %d", got, len(want))
	}
	for publicID, wantFreeUntil := range want {
		if got[publicID] != wantFreeUntil {
			t.Errorf("%s free_until = %q, want %q", publicID, got[publicID], wantFreeUntil)
		}
	}

	// The row and the episode it links to answer the same instant, so a row
	// counting down does not disagree with the page it opens.
	detail, err := env.catalogClient().GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: open.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if detail.Msg.Episode.FreeUntil != got[open.PublicID] || detail.Msg.FreeUntil != got[open.PublicID] {
		t.Fatalf("episode detail free_until = (episode %q, response %q), want the row's %q",
			detail.Msg.Episode.FreeUntil, detail.Msg.FreeUntil, got[open.PublicID])
	}

	freeDetail, err := env.catalogClient().GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: freeInWindow.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail %s: %v", freeInWindow.PublicID, err)
	}
	if freeDetail.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_FREE {
		t.Fatalf("%s access = %v, want free", freeInWindow.PublicID, freeDetail.Msg.Access)
	}
	if freeDetail.Msg.Episode.FreeUntil != "" || freeDetail.Msg.FreeUntil != "" {
		t.Fatalf("%s free_until = (episode %q, response %q), want both empty",
			freeInWindow.PublicID, freeDetail.Msg.Episode.FreeUntil, freeDetail.Msg.FreeUntil)
	}
}

// Nothing in the database changes when a window opens or closes, so a series
// detail the storefront cached before a boundary keeps the row's old
// free_until until something drops the tag it is cached under. This walks one
// window through both of its boundaries and checks, at each, that the read has
// moved to the new side and that apply-free-windows records the drop of
// `tenant:<id>:series:detail`, the tag the storefront caches GetSeriesDetail
// under. The boundaries are passed by moving the stored period behind NOW()
// rather than by waiting for the clock.
func TestDBSeriesDetailFreeUntilFollowsAWindowAcrossBothBoundaries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEWIN01",
		Title:    "Free For A While",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})

	now := time.Now().UTC().Truncate(time.Second)
	endsAt := now.Add(2 * time.Hour)
	windowID := env.PG.SeedEpisodeFreeWindow(t, tenant.ID, episode.ID, now.Add(time.Hour), endsAt)

	reval := &recordingRevalidator{}
	runner := freewindows.New(dbmodels.New(env.PG.DB), reval, slog.New(slog.NewTextHandler(io.Discard, nil)))
	wantTag := fmt.Sprintf("tenant:%s:series:detail", tenant.ID)
	movePeriod := func(startsAt, endsAt time.Time) {
		t.Helper()
		if _, err := env.PG.DB.ExecContext(context.Background(),
			"UPDATE episode_free_windows SET starts_at = $2, ends_at = $3 WHERE id = $1",
			windowID, startsAt, endsAt,
		); err != nil {
			t.Fatalf("move free window: %v", err)
		}
	}
	step := func(name, wantFreeUntil string, wantDrop bool) {
		t.Helper()
		if got := seriesDetailFreeUntil(t, env, tenant, series.PublicID)[episode.PublicID]; got != wantFreeUntil {
			t.Fatalf("%s: free_until = %q, want %q", name, got, wantFreeUntil)
		}
		reval.tags = nil
		runner.RunOnce(context.Background())
		dropped := slices.Contains(reval.tags, wantTag)
		if dropped != wantDrop {
			t.Fatalf("%s: dropped %s = %v, want %v (recorded %v)", name, wantTag, dropped, wantDrop, reval.tags)
		}
	}

	step("before the window", "", false)

	movePeriod(now.Add(-time.Hour), endsAt)
	step("inside the window", endsAt.Format(time.RFC3339), true)

	movePeriod(now.Add(-2*time.Hour), now.Add(-time.Minute))
	step("after the window", "", true)
}

// The storefront caches ListPublishedSeries under `tenant:<id>:series:list`,
// not under the series detail tag, so a window crossing a boundary has to drop
// that tag too: otherwise a series whose episodes are otherwise all paid stays
// out of the "Free to read" module after its window opens, and stays in it with
// a free-episode count it no longer has after the window closes. This walks one
// window through both boundaries and checks, at each, that the list has moved
// to the new side and that apply-free-windows records the drop of the list tag.
func TestDBListedFreeEpisodesFollowAWindowAcrossBothBoundaries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series, episodes := seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true},
		testutil.EpisodeSeed{PublicID: "EPISODEWIN01", Title: "Free For A While", Status: testutil.EpisodeStatusPublished, Price: 500},
	)

	now := time.Now().UTC().Truncate(time.Second)
	endsAt := now.Add(2 * time.Hour)
	windowID := env.PG.SeedEpisodeFreeWindow(t, tenant.ID, episodes[0].ID, now.Add(time.Hour), endsAt)

	reval := &recordingRevalidator{}
	runner := freewindows.New(dbmodels.New(env.PG.DB), reval, slog.New(slog.NewTextHandler(io.Discard, nil)))
	wantTag := fmt.Sprintf("tenant:%s:series:list", tenant.ID)
	movePeriod := func(startsAt, endsAt time.Time) {
		t.Helper()
		if _, err := env.PG.DB.ExecContext(context.Background(),
			"UPDATE episode_free_windows SET starts_at = $2, ends_at = $3 WHERE id = $1",
			windowID, startsAt, endsAt,
		); err != nil {
			t.Fatalf("move free window: %v", err)
		}
	}
	listedAsFree := func() bool {
		t.Helper()
		resp, err := env.catalogClient().ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
			Tenant:          tenantContext(tenant),
			HasFreeEpisodes: true,
		}))
		if err != nil {
			t.Fatalf("ListPublishedSeries with the filter: %v", err)
		}
		return slices.Contains(seriesPublicIDs(resp.Msg.Series), series.PublicID)
	}
	step := func(name string, wantCount int32, wantDrop bool) {
		t.Helper()
		if got := freeEpisodeCountOfListedSeries(t, env, tenant, series.PublicID); got != wantCount {
			t.Fatalf("%s: free_episode_count = %d, want %d", name, got, wantCount)
		}
		if got := listedAsFree(); got != (wantCount > 0) {
			t.Fatalf("%s: listed under has_free_episodes = %v, want %v", name, got, wantCount > 0)
		}
		reval.tags = nil
		runner.RunOnce(context.Background())
		dropped := slices.Contains(reval.tags, wantTag)
		if dropped != wantDrop {
			t.Fatalf("%s: dropped %s = %v, want %v (recorded %v)", name, wantTag, dropped, wantDrop, reval.tags)
		}
	}

	step("before the window", 0, false)

	movePeriod(now.Add(-time.Hour), endsAt)
	step("inside the window", 1, true)

	movePeriod(now.Add(-2*time.Hour), now.Add(-time.Minute))
	step("after the window", 0, true)
}

type recordingRevalidator struct {
	tags []string
}

func (r *recordingRevalidator) RevalidateTags(_ context.Context, _ uuid.UUID, tags []string) error {
	r.tags = append(r.tags, tags...)
	return nil
}

// The "continue reading" offers name a priced episode the reader may be about
// to open, so they carry the end of its window the way a catalog row does.
func TestDBReadingProgressCarriesTheEndOfAnOpenFreeWindow(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERWIN01", "member-window@example.com", "Member", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEWIN01",
		Title:    "Free This Week",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	}, 10)

	now := time.Now()
	endsAt := tenantMidnight(t, tenant, now, 1)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, episode.ID, tenantMidnight(t, tenant, now, 0), endsAt)
	want := endsAt.UTC().Format(time.RFC3339)

	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)
	if _, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, episode.ID.String(), 3, token)); err != nil {
		t.Fatalf("SaveReadingPosition: %v", err)
	}

	progress, err := client.GetMySeriesProgress(context.Background(), seriesProgressRequest(tenant, series.ID.String(), token))
	if err != nil {
		t.Fatalf("GetMySeriesProgress: %v", err)
	}
	if progress.Msg.Progress == nil {
		t.Fatal("progress = none, want the episode the reader is in")
	}
	if got := progress.Msg.Progress.Episode.FreeUntil; got != want {
		t.Errorf("GetMySeriesProgress free_until = %q, want %q", got, want)
	}

	recent, err := client.ListMyRecentSeries(context.Background(), recentSeriesRequest(tenant, token, 10, ""))
	if err != nil {
		t.Fatalf("ListMyRecentSeries: %v", err)
	}
	if len(recent.Msg.Series) != 1 {
		t.Fatalf("recent series = %v, want the one being read", recentSeriesPublicIDs(recent.Msg.Series))
	}
	if got := recent.Msg.Series[0].Episode.FreeUntil; got != want {
		t.Errorf("ListMyRecentSeries free_until = %q, want %q", got, want)
	}
}
