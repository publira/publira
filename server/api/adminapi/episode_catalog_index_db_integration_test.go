package adminapi

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seriesSyncsQueued counts the catalog_index_sync events that name the series.
func (e *adminDBEnv) seriesSyncsQueued(t *testing.T, seriesID string) int {
	t.Helper()
	var queued int
	if err := e.PG.DB.QueryRowContext(context.Background(),
		"SELECT count(*) FROM outbox_events WHERE event_type = $1 AND payload->>'kind' = 'series' AND payload->>'id' = $2",
		outbox.EventTypeCatalogIndexSync, seriesID,
	).Scan(&queued); err != nil {
		t.Fatalf("count the catalog index syncs of series %s: %v", seriesID, err)
	}
	return queued
}

// A series' search document carries its latest episode and whether a free one
// is open, so a write to an episode or a free window that can change either
// queues the series' sync in its own transaction, and one that cannot queues
// nothing.
func TestDBEpisodeWritesQueueTheirSeriesSearchSync(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := context.Background()
	seriesPublicID := createDBSeries(t, client, tenant, "Indexed Series")
	seriesID := env.seriesID(t, seriesPublicID)
	episodeID := env.episodeID(t, createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One"))

	queued := env.seriesSyncsQueued(t, seriesID)
	step := func(name string, want int, write func() error) {
		t.Helper()
		if err := write(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		got := env.seriesSyncsQueued(t, seriesID) - queued
		if got != want {
			t.Fatalf("%s queued %d syncs of the series, want %d", name, got, want)
		}
		queued += got
	}

	step("CreateEpisode published at once", 1, func() error {
		_, err := client.CreateEpisode(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateEpisodeRequest{
			Tenant:      tenant.tenantContext(),
			SeriesId:    seriesID,
			Title:       "Chapter Two",
			ScheduledAt: rfc3339(time.Now().Add(-time.Minute)),
		})
		return err
	})
	step("UpdateEpisodePublishSchedule", 1, func() error {
		_, err := client.UpdateEpisodePublishSchedule(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
			Tenant:      tenant.tenantContext(),
			EpisodeId:   episodeID,
			ScheduledAt: rfc3339(time.Now().Add(time.Hour)),
		})
		return err
	})
	step("UpdateEpisodeAvailability", 1, func() error {
		_, err := client.UpdateEpisodeAvailability(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateEpisodeAvailabilityRequest{
			Tenant:       tenant.tenantContext(),
			EpisodeId:    episodeID,
			Availability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
		})
		return err
	})

	// A window still ahead of its start changes nothing yet: the ticker job
	// queues the sync when it opens.
	var ahead, open string
	step("CreateEpisodeFreeWindow ahead of its start", 0, func() error {
		resp, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
			Tenant:    tenant.tenantContext(),
			EpisodeId: episodeID,
			StartsAt:  rfc3339(time.Now().Add(24 * time.Hour)),
			EndsAt:    rfc3339(time.Now().Add(48 * time.Hour)),
		})
		if err == nil {
			ahead = resp.FreeWindow.Id
		}
		return err
	})
	step("CreateEpisodeFreeWindow open at once", 1, func() error {
		resp, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
			Tenant:    tenant.tenantContext(),
			EpisodeId: episodeID,
			StartsAt:  rfc3339(time.Now().Add(-time.Hour)),
			EndsAt:    rfc3339(time.Now().Add(time.Hour)),
		})
		if err == nil {
			open = resp.FreeWindow.Id
		}
		return err
	})
	step("DeleteEpisodeFreeWindow ahead of its start", 0, func() error {
		_, err := client.DeleteEpisodeFreeWindow(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.DeleteEpisodeFreeWindowRequest{
			Tenant:       tenant.tenantContext(),
			FreeWindowId: ahead,
		})
		return err
	})
	step("DeleteEpisodeFreeWindow open", 1, func() error {
		_, err := client.DeleteEpisodeFreeWindow(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.DeleteEpisodeFreeWindowRequest{
			Tenant:       tenant.tenantContext(),
			FreeWindowId: open,
		})
		return err
	})
	// A window past its end is still owed a sync until apply-free-windows has
	// applied that end, because deleting the row takes the boundary away from
	// the batch. Once the end is applied, the document no longer counts it.
	deleteWindow := func(windowID uuid.UUID) func() error {
		return func() error {
			_, err := client.DeleteEpisodeFreeWindow(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.DeleteEpisodeFreeWindowRequest{
				Tenant:       tenant.tenantContext(),
				FreeWindowId: windowID.String(),
			})
			return err
		}
	}
	episodeUUID := uuid.MustParse(episodeID)
	unapplied := env.PG.SeedEpisodeFreeWindow(t, tenant.Tenant.ID, episodeUUID, time.Now().Add(-3*time.Hour), time.Now().Add(-2*time.Hour))
	step("DeleteEpisodeFreeWindow over but not yet closed by the batch", 1, deleteWindow(unapplied))
	applied := env.PG.SeedEpisodeFreeWindow(t, tenant.Tenant.ID, episodeUUID, time.Now().Add(-5*time.Hour), time.Now().Add(-4*time.Hour))
	if _, err := env.PG.DB.ExecContext(ctx, "UPDATE episode_free_windows SET start_revalidated_at = now(), end_revalidated_at = now() WHERE id = $1", applied); err != nil {
		t.Fatalf("apply the window's boundaries: %v", err)
	}
	step("DeleteEpisodeFreeWindow over and closed by the batch", 0, deleteWindow(applied))

	step("CreateSeriesFreeWindows open at once", 1, func() error {
		_, err := client.CreateSeriesFreeWindows(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateSeriesFreeWindowsRequest{
			Tenant:   tenant.tenantContext(),
			SeriesId: seriesID,
			StartsAt: rfc3339(time.Now().Add(-time.Minute)),
			EndsAt:   rfc3339(time.Now().Add(time.Hour)),
		})
		return err
	})
}
