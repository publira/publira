package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
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
		Tenant:           tenant.tenantContext(),
		SeriesPublicId:   seriesPublicID,
		EpisodePublicIds: reversed,
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
