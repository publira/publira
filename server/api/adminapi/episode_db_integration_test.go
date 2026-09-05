package adminapi

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
)

// createDBSeries creates one series for the tenant and returns its public ID.
func createDBSeries(
	t *testing.T,
	client publiraadminv1connect.AdminSeriesServiceClient,
	tenant adminDBTenant,
	title string,
) string {
	t.Helper()

	resp, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant: tenant.tenantContext(),
		Title:  title,
	}))
	if err != nil {
		t.Fatalf("CreateSeries %q: %v", title, err)
	}
	return resp.Msg.Series.PublicId
}

func TestDBCreateEpisodesAppendInOrder(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Episode Host Series")

	// order_index 0 means "append", which is resolved against the rows already
	// in the database rather than against anything the client sends.
	for index, title := range []string{"Episode One", "Episode Two", "Episode Three"} {
		resp, err := client.CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
			Tenant:         tenant.tenantContext(),
			SeriesPublicId: seriesPublicID,
			Title:          title,
			Price:          int32(100 * (index + 1)),
		}))
		if err != nil {
			t.Fatalf("CreateEpisode %s: %v", title, err)
		}
		if got, want := resp.Msg.Episode.OrderIndex, int32(index+1); got != want {
			t.Fatalf("%s order_index = %d, want %d", title, got, want)
		}
		if resp.Msg.Episode.Status != "draft" {
			t.Fatalf("%s status = %q, want draft", title, resp.Msg.Episode.Status)
		}
	}

	listed, err := client.ListEpisodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListEpisodesRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
	}))
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	titles := make([]string, 0, len(listed.Msg.Episodes))
	for _, episode := range listed.Msg.Episodes {
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
			resp, err := client.CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
				Tenant:         tenant.tenantContext(),
				SeriesPublicId: seriesPublicID,
				Title:          fmt.Sprintf("Concurrent %d", i),
			}))
			if err != nil {
				errs <- err
				return
			}
			indexes <- resp.Msg.Episode.OrderIndex
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

	listed, err := client.ListEpisodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListEpisodesRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
	}))
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if len(listed.Msg.Episodes) != n {
		t.Fatalf("ListEpisodes count = %d, want %d (every create must also write episode_listings)", len(listed.Msg.Episodes), n)
	}
}

func TestDBReorderEpisodesPersistsNewOrder(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Reorder Host Series")

	created := make([]string, 0, 3)
	for _, title := range []string{"First", "Second", "Third"} {
		resp, err := client.CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
			Tenant:         tenant.tenantContext(),
			SeriesPublicId: seriesPublicID,
			Title:          title,
		}))
		if err != nil {
			t.Fatalf("CreateEpisode %s: %v", title, err)
		}
		created = append(created, resp.Msg.Episode.PublicId)
	}

	reversed := []string{created[2], created[1], created[0]}
	reordered, err := client.ReorderEpisodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderEpisodesRequest{
		Tenant:                   tenant.tenantContext(),
		SeriesPublicId:           seriesPublicID,
		EpisodePublicIds:         reversed,
		ExpectedEpisodePublicIds: created,
	}))
	if err != nil {
		t.Fatalf("ReorderEpisodes: %v", err)
	}
	if got := episodePublicIDs(reordered.Msg.Episodes); !slices.Equal(got, reversed) {
		t.Fatalf("ReorderEpisodes = %v, want %v", got, reversed)
	}

	listed, err := client.ListEpisodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListEpisodesRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
	}))
	if err != nil {
		t.Fatalf("ListEpisodes after reorder: %v", err)
	}
	if got := episodePublicIDs(listed.Msg.Episodes); !slices.Equal(got, reversed) {
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
		resp, err := client.CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
			Tenant:         tenant.tenantContext(),
			SeriesPublicId: seriesPublicID,
			Title:          title,
		}))
		if err != nil {
			t.Fatalf("CreateEpisode %s: %v", title, err)
		}
		created = append(created, resp.Msg.Episode.PublicId)
	}

	reversed := []string{created[2], created[1], created[0]}
	if _, err := client.ReorderEpisodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderEpisodesRequest{
		Tenant:                   tenant.tenantContext(),
		SeriesPublicId:           seriesPublicID,
		EpisodePublicIds:         reversed,
		ExpectedEpisodePublicIds: created,
	})); err != nil {
		t.Fatalf("first ReorderEpisodes: %v", err)
	}

	_, err := client.ReorderEpisodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderEpisodesRequest{
		Tenant:                   tenant.tenantContext(),
		SeriesPublicId:           seriesPublicID,
		EpisodePublicIds:         []string{created[1], created[0], created[2]},
		ExpectedEpisodePublicIds: created,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("stale ReorderEpisodes code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeFailedPrecondition, err)
	}

	listed, err := client.ListEpisodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListEpisodesRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
	}))
	if err != nil {
		t.Fatalf("ListEpisodes after rejected reorder: %v", err)
	}
	if got := episodePublicIDs(listed.Msg.Episodes); !slices.Equal(got, reversed) {
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
		resp, err := client.CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
			Tenant:         tenant.tenantContext(),
			SeriesPublicId: seriesPublicID,
			Title:          title,
		}))
		if err != nil {
			t.Fatalf("CreateEpisode %s: %v", title, err)
		}
		created = append(created, resp.Msg.Episode.PublicId)
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
			resp, err := client.ReorderEpisodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderEpisodesRequest{
				Tenant:                   tenant.tenantContext(),
				SeriesPublicId:           seriesPublicID,
				EpisodePublicIds:         next,
				ExpectedEpisodePublicIds: created,
			}))
			if err != nil {
				outcomes <- outcome{err: err}
				return
			}
			outcomes <- outcome{order: episodePublicIDs(resp.Msg.Episodes)}
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

	listed, err := client.ListEpisodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListEpisodesRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
	}))
	if err != nil {
		t.Fatalf("ListEpisodes after concurrent reorder: %v", err)
	}
	if got := episodePublicIDs(listed.Msg.Episodes); !slices.Equal(got, winner) {
		t.Fatalf("reloaded order = %v, want the winning write %v", got, winner)
	}
}

func TestDBCreateEpisodeInAnotherTenantsSeriesReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()
	theirSeries := createDBSeries(t, client, second, "Tenant B Series")

	_, err := client.CreateEpisode(context.Background(), newAdminDBRequest(first, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         first.tenantContext(),
		SeriesPublicId: theirSeries,
		Title:          "Smuggled Episode",
	}))
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

	theirSeries := createDBSeries(t, client, second, "Tenant B Series")
	if _, err := client.CreateEpisode(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         second.tenantContext(),
		SeriesPublicId: theirSeries,
		Title:          "Tenant B Episode",
	})); err != nil {
		t.Fatalf("CreateEpisode for tenant B: %v", err)
	}

	listed, err := client.ListEpisodes(context.Background(), newAdminDBRequest(first, &publiraadminv1.ListEpisodesRequest{
		Tenant:         first.tenantContext(),
		SeriesPublicId: theirSeries,
	}))
	if err != nil {
		t.Fatalf("ListEpisodes across tenants: %v", err)
	}
	if len(listed.Msg.Episodes) != 0 {
		t.Fatalf("tenant A sees %v, want no episodes of tenant B", episodePublicIDs(listed.Msg.Episodes))
	}
}

func TestDBUpdateEpisodePublishScheduleRejectsPastTime(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Schedule Host Series")

	created, err := client.CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		Title:          "Scheduled Episode",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}

	_, err = client.UpdateEpisodePublishSchedule(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: created.Msg.Episode.PublicId,
		ScheduledAt:     "2000-01-01T00:00:00Z",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateEpisodePublishSchedule code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	if count := env.countRows(t,
		"SELECT count(*) FROM episode_listings WHERE status = $1", "scheduled",
	); count != 0 {
		t.Fatalf("scheduled listings = %d, want 0", count)
	}
}

func TestDBGetEpisodeReturnsDraftAndScheduled(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "GetEpisode Host Series")

	draft, err := client.CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		Title:          "Draft Episode",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode draft: %v", err)
	}

	gotDraft, err := client.GetEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		PublicId:       draft.Msg.Episode.PublicId,
	}))
	if err != nil {
		t.Fatalf("GetEpisode draft: %v", err)
	}
	if gotDraft.Msg.Episode.Status != "draft" {
		t.Fatalf("draft status = %q, want draft", gotDraft.Msg.Episode.Status)
	}
	if gotDraft.Msg.Episode.ScheduledAt != "" {
		t.Fatalf("draft scheduled_at = %q, want empty", gotDraft.Msg.Episode.ScheduledAt)
	}

	scheduledAt := "2030-01-01T01:00:00Z"
	scheduled, err := client.CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		Title:          "Scheduled Episode",
		ScheduledAt:    scheduledAt,
	}))
	if err != nil {
		t.Fatalf("CreateEpisode scheduled: %v", err)
	}

	gotScheduled, err := client.GetEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		PublicId:       scheduled.Msg.Episode.PublicId,
	}))
	if err != nil {
		t.Fatalf("GetEpisode scheduled: %v", err)
	}
	if gotScheduled.Msg.Episode.Status != "scheduled" {
		t.Fatalf("scheduled status = %q, want scheduled", gotScheduled.Msg.Episode.Status)
	}
	if gotScheduled.Msg.Episode.ScheduledAt != scheduledAt {
		t.Fatalf("scheduled_at = %q, want %q", gotScheduled.Msg.Episode.ScheduledAt, scheduledAt)
	}
}

func TestDBGetEpisodeTenantBoundary(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	theirSeries := createDBSeries(t, client, second, "Tenant B Series")
	theirs, err := client.CreateEpisode(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         second.tenantContext(),
		SeriesPublicId: theirSeries,
		Title:          "Tenant B Episode",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode for tenant B: %v", err)
	}

	_, err = client.GetEpisode(context.Background(), newAdminDBRequest(first, &publiraadminv1.GetEpisodeRequest{
		Tenant:         first.tenantContext(),
		SeriesPublicId: theirSeries,
		PublicId:       theirs.Msg.Episode.PublicId,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetEpisode across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	mineSeries := createDBSeries(t, client, first, "Tenant A Series")
	_, err = client.GetEpisode(context.Background(), newAdminDBRequest(first, &publiraadminv1.GetEpisodeRequest{
		Tenant:         first.tenantContext(),
		SeriesPublicId: mineSeries,
		PublicId:       theirs.Msg.Episode.PublicId,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetEpisode wrong series code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	_, err = client.GetEpisode(context.Background(), newAdminDBRequest(first, &publiraadminv1.GetEpisodeRequest{
		Tenant:         first.tenantContext(),
		SeriesPublicId: mineSeries,
		PublicId:       "EPISODE_MISSING",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetEpisode missing code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}
