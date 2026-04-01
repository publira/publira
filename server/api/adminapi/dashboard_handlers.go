package adminapi

import (
	"context"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

func (s *adminServer) GetDashboard(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetDashboardRequest],
) (*connect.Response[publiraadminv1.GetDashboardResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	publishedSeriesCount, err := s.queriesFor(ctx).CountPublishedSeriesForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	draftEpisodeCount, err := s.queriesFor(ctx).CountDraftEpisodesForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	scheduledEpisodeCount, err := s.queriesFor(ctx).CountScheduledEpisodesForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	recentEpisodes, err := s.queriesFor(ctx).ListRecentEpisodesForDashboard(ctx, dbmodels.ListRecentEpisodesForDashboardParams{
		TenantID: tenant.ID,
		Limit:    10,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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

	return connect.NewResponse(&publiraadminv1.GetDashboardResponse{
		Stats: &publiraadminv1.DashboardStats{
			PublishedSeriesCount:  publishedSeriesCount,
			DraftEpisodeCount:     draftEpisodeCount,
			ScheduledEpisodeCount: scheduledEpisodeCount,
		},
		Queue: queue,
	}), nil
}
