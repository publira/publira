package adminapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
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

	resp, err := client.CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		Title:          title,
		Price:          500,
	}))
	if err != nil {
		t.Fatalf("CreateEpisode %q: %v", title, err)
	}
	return resp.Msg.Episode.PublicId
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
	created, err := client.CreateEpisodeFreeWindow(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: episodePublicID,
		StartsAt:        rfc3339(base),
		EndsAt:          rfc3339(base.Add(2 * time.Hour)),
	}))
	if err != nil {
		t.Fatalf("CreateEpisodeFreeWindow: %v", err)
	}
	window := created.Msg.FreeWindow
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
	_, err = client.CreateEpisodeFreeWindow(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: episodePublicID,
		StartsAt:        rfc3339(base.Add(time.Hour)),
		EndsAt:          rfc3339(base.Add(3 * time.Hour)),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("overlapping window code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	// One campaign may still follow another without a gap.
	if _, err := client.CreateEpisodeFreeWindow(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: episodePublicID,
		StartsAt:        rfc3339(base.Add(2 * time.Hour)),
		EndsAt:          rfc3339(base.Add(4 * time.Hour)),
	})); err != nil {
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
			_, err := client.CreateEpisodeFreeWindow(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeFreeWindowRequest{
				Tenant:          tenant.tenantContext(),
				EpisodePublicId: episodePublicID,
				StartsAt:        tc.startsAt,
				EndsAt:          tc.endsAt,
			}))
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
	_, err := client.CreateEpisodeFreeWindow(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:          second.tenantContext(),
		EpisodePublicId: episodePublicID,
		StartsAt:        rfc3339(base),
		EndsAt:          rfc3339(base.Add(time.Hour)),
	}))
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
	created, err := client.CreateSeriesFreeWindows(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesFreeWindowsRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		StartsAt:       rfc3339(base),
		EndsAt:         rfc3339(base.Add(24 * time.Hour)),
	}))
	if err != nil {
		t.Fatalf("CreateSeriesFreeWindows: %v", err)
	}
	if len(created.Msg.FreeWindows) != len(episodes) {
		t.Fatalf("windows = %d, want one per episode (%d)", len(created.Msg.FreeWindows), len(episodes))
	}
	for i, window := range created.Msg.FreeWindows {
		if window.EpisodePublicId != episodes[i] {
			t.Errorf("window %d covers episode %q, want %q in series order", i, window.EpisodePublicId, episodes[i])
		}
		if window.StartsAt != rfc3339(base) {
			t.Errorf("window %d starts at %q, want %q", i, window.StartsAt, rfc3339(base))
		}
	}

	// Overlapping the same period again is refused, and no episode keeps a row
	// from the attempt: the whole call is one transaction.
	_, err = client.CreateSeriesFreeWindows(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesFreeWindowsRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		StartsAt:       rfc3339(base.Add(48 * time.Hour)),
		EndsAt:         rfc3339(base.Add(72 * time.Hour)),
	}))
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
	if _, err := client.CreateEpisodeFreeWindow(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: second,
		StartsAt:        rfc3339(base),
		EndsAt:          rfc3339(base.Add(2 * time.Hour)),
	})); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow on the second episode: %v", err)
	}

	_, err := client.CreateSeriesFreeWindows(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesFreeWindowsRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: seriesPublicID,
		StartsAt:       rfc3339(base),
		EndsAt:         rfc3339(base.Add(2 * time.Hour)),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	// The first episode is still free of windows, which it would not be had the
	// failed call kept the row it wrote before the collision.
	if _, err := client.CreateEpisodeFreeWindow(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: first,
		StartsAt:        rfc3339(base),
		EndsAt:          rfc3339(base.Add(2 * time.Hour)),
	})); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow on the first episode after the failed campaign: %v", err)
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
	created, err := client.CreateEpisodeFreeWindow(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: episodePublicID,
		StartsAt:        rfc3339(base),
		EndsAt:          rfc3339(base.Add(2 * time.Hour)),
	}))
	if err != nil {
		t.Fatalf("CreateEpisodeFreeWindow: %v", err)
	}
	windowPublicID := created.Msg.FreeWindow.PublicId

	// Another tenant cannot reach it, even holding the public ID.
	_, err = client.DeleteEpisodeFreeWindow(context.Background(), newAdminDBRequest(other, &publiraadminv1.DeleteEpisodeFreeWindowRequest{
		Tenant:   other.tenantContext(),
		PublicId: windowPublicID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-tenant delete code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	if _, err := client.DeleteEpisodeFreeWindow(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteEpisodeFreeWindowRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: windowPublicID,
	})); err != nil {
		t.Fatalf("DeleteEpisodeFreeWindow: %v", err)
	}

	_, err = client.DeleteEpisodeFreeWindow(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteEpisodeFreeWindowRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: windowPublicID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("second delete code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	// The period is free again once the window is gone.
	if _, err := client.CreateEpisodeFreeWindow(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: episodePublicID,
		StartsAt:        rfc3339(base),
		EndsAt:          rfc3339(base.Add(2 * time.Hour)),
	})); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow after the delete: %v", err)
	}
}
