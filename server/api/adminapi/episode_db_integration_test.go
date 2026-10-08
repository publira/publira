package adminapi

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// createDBSeries creates one series for the tenant and returns its public ID.
func createDBSeries(
	t *testing.T,
	client publiraadminv1connect.AdminSeriesServiceClient,
	tenant adminDBTenant,
	title string,
) string {
	t.Helper()

	resp, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant: tenant.tenantContext(),
		Title:  title,
	})
	if err != nil {
		t.Fatalf("CreateSeries %q: %v", title, err)
	}
	return resp.Series.PublicId
}

func TestDBCreateEpisodesAppendInOrder(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Episode Host Series")

	// order_index 0 means "append", which is resolved against the rows already
	// in the database rather than against anything the client sends.
	for index, title := range []string{"Episode One", "Episode Two", "Episode Three"} {
		resp, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
			Tenant:   tenant.tenantContext(),
			SeriesId: env.seriesID(t, seriesPublicID),
			Title:    title,
			Price:    int32(100 * (index + 1)),
		})
		if err != nil {
			t.Fatalf("CreateEpisode %s: %v", title, err)
		}
		if got, want := resp.Episode.OrderIndex, int32(index+1); got != want {
			t.Fatalf("%s order_index = %d, want %d", title, got, want)
		}
		if resp.Episode.Status != "draft" {
			t.Fatalf("%s status = %q, want draft", title, resp.Episode.Status)
		}
	}

	listed, err := client.ListEpisodes(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodesRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
	})
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	titles := make([]string, 0, len(listed.Episodes))
	for _, episode := range listed.Episodes {
		titles = append(titles, episode.Title)
	}
	if len(titles) != 3 || titles[0] != "Episode One" || titles[2] != "Episode Three" {
		t.Fatalf("ListEpisodes titles = %v, want the three episodes in creation order", titles)
	}
}

func TestDBCreateEpisodeConcurrentAppendsDistinctOrderIndexes(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Concurrent Host Series")

	const n = 8
	indexes := make(chan int32, n)
	errs := make(chan error, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			resp, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
				Tenant:   tenant.tenantContext(),
				SeriesId: env.seriesID(t, seriesPublicID),
				Title:    fmt.Sprintf("Concurrent %d", i),
			})
			if err != nil {
				errs <- err
				return
			}
			indexes <- resp.Episode.OrderIndex
		}(i)
	}
	wg.Wait()
	close(indexes)
	close(errs)

	for err := range errs {
		t.Fatalf("CreateEpisode: %v", err)
	}

	seen := make(map[int32]struct{}, n)
	for index := range indexes {
		if _, exists := seen[index]; exists {
			t.Fatalf("duplicate order_index %d", index)
		}
		seen[index] = struct{}{}
	}
	if len(seen) != n {
		t.Fatalf("got %d distinct order_index values, want %d", len(seen), n)
	}
	for want := int32(1); want <= n; want++ {
		if _, ok := seen[want]; !ok {
			t.Fatalf("missing order_index %d in %v", want, seen)
		}
	}

	listed, err := client.ListEpisodes(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodesRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
	})
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if len(listed.Episodes) != n {
		t.Fatalf("ListEpisodes count = %d, want %d (every create must also write episode_listings)", len(listed.Episodes), n)
	}
}

func TestDBReorderEpisodesPersistsNewOrder(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Reorder Host Series")

	created := make([]string, 0, 3)
	for _, title := range []string{"First", "Second", "Third"} {
		resp, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
			Tenant:   tenant.tenantContext(),
			SeriesId: env.seriesID(t, seriesPublicID),
			Title:    title,
		})
		if err != nil {
			t.Fatalf("CreateEpisode %s: %v", title, err)
		}
		created = append(created, resp.Episode.PublicId)
	}

	reversed := []string{created[2], created[1], created[0]}
	reordered, err := client.ReorderEpisodes(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ReorderEpisodesRequest{
		Tenant:             tenant.tenantContext(),
		SeriesId:           env.seriesID(t, seriesPublicID),
		EpisodeIds:         env.episodeIDs(t, reversed),
		ExpectedEpisodeIds: env.episodeIDs(t, created),
	})
	if err != nil {
		t.Fatalf("ReorderEpisodes: %v", err)
	}
	if got := episodePublicIDs(reordered.Episodes); !slices.Equal(got, reversed) {
		t.Fatalf("ReorderEpisodes = %v, want %v", got, reversed)
	}

	listed, err := client.ListEpisodes(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodesRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
	})
	if err != nil {
		t.Fatalf("ListEpisodes after reorder: %v", err)
	}
	if got := episodePublicIDs(listed.Episodes); !slices.Equal(got, reversed) {
		t.Fatalf("reloaded order = %v, want %v", got, reversed)
	}
}

func TestDBReorderEpisodesRejectsStaleExpectedOrder(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Stale Reorder Host Series")

	created := make([]string, 0, 3)
	for _, title := range []string{"First", "Second", "Third"} {
		resp, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
			Tenant:   tenant.tenantContext(),
			SeriesId: env.seriesID(t, seriesPublicID),
			Title:    title,
		})
		if err != nil {
			t.Fatalf("CreateEpisode %s: %v", title, err)
		}
		created = append(created, resp.Episode.PublicId)
	}

	reversed := []string{created[2], created[1], created[0]}
	if _, err := client.ReorderEpisodes(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ReorderEpisodesRequest{
		Tenant:             tenant.tenantContext(),
		SeriesId:           env.seriesID(t, seriesPublicID),
		EpisodeIds:         env.episodeIDs(t, reversed),
		ExpectedEpisodeIds: env.episodeIDs(t, created),
	}); err != nil {
		t.Fatalf("first ReorderEpisodes: %v", err)
	}

	_, err := client.ReorderEpisodes(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ReorderEpisodesRequest{
		Tenant:             tenant.tenantContext(),
		SeriesId:           env.seriesID(t, seriesPublicID),
		EpisodeIds:         []string{env.episodeID(t, created[1]), env.episodeID(t, created[0]), env.episodeID(t, created[2])},
		ExpectedEpisodeIds: env.episodeIDs(t, created),
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("stale ReorderEpisodes code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeFailedPrecondition, err)
	}

	listed, err := client.ListEpisodes(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodesRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
	})
	if err != nil {
		t.Fatalf("ListEpisodes after rejected reorder: %v", err)
	}
	if got := episodePublicIDs(listed.Episodes); !slices.Equal(got, reversed) {
		t.Fatalf("order after rejected reorder = %v, want %v (the first write must stand)", got, reversed)
	}
}

func TestDBReorderEpisodesConcurrentSameExpectedOneWins(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Concurrent Reorder Host Series")

	created := make([]string, 0, 3)
	for _, title := range []string{"First", "Second", "Third"} {
		resp, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
			Tenant:   tenant.tenantContext(),
			SeriesId: env.seriesID(t, seriesPublicID),
			Title:    title,
		})
		if err != nil {
			t.Fatalf("CreateEpisode %s: %v", title, err)
		}
		created = append(created, resp.Episode.PublicId)
	}

	candidates := [][]string{
		{created[2], created[1], created[0]},
		{created[1], created[0], created[2]},
	}
	type outcome struct {
		order []string
		err   error
	}
	outcomes := make(chan outcome, len(candidates))
	var wg sync.WaitGroup
	for _, next := range candidates {
		wg.Add(1)
		go func(next []string) {
			defer wg.Done()
			resp, err := client.ReorderEpisodes(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ReorderEpisodesRequest{
				Tenant:             tenant.tenantContext(),
				SeriesId:           env.seriesID(t, seriesPublicID),
				EpisodeIds:         env.episodeIDs(t, next),
				ExpectedEpisodeIds: env.episodeIDs(t, created),
			})
			if err != nil {
				outcomes <- outcome{err: err}
				return
			}
			outcomes <- outcome{order: episodePublicIDs(resp.Episodes)}
		}(next)
	}
	wg.Wait()
	close(outcomes)

	var winner []string
	failures := 0
	for result := range outcomes {
		if result.err == nil {
			if winner != nil {
				t.Fatalf("both reorders succeeded (%v and %v)", winner, result.order)
			}
			winner = result.order
			continue
		}
		if connect.CodeOf(result.err) != connect.CodeFailedPrecondition {
			t.Fatalf("losing ReorderEpisodes code = %v, want %v (err=%v)", connect.CodeOf(result.err), connect.CodeFailedPrecondition, result.err)
		}
		failures++
	}
	if winner == nil {
		t.Fatal("both reorders failed, want exactly one to apply")
	}
	if failures != 1 {
		t.Fatalf("FailedPrecondition count = %d, want 1", failures)
	}

	listed, err := client.ListEpisodes(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodesRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
	})
	if err != nil {
		t.Fatalf("ListEpisodes after concurrent reorder: %v", err)
	}
	if got := episodePublicIDs(listed.Episodes); !slices.Equal(got, winner) {
		t.Fatalf("reloaded order = %v, want the winning write %v", got, winner)
	}
}

func TestDBCreateEpisodeInAnotherTenantsSeriesReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()
	theirSeries := createDBSeries(t, client, second, "Tenant B Series")

	_, err := client.CreateEpisode(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:   first.tenantContext(),
		SeriesId: env.seriesID(t, theirSeries),
		Title:    "Smuggled Episode",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("CreateEpisode across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM episodes"); count != 0 {
		t.Fatalf("episode rows = %d, want 0", count)
	}
}

func TestDBListEpisodesOfAnotherTenantsSeriesIsEmpty(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	created, err := client.CreateSeries(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant: second.tenantContext(),
		Title:  "Tenant B Series",
	})
	if err != nil {
		t.Fatalf("CreateSeries for tenant B: %v", err)
	}
	theirSeries := created.Series.Id
	if _, err := client.CreateEpisode(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:   second.tenantContext(),
		SeriesId: theirSeries,
		Title:    "Tenant B Episode",
	}); err != nil {
		t.Fatalf("CreateEpisode for tenant B: %v", err)
	}

	listed, err := client.ListEpisodes(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.ListEpisodesRequest{
		Tenant:   first.tenantContext(),
		SeriesId: theirSeries,
	})
	if err != nil {
		t.Fatalf("ListEpisodes across tenants: %v", err)
	}
	if len(listed.Episodes) != 0 {
		t.Fatalf("tenant A sees %v, want no episodes of tenant B", episodePublicIDs(listed.Episodes))
	}
}

func TestDBUpdateEpisodePublishScheduleRejectsPastTime(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Schedule Host Series")

	created, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
		Title:    "Scheduled Episode",
	})
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}

	_, err = client.UpdateEpisodePublishSchedule(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant:      tenant.tenantContext(),
		EpisodeId:   created.Episode.Id,
		ScheduledAt: "2000-01-01T00:00:00Z",
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateEpisodePublishSchedule code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	if count := env.countRows(t,
		"SELECT count(*) FROM episode_listings WHERE status = $1", "scheduled",
	); count != 0 {
		t.Fatalf("scheduled listings = %d, want 0", count)
	}
}

// A publication time that has already passed publishes the episode in the
// write that creates it, as the console's tenant role, and leaves the
// followers' notice to the worker.
func TestDBCreateEpisodeWithPastScheduledAtPublishesIt(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Publish Now Host Series")

	created, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:      tenant.tenantContext(),
		SeriesId:    env.seriesID(t, seriesPublicID),
		Title:       "Published Episode",
		ScheduledAt: "2000-01-01T00:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	if created.Episode.Status != "published" || created.Episode.PublishedAt == "" {
		t.Fatalf("status, published_at = %q, %q, want published and a time", created.Episode.Status, created.Episode.PublishedAt)
	}

	if count := env.countRows(t,
		"SELECT count(*) FROM episode_listings WHERE status = 'published' AND published_at IS NOT NULL AND scheduled_at = '2000-01-01T00:00:00Z'",
	); count != 1 {
		t.Fatalf("published listings = %d, want 1", count)
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM outbox_events WHERE event_type = $1 AND idempotency_key = $2",
		outbox.EventTypeEpisodePublishedNotification, outbox.EpisodePublishedIdempotencyKey(uuid.MustParse(created.Episode.Id)),
	); count != 1 {
		t.Fatalf("episode published notification events = %d, want 1", count)
	}
}

func TestDBGetEpisodeReturnsDraftAndScheduled(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "GetEpisode Host Series")

	draft, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
		Title:    "Draft Episode",
	})
	if err != nil {
		t.Fatalf("CreateEpisode draft: %v", err)
	}

	gotDraft, err := client.GetEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		PublicId:       draft.Episode.PublicId,
	})
	if err != nil {
		t.Fatalf("GetEpisode draft: %v", err)
	}
	if gotDraft.Episode.Status != "draft" {
		t.Fatalf("draft status = %q, want draft", gotDraft.Episode.Status)
	}
	if gotDraft.Episode.ScheduledAt != "" {
		t.Fatalf("draft scheduled_at = %q, want empty", gotDraft.Episode.ScheduledAt)
	}

	scheduledAt := "2030-01-01T01:00:00Z"
	scheduled, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:      tenant.tenantContext(),
		SeriesId:    env.seriesID(t, seriesPublicID),
		Title:       "Scheduled Episode",
		ScheduledAt: scheduledAt,
	})
	if err != nil {
		t.Fatalf("CreateEpisode scheduled: %v", err)
	}

	gotScheduled, err := client.GetEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		PublicId:       scheduled.Episode.PublicId,
	})
	if err != nil {
		t.Fatalf("GetEpisode scheduled: %v", err)
	}
	if gotScheduled.Episode.Status != "scheduled" {
		t.Fatalf("scheduled status = %q, want scheduled", gotScheduled.Episode.Status)
	}
	if gotScheduled.Episode.ScheduledAt != scheduledAt {
		t.Fatalf("scheduled_at = %q, want %q", gotScheduled.Episode.ScheduledAt, scheduledAt)
	}
}

func TestDBGetEpisodeTenantBoundary(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	theirSeries := createDBSeries(t, client, second, "Tenant B Series")
	theirs, err := client.CreateEpisode(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:   second.tenantContext(),
		SeriesId: env.seriesID(t, theirSeries),
		Title:    "Tenant B Episode",
	})
	if err != nil {
		t.Fatalf("CreateEpisode for tenant B: %v", err)
	}

	_, err = client.GetEpisode(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.GetEpisodeRequest{
		Tenant:         first.tenantContext(),
		SeriesPublicId: theirSeries,
		PublicId:       theirs.Episode.PublicId,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetEpisode across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	mineSeries := createDBSeries(t, client, first, "Tenant A Series")
	_, err = client.GetEpisode(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.GetEpisodeRequest{
		Tenant:         first.tenantContext(),
		SeriesPublicId: mineSeries,
		PublicId:       theirs.Episode.PublicId,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetEpisode wrong series code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	_, err = client.GetEpisode(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.GetEpisodeRequest{
		Tenant:         first.tenantContext(),
		SeriesPublicId: mineSeries,
		PublicId:       "EPISODE_MISSING",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetEpisode missing code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}
