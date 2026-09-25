package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// createDBEpisodeWithPages creates an episode of the series and gives it the
// number of body pages asked for, returning its public ID.
func createDBEpisodeWithPages(t *testing.T, env *adminDBEnv, tenant adminDBTenant, seriesPublicID string, pages int) string {
	t.Helper()

	created, err := env.seriesClient().CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		Title:          "Chapter One",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	publicID := created.Msg.Episode.PublicId

	var episodeID uuid.UUID
	if err := env.PG.DB.QueryRowContext(context.Background(), "SELECT id FROM episodes WHERE public_id = $1", publicID).Scan(&episodeID); err != nil {
		t.Fatalf("resolve episode %s: %v", publicID, err)
	}
	for page := range pages {
		env.PG.SeedEpisodeImage(t, tenant.Tenant.ID, episodeID, int32(page+1))
	}
	return publicID
}

func getDBEpisode(t *testing.T, env *adminDBEnv, tenant adminDBTenant, seriesPublicID, publicID string) *publiraadminv1.GetEpisodeResponse {
	t.Helper()

	got, err := env.seriesClient().GetEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		PublicId:       publicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisode: %v", err)
	}
	return got.Msg
}

func assertEpisodeLayout(t *testing.T, episode *publirattypesv1.Episode, direction publirattypesv1.ReadingDirection, spreadStartIndex int32) {
	t.Helper()

	if episode.ReadingDirection != direction || episode.SpreadStartIndex != spreadStartIndex {
		t.Fatalf("layout = %s from %d, want %s from %d", episode.ReadingDirection, episode.SpreadStartIndex, direction, spreadStartIndex)
	}
}

// A series nobody has set a layout on is read the way both viewers laid every
// episode out before the values existed.
func TestDBSeriesLayoutDefaultsToTheHardCodedViewerLayout(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	seriesPublicID := createDBSeries(t, env.seriesClient(), tenant, "Default Layout")

	series, err := env.seriesClient().GetSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: seriesPublicID,
	}))
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if series.Msg.ReadingDirection != publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT || series.Msg.SpreadStartIndex != 1 {
		t.Fatalf("series layout = %s from %d, want RIGHT_TO_LEFT from 1", series.Msg.ReadingDirection, series.Msg.SpreadStartIndex)
	}

	episodePublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 2)
	got := getDBEpisode(t, env, tenant, seriesPublicID, episodePublicID)
	assertEpisodeLayout(t, got.Episode, publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT, 1)
	if got.ReadingDirection != publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED || got.SpreadStartIndex != nil {
		t.Fatalf("overrides = %s, %v, want none", got.ReadingDirection, got.SpreadStartIndex)
	}
}

// An episode that overrides nothing follows its series, including after the
// series changes; one that overrides a value keeps its own.
func TestDBEpisodeLayoutFollowsItsSeriesUnlessOverridden(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Left To Right")
	following := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 4)
	overriding := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 4)

	updated, err := client.UpdateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:           tenant.tenantContext(),
		PublicId:         seriesPublicID,
		Title:            "Left To Right",
		ReadingDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT.Enum(),
		SpreadStartIndex: new(int32),
	}))
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if updated.Msg.ReadingDirection != publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT || updated.Msg.SpreadStartIndex != 0 {
		t.Fatalf("updated series layout = %s from %d, want LEFT_TO_RIGHT from 0", updated.Msg.ReadingDirection, updated.Msg.SpreadStartIndex)
	}

	spreadStartIndex := int32(2)
	overridden, err := client.UpdateEpisodeLayout(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateEpisodeLayoutRequest{
		Tenant:           tenant.tenantContext(),
		EpisodePublicId:  overriding,
		SpreadStartIndex: &spreadStartIndex,
	}))
	if err != nil {
		t.Fatalf("UpdateEpisodeLayout: %v", err)
	}
	// Only the index is overridden, so the direction still comes from the series.
	assertEpisodeLayout(t, overridden.Msg.Episode, publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT, 2)
	if overridden.Msg.SpreadStartIndex == nil || *overridden.Msg.SpreadStartIndex != 2 {
		t.Fatalf("stored spread_start_index override = %v, want 2", overridden.Msg.SpreadStartIndex)
	}

	assertEpisodeLayout(t, getDBEpisode(t, env, tenant, seriesPublicID, following).Episode, publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT, 0)

	// Editing the series again reaches the episode that follows it and leaves
	// the override alone.
	if _, err := client.UpdateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:           tenant.tenantContext(),
		PublicId:         seriesPublicID,
		Title:            "Left To Right",
		ReadingDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT.Enum(),
		SpreadStartIndex: new(int32),
	})); err != nil {
		t.Fatalf("UpdateSeries again: %v", err)
	}
	assertEpisodeLayout(t, getDBEpisode(t, env, tenant, seriesPublicID, following).Episode, publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT, 0)
	assertEpisodeLayout(t, getDBEpisode(t, env, tenant, seriesPublicID, overriding).Episode, publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT, 2)

	// Leaving both fields empty returns the episode to following the series.
	cleared, err := client.UpdateEpisodeLayout(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateEpisodeLayoutRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: overriding,
	}))
	if err != nil {
		t.Fatalf("UpdateEpisodeLayout clearing: %v", err)
	}
	assertEpisodeLayout(t, cleared.Msg.Episode, publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT, 0)
	if cleared.Msg.ReadingDirection != publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED || cleared.Msg.SpreadStartIndex != nil {
		t.Fatalf("cleared overrides = %s, %v, want none", cleared.Msg.ReadingDirection, cleared.Msg.SpreadStartIndex)
	}
}

// An invalid direction or spread start is refused and the stored layout stays
// as it was.
func TestDBLayoutRejectsInvalidValues(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Refusals")
	episodePublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 3)
	pagelessPublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 0)

	int32Ptr := func(v int32) *int32 { return &v }
	episodeCases := []struct {
		name string
		req  *publiraadminv1.UpdateEpisodeLayoutRequest
	}{
		{
			name: "unknown-direction",
			req: &publiraadminv1.UpdateEpisodeLayoutRequest{
				EpisodePublicId:  episodePublicID,
				ReadingDirection: publirattypesv1.ReadingDirection(99),
			},
		},
		{
			name: "negative-spread-start",
			req:  &publiraadminv1.UpdateEpisodeLayoutRequest{EpisodePublicId: episodePublicID, SpreadStartIndex: int32Ptr(-1)},
		},
		{
			// Three pages are indexes 0 to 2.
			name: "spread-start-past-the-last-page",
			req:  &publiraadminv1.UpdateEpisodeLayoutRequest{EpisodePublicId: episodePublicID, SpreadStartIndex: int32Ptr(3)},
		},
		{
			name: "spread-start-on-an-episode-without-pages",
			req:  &publiraadminv1.UpdateEpisodeLayoutRequest{EpisodePublicId: pagelessPublicID, SpreadStartIndex: int32Ptr(0)},
		},
	}
	for _, tc := range episodeCases {
		t.Run(tc.name, func(t *testing.T) {
			tc.req.Tenant = tenant.tenantContext()
			_, err := client.UpdateEpisodeLayout(context.Background(), newAdminDBRequest(tenant, tc.req))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdateEpisodeLayout code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
			got := getDBEpisode(t, env, tenant, seriesPublicID, tc.req.EpisodePublicId)
			if got.ReadingDirection != publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED || got.SpreadStartIndex != nil {
				t.Fatalf("overrides after a refusal = %s, %v, want none", got.ReadingDirection, got.SpreadStartIndex)
			}
		})
	}

	// The last page itself is a valid place for pairing to start.
	if _, err := client.UpdateEpisodeLayout(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateEpisodeLayoutRequest{
		Tenant:           tenant.tenantContext(),
		EpisodePublicId:  episodePublicID,
		SpreadStartIndex: int32Ptr(2),
	})); err != nil {
		t.Fatalf("UpdateEpisodeLayout on the last page: %v", err)
	}

	seriesCases := []struct {
		name string
		req  *publiraadminv1.UpdateSeriesRequest
	}{
		{name: "unknown-direction", req: &publiraadminv1.UpdateSeriesRequest{ReadingDirection: publirattypesv1.ReadingDirection(99).Enum()}},
		{name: "negative-spread-start", req: &publiraadminv1.UpdateSeriesRequest{SpreadStartIndex: int32Ptr(-1)}},
	}
	for _, tc := range seriesCases {
		t.Run("series-"+tc.name, func(t *testing.T) {
			tc.req.Tenant = tenant.tenantContext()
			tc.req.PublicId = seriesPublicID
			tc.req.Title = "Refusals"
			_, err := client.UpdateSeries(context.Background(), newAdminDBRequest(tenant, tc.req))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
		})
	}
}

func TestDBUpdateEpisodeLayoutOfAnotherTenantReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	owner, other := seedTwoTenants(t, env)
	seriesPublicID := createDBSeries(t, env.seriesClient(), owner, "Owned")
	episodePublicID := createDBEpisodeWithPages(t, env, owner, seriesPublicID, 1)

	_, err := env.seriesClient().UpdateEpisodeLayout(context.Background(), newAdminDBRequest(other, &publiraadminv1.UpdateEpisodeLayoutRequest{
		Tenant:           other.tenantContext(),
		EpisodePublicId:  episodePublicID,
		ReadingDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateEpisodeLayout code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}
