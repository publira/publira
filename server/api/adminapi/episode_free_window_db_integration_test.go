package adminapi

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// createDBEpisode creates one episode at the end of the series and returns its
// public ID.
func createDBEpisode(
	t *testing.T,
	client publiraadminv1connect.AdminSeriesServiceClient,
	tenant adminDBTenant,
	seriesPublicID, title string,
) string {
	t.Helper()

	series, err := client.GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: seriesPublicID,
	})
	if err != nil {
		t.Fatalf("GetSeries %q: %v", seriesPublicID, err)
	}
	resp, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: series.Series.Id,
		Title:    title,
		Price:    500,
	})
	if err != nil {
		t.Fatalf("CreateEpisode %q: %v", title, err)
	}
	return resp.Episode.PublicId
}

func rfc3339(at time.Time) string {
	return at.UTC().Format(time.RFC3339)
}

func TestDBCreateEpisodeFreeWindow(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	episodePublicID := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	created, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, episodePublicID),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(2 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("CreateEpisodeFreeWindow: %v", err)
	}
	window := created.FreeWindow
	if window.PublicId == "" {
		t.Fatal("created window carries no public_id, so nothing can address it again")
	}
	if window.EpisodePublicId != episodePublicID || window.SeriesPublicId != seriesPublicID {
		t.Errorf("window names episode %q of series %q, want %q of %q", window.EpisodePublicId, window.SeriesPublicId, episodePublicID, seriesPublicID)
	}
	if window.StartsAt != rfc3339(base) || window.EndsAt != rfc3339(base.Add(2*time.Hour)) {
		t.Errorf("window period = %q..%q, want %q..%q", window.StartsAt, window.EndsAt, rfc3339(base), rfc3339(base.Add(2*time.Hour)))
	}

	// The database decides overlap, so two campaigns cannot both claim an
	// instant of the same episode.
	_, err = client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, episodePublicID),
		StartsAt:  rfc3339(base.Add(time.Hour)),
		EndsAt:    rfc3339(base.Add(3 * time.Hour)),
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("overlapping window code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	// One campaign may still follow another without a gap.
	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, episodePublicID),
		StartsAt:  rfc3339(base.Add(2 * time.Hour)),
		EndsAt:    rfc3339(base.Add(4 * time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow starting where the first ends: %v", err)
	}
}

func TestDBCreateEpisodeFreeWindowRejectsUnusablePeriods(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	episodePublicID := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")

	now := time.Now().UTC()
	cases := []struct {
		name     string
		startsAt string
		endsAt   string
		wantCode connect.Code
	}{
		{"ends before it starts", rfc3339(now.Add(2 * time.Hour)), rfc3339(now.Add(time.Hour)), connect.CodeInvalidArgument},
		{"already over", rfc3339(now.Add(-2 * time.Hour)), rfc3339(now.Add(-time.Hour)), connect.CodeInvalidArgument},
		{"not a timestamp", "yesterday", rfc3339(now.Add(time.Hour)), connect.CodeInvalidArgument},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
				Tenant:    tenant.tenantContext(),
				EpisodeId: env.episodeID(t, episodePublicID),
				StartsAt:  tc.startsAt,
				EndsAt:    tc.endsAt,
			})
			if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("code = %v, want %v (err=%v)", connect.CodeOf(err), tc.wantCode, err)
			}
		})
	}
}

// A campaign is scheduled on the episodes of one series, so an episode of
// another tenant's series is not addressable even with a valid public ID.
func TestDBCreateEpisodeFreeWindowInAnotherTenantsEpisodeReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	second := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")

	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, first, "Tenant A Series")
	episodePublicID := createDBEpisode(t, client, first, seriesPublicID, "Chapter One")

	base := time.Now().UTC().Add(time.Hour)
	_, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    second.tenantContext(),
		EpisodeId: env.episodeID(t, episodePublicID),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(time.Hour)),
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBCreateSeriesFreeWindowsCoversEveryEpisode(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")

	episodes := make([]string, 0, 3)
	for _, title := range []string{"Chapter One", "Chapter Two", "Chapter Three"} {
		episodes = append(episodes, createDBEpisode(t, client, tenant, seriesPublicID, title))
	}

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	created, err := client.CreateSeriesFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesFreeWindowsRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
		StartsAt: rfc3339(base),
		EndsAt:   rfc3339(base.Add(24 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("CreateSeriesFreeWindows: %v", err)
	}
	if len(created.FreeWindows) != len(episodes) {
		t.Fatalf("windows = %d, want one per episode (%d)", len(created.FreeWindows), len(episodes))
	}
	for i, window := range created.FreeWindows {
		if window.EpisodePublicId != episodes[i] {
			t.Errorf("window %d covers episode %q, want %q in series order", i, window.EpisodePublicId, episodes[i])
		}
		if window.StartsAt != rfc3339(base) {
			t.Errorf("window %d starts at %q, want %q", i, window.StartsAt, rfc3339(base))
		}
	}

	// Overlapping the same period again is refused, and no episode keeps a row
	// from the attempt: the whole call is one transaction.
	_, err = client.CreateSeriesFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesFreeWindowsRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
		StartsAt: rfc3339(base.Add(48 * time.Hour)),
		EndsAt:   rfc3339(base.Add(72 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("CreateSeriesFreeWindows over a free period: %v", err)
	}
}

// The all-or-nothing rule is what a client relies on when it retries: a campaign
// that collided with one episode's existing window leaves the others untouched.
func TestDBCreateSeriesFreeWindowsIsAllOrNothing(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	first := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")
	second := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter Two")

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, second),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(2 * time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow on the second episode: %v", err)
	}

	_, err := client.CreateSeriesFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesFreeWindowsRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
		StartsAt: rfc3339(base),
		EndsAt:   rfc3339(base.Add(2 * time.Hour)),
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	// The first episode is still free of windows, which it would not be had the
	// failed call kept the row it wrote before the collision.
	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, first),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(2 * time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow on the first episode after the failed campaign: %v", err)
	}
}

func TestDBCreateSeriesFreeWindowsCoversOnlyTheNamedEpisodes(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	first := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")
	second := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter Two")
	third := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter Three")

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	created, err := client.CreateSeriesFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesFreeWindowsRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
		StartsAt: rfc3339(base),
		EndsAt:   rfc3339(base.Add(24 * time.Hour)),
		// Named out of order: the response follows the series, not the request.
		EpisodeIds: env.episodeIDs(t, []string{third, first}),
	})
	if err != nil {
		t.Fatalf("CreateSeriesFreeWindows: %v", err)
	}
	got := make([]string, 0, len(created.FreeWindows))
	for _, window := range created.FreeWindows {
		got = append(got, window.EpisodePublicId)
	}
	if want := []string{first, third}; !slices.Equal(got, want) {
		t.Fatalf("windows cover %v, want %v", got, want)
	}

	// The episode left out of the campaign has no window over the period.
	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, second),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(24 * time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow on the episode left out: %v", err)
	}
}

func TestDBCreateSeriesFreeWindowsOnNamedEpisodesIsAllOrNothing(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	first := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")
	second := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter Two")

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, second),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(2 * time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow on the second episode: %v", err)
	}

	_, err := client.CreateSeriesFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesFreeWindowsRequest{
		Tenant:     tenant.tenantContext(),
		SeriesId:   env.seriesID(t, seriesPublicID),
		StartsAt:   rfc3339(base),
		EndsAt:     rfc3339(base.Add(2 * time.Hour)),
		EpisodeIds: env.episodeIDs(t, []string{first, second}),
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, first),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(2 * time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow on the first episode after the failed campaign: %v", err)
	}
}

// An episode of another series, or of another tenant, is not part of the
// campaign the caller named, so the call fails instead of scheduling the rest.
func TestDBCreateSeriesFreeWindowsRefusesAnEpisodeOutsideTheSeries(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	own := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")
	otherSeries := createDBSeries(t, client, tenant, "Another Series")
	otherSeriesEpisode := createDBEpisode(t, client, tenant, otherSeries, "Elsewhere")
	otherTenantSeries := createDBSeries(t, client, other, "Tenant B Series")
	otherTenantEpisode := createDBEpisode(t, client, other, otherTenantSeries, "Tenant B Chapter")

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	for name, outsider := range map[string]string{
		"another series": otherSeriesEpisode,
		"another tenant": otherTenantEpisode,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := client.CreateSeriesFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesFreeWindowsRequest{
				Tenant:     tenant.tenantContext(),
				SeriesId:   env.seriesID(t, seriesPublicID),
				StartsAt:   rfc3339(base),
				EndsAt:     rfc3339(base.Add(time.Hour)),
				EpisodeIds: env.episodeIDs(t, []string{own, outsider}),
			})
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
		})
	}

	// Neither refusal left the series' own episode a window.
	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, own),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow after the refused campaigns: %v", err)
	}
}

func TestDBDeleteEpisodeFreeWindow(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	episodePublicID := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")

	base := time.Now().UTC().Add(time.Hour)
	created, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, episodePublicID),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(2 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("CreateEpisodeFreeWindow: %v", err)
	}
	windowID := created.FreeWindow.Id

	// Another tenant cannot reach it, even holding its ID.
	_, err = client.DeleteEpisodeFreeWindow(testutil.WithBearer(context.Background(), other.token()), &publiraadminv1.DeleteEpisodeFreeWindowRequest{
		Tenant:       other.tenantContext(),
		FreeWindowId: windowID,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-tenant delete code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	if _, err := client.DeleteEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteEpisodeFreeWindowRequest{
		Tenant:       tenant.tenantContext(),
		FreeWindowId: windowID,
	}); err != nil {
		t.Fatalf("DeleteEpisodeFreeWindow: %v", err)
	}

	_, err = client.DeleteEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteEpisodeFreeWindowRequest{
		Tenant:       tenant.tenantContext(),
		FreeWindowId: windowID,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("second delete code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	// The period is free again once the window is gone.
	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, episodePublicID),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(2 * time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow after the delete: %v", err)
	}
}

func listFreeWindowsByEpisode(episodeID string) *publiraadminv1.ListEpisodeFreeWindowsRequest_EpisodeId {
	return &publiraadminv1.ListEpisodeFreeWindowsRequest_EpisodeId{EpisodeId: episodeID}
}

func listFreeWindowsBySeries(seriesID string) *publiraadminv1.ListEpisodeFreeWindowsRequest_SeriesId {
	return &publiraadminv1.ListEpisodeFreeWindowsRequest_SeriesId{SeriesId: seriesID}
}

func freeWindowIDs(windows []*publiraadminv1.AdminEpisodeFreeWindow) []string {
	ids := make([]string, 0, len(windows))
	for _, window := range windows {
		ids = append(ids, window.Id)
	}
	return ids
}

// A window scheduled in one call is reachable from a later one: the listing
// carries the id DeleteEpisodeFreeWindow takes, which before the listing only
// the creating call's response did.
func TestDBListEpisodeFreeWindowsFindsWhatAnEarlierCallScheduled(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	first := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")
	second := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter Two")
	otherSeriesPublicID := createDBSeries(t, client, tenant, "Other Series")
	elsewhere := createDBEpisode(t, client, tenant, otherSeriesPublicID, "Elsewhere")

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	single, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, first),
		StartsAt:  rfc3339(base.Add(48 * time.Hour)),
		EndsAt:    rfc3339(base.Add(72 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("CreateEpisodeFreeWindow: %v", err)
	}
	campaign, err := client.CreateSeriesFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesFreeWindowsRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
		StartsAt: rfc3339(base),
		EndsAt:   rfc3339(base.Add(24 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("CreateSeriesFreeWindows: %v", err)
	}
	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, elsewhere),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(24 * time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow in another series: %v", err)
	}

	byEpisode, err := client.ListEpisodeFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeFreeWindowsRequest{
		Tenant: tenant.tenantContext(),
		Scope:  listFreeWindowsByEpisode(env.episodeID(t, first)),
	})
	if err != nil {
		t.Fatalf("ListEpisodeFreeWindows by episode: %v", err)
	}
	// Latest start first, so the campaign further ahead leads.
	wantEpisode := []string{single.FreeWindow.Id, campaign.FreeWindows[0].Id}
	if got := freeWindowIDs(byEpisode.FreeWindows); !slices.Equal(got, wantEpisode) {
		t.Fatalf("episode windows = %v, want %v", got, wantEpisode)
	}
	if got := byEpisode.FreeWindows[0]; !proto.Equal(got, single.FreeWindow) {
		t.Errorf("listed window = %v, want what CreateEpisodeFreeWindow answered: %v", got, single.FreeWindow)
	}
	if byEpisode.PreviousToken != "" || byEpisode.NextToken != "" {
		t.Errorf("tokens = %q / %q, want both empty for a list that fits on one page", byEpisode.PreviousToken, byEpisode.NextToken)
	}

	bySeries, err := client.ListEpisodeFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeFreeWindowsRequest{
		Tenant: tenant.tenantContext(),
		Scope:  listFreeWindowsBySeries(env.seriesID(t, seriesPublicID)),
	})
	if err != nil {
		t.Fatalf("ListEpisodeFreeWindows by series: %v", err)
	}
	// The campaign's windows share a start, so the id breaks the tie, and the
	// episode created later was given the later id.
	wantSeries := []string{single.FreeWindow.Id, campaign.FreeWindows[1].Id, campaign.FreeWindows[0].Id}
	if got := freeWindowIDs(bySeries.FreeWindows); !slices.Equal(got, wantSeries) {
		t.Fatalf("series windows = %v, want %v (none from another series)", got, wantSeries)
	}
	if got := bySeries.FreeWindows[1].EpisodePublicId; got != second {
		t.Errorf("second listed window covers episode %q, want %q", got, second)
	}

	if _, err := client.DeleteEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteEpisodeFreeWindowRequest{
		Tenant:       tenant.tenantContext(),
		FreeWindowId: bySeries.FreeWindows[0].Id,
	}); err != nil {
		t.Fatalf("DeleteEpisodeFreeWindow by the listed id: %v", err)
	}
	after, err := client.ListEpisodeFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeFreeWindowsRequest{
		Tenant: tenant.tenantContext(),
		Scope:  listFreeWindowsByEpisode(env.episodeID(t, first)),
	})
	if err != nil {
		t.Fatalf("ListEpisodeFreeWindows after the delete: %v", err)
	}
	if got, want := freeWindowIDs(after.FreeWindows), []string{campaign.FreeWindows[0].Id}; !slices.Equal(got, want) {
		t.Fatalf("episode windows after the delete = %v, want %v", got, want)
	}
}

// Expired rows are not purged, so an editor sees a window that is over until
// it is deleted, behind the ones still ahead.
func TestDBListEpisodeFreeWindowsKeepsWindowsThatAreOver(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	episodePublicID := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")
	episodeID := env.episodeID(t, episodePublicID)

	now := time.Now().UTC().Truncate(time.Second)
	over := env.PG.SeedEpisodeFreeWindow(t, tenant.Tenant.ID, uuid.MustParse(episodeID), now.Add(-48*time.Hour), now.Add(-24*time.Hour))
	ahead := env.PG.SeedEpisodeFreeWindow(t, tenant.Tenant.ID, uuid.MustParse(episodeID), now.Add(24*time.Hour), now.Add(48*time.Hour))

	resp, err := client.ListEpisodeFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeFreeWindowsRequest{
		Tenant: tenant.tenantContext(),
		Scope:  listFreeWindowsByEpisode(episodeID),
	})
	if err != nil {
		t.Fatalf("ListEpisodeFreeWindows: %v", err)
	}
	if got, want := freeWindowIDs(resp.FreeWindows), []string{ahead.String(), over.String()}; !slices.Equal(got, want) {
		t.Fatalf("windows = %v, want %v", got, want)
	}
}

func TestDBListEpisodeFreeWindowsPages(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	episodePublicID := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")
	episodeID := env.episodeID(t, episodePublicID)

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	created := make([]string, 0, 3)
	for i := range 3 {
		start := base.Add(time.Duration(i) * 24 * time.Hour)
		resp, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
			Tenant:    tenant.tenantContext(),
			EpisodeId: episodeID,
			StartsAt:  rfc3339(start),
			EndsAt:    rfc3339(start.Add(time.Hour)),
		})
		if err != nil {
			t.Fatalf("CreateEpisodeFreeWindow %d: %v", i, err)
		}
		created = append(created, resp.FreeWindow.Id)
	}
	latest, middle, earliest := created[2], created[1], created[0]

	list := func(t *testing.T, scope *publiraadminv1.ListEpisodeFreeWindowsRequest_EpisodeId, token string) *publiraadminv1.ListEpisodeFreeWindowsResponse {
		t.Helper()
		resp, err := client.ListEpisodeFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeFreeWindowsRequest{
			Tenant: tenant.tenantContext(),
			Scope:  scope,
			Limit:  2,
			Token:  token,
		})
		if err != nil {
			t.Fatalf("ListEpisodeFreeWindows token=%q: %v", token, err)
		}
		return resp
	}

	firstPage := list(t, listFreeWindowsByEpisode(episodeID), "")
	if got, want := freeWindowIDs(firstPage.FreeWindows), []string{latest, middle}; !slices.Equal(got, want) {
		t.Fatalf("first page = %v, want %v", got, want)
	}
	if firstPage.PreviousToken != "" || firstPage.NextToken == "" {
		t.Fatalf("first page tokens = %q / %q, want only a next token", firstPage.PreviousToken, firstPage.NextToken)
	}

	secondPage := list(t, listFreeWindowsByEpisode(episodeID), firstPage.NextToken)
	if got, want := freeWindowIDs(secondPage.FreeWindows), []string{earliest}; !slices.Equal(got, want) {
		t.Fatalf("second page = %v, want %v", got, want)
	}
	if secondPage.PreviousToken == "" || secondPage.NextToken != "" {
		t.Fatalf("second page tokens = %q / %q, want only a previous token", secondPage.PreviousToken, secondPage.NextToken)
	}

	back := list(t, listFreeWindowsByEpisode(episodeID), secondPage.PreviousToken)
	if got, want := freeWindowIDs(back.FreeWindows), []string{latest, middle}; !slices.Equal(got, want) {
		t.Fatalf("page before the second = %v, want %v", got, want)
	}

	// A token names the list it was issued for: walking a series with an
	// episode's token would resume at a row that is not a boundary there.
	_, err := client.ListEpisodeFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeFreeWindowsRequest{
		Tenant: tenant.tenantContext(),
		Scope:  listFreeWindowsBySeries(env.seriesID(t, seriesPublicID)),
		Limit:  2,
		Token:  firstPage.NextToken,
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("token of another scope code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}

// An episode or series of another tenant lists nothing, even named by its id,
// and the windows it holds stay out of reach.
func TestDBListEpisodeFreeWindowsStaysInsideTheTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	owner := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, owner, "Tenant A Series")
	episodePublicID := createDBEpisode(t, client, owner, seriesPublicID, "Chapter One")

	base := time.Now().UTC().Add(time.Hour)
	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), owner.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    owner.tenantContext(),
		EpisodeId: env.episodeID(t, episodePublicID),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow: %v", err)
	}

	requests := map[string]*publiraadminv1.ListEpisodeFreeWindowsRequest{
		"episode": {Scope: listFreeWindowsByEpisode(env.episodeID(t, episodePublicID))},
		"series":  {Scope: listFreeWindowsBySeries(env.seriesID(t, seriesPublicID))},
	}
	for name, req := range requests {
		t.Run(name, func(t *testing.T) {
			req.Tenant = other.tenantContext()
			resp, err := client.ListEpisodeFreeWindows(testutil.WithBearer(context.Background(), other.token()), req)
			if err != nil {
				t.Fatalf("ListEpisodeFreeWindows from another tenant: %v", err)
			}
			if len(resp.FreeWindows) != 0 {
				t.Fatalf("another tenant listed %d windows, want none", len(resp.FreeWindows))
			}
		})
	}
}

func TestDBListEpisodeFreeWindowsRequiresAScope(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	cases := map[string]*publiraadminv1.ListEpisodeFreeWindowsRequest{
		"no scope":                  {},
		"an empty episode id":       {Scope: listFreeWindowsByEpisode("")},
		"a series id that is no id": {Scope: listFreeWindowsBySeries("SERIES000001")},
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			req.Tenant = tenant.tenantContext()
			_, err := client.ListEpisodeFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
		})
	}
}

// A series page is merged from one page of each of its episodes, so a page
// boundary has to fall between windows of different episodes and still resume
// in order on both sides.
func TestDBListEpisodeFreeWindowsPagesAcrossTheEpisodesOfASeries(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	episodeIDs := []string{
		env.episodeID(t, createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")),
		env.episodeID(t, createDBEpisode(t, client, tenant, seriesPublicID, "Chapter Two")),
	}

	// The episodes take turns, so every page holds windows of both.
	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	created := make([]string, 0, 5)
	for i := range 5 {
		start := base.Add(time.Duration(i) * 24 * time.Hour)
		resp, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
			Tenant:    tenant.tenantContext(),
			EpisodeId: episodeIDs[i%2],
			StartsAt:  rfc3339(start),
			EndsAt:    rfc3339(start.Add(time.Hour)),
		})
		if err != nil {
			t.Fatalf("CreateEpisodeFreeWindow %d: %v", i, err)
		}
		created = append(created, resp.FreeWindow.Id)
	}
	slices.Reverse(created)

	seriesID := env.seriesID(t, seriesPublicID)
	list := func(t *testing.T, token string) *publiraadminv1.ListEpisodeFreeWindowsResponse {
		t.Helper()
		resp, err := client.ListEpisodeFreeWindows(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeFreeWindowsRequest{
			Tenant: tenant.tenantContext(),
			Scope:  listFreeWindowsBySeries(seriesID),
			Limit:  2,
			Token:  token,
		})
		if err != nil {
			t.Fatalf("ListEpisodeFreeWindows token=%q: %v", token, err)
		}
		return resp
	}

	var walked []string
	var pages []*publiraadminv1.ListEpisodeFreeWindowsResponse
	for token := ""; ; {
		page := list(t, token)
		pages = append(pages, page)
		walked = append(walked, freeWindowIDs(page.FreeWindows)...)
		if page.NextToken == "" {
			break
		}
		token = page.NextToken
	}
	if !slices.Equal(walked, created) {
		t.Fatalf("walked forward = %v, want %v", walked, created)
	}
	if len(pages) != 3 {
		t.Fatalf("pages = %d, want 3", len(pages))
	}

	back := list(t, pages[2].PreviousToken)
	if got, want := freeWindowIDs(back.FreeWindows), created[2:4]; !slices.Equal(got, want) {
		t.Fatalf("page before the last = %v, want %v", got, want)
	}
	if back.PreviousToken == "" || back.NextToken == "" {
		t.Fatalf("middle page tokens = %q / %q, want both", back.PreviousToken, back.NextToken)
	}
}
