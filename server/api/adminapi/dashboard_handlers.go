package adminapi

import (
	"context"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

func (s *adminServer) GetDashboard(
	ctx context.Context,
	req *publiraadminv1.GetDashboardRequest,
) (*publiraadminv1.GetDashboardResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	publishedSeriesCount, err := s.queriesFor(ctx).CountPublishedSeriesForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count published series for dashboard", err, "tenant_id", tenant.ID.String())
	}

	draftEpisodeCount, err := s.queriesFor(ctx).CountDraftEpisodesForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count draft episodes for dashboard", err, "tenant_id", tenant.ID.String())
	}

	scheduledEpisodeCount, err := s.queriesFor(ctx).CountScheduledEpisodesForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count scheduled episodes for dashboard", err, "tenant_id", tenant.ID.String())
	}

	recentEpisodes, err := s.queriesFor(ctx).ListRecentEpisodesForDashboard(ctx, dbmodels.ListRecentEpisodesForDashboardParams{
		TenantID: tenant.ID,
		Limit:    10,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list recent episodes for dashboard", err, "tenant_id", tenant.ID.String())
	}

	queue := make([]*publiraadminv1.DashboardQueueItem, 0, len(recentEpisodes))
	for _, row := range recentEpisodes {
		item := &publiraadminv1.DashboardQueueItem{
			SeriesPublicId:  row.SeriesPublicID,
			SeriesTitle:     row.SeriesTitle,
			EpisodePublicId: row.EpisodePublicID,
			EpisodeTitle:    row.EpisodeTitle,
			Status:          row.Status,
		}
		if row.ScheduledAt.Valid {
			item.ScheduledAt = row.ScheduledAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00")
		}
		queue = append(queue, item)
	}

	return &publiraadminv1.GetDashboardResponse{
		Stats: &publiraadminv1.DashboardStats{
			PublishedSeriesCount:  publishedSeriesCount,
			DraftEpisodeCount:     draftEpisodeCount,
			ScheduledEpisodeCount: scheduledEpisodeCount,
		},
		Queue: queue,
	}, nil
}
