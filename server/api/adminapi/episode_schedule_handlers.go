package adminapi

import (
	"context"
	"time"

	"github.com/publira/publira/server/internal/dayperiod"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/tenanttz"
)

// maxPublicationPeriodDays bounds the days ListEpisodesByPublicationDate reads
// in one answer: two months of 31 days, so a calendar can ask for the month it
// shows and the one beside it.
const maxPublicationPeriodDays = 62

// ListEpisodesByPublicationDate answers every scheduled and published episode
// of the tenant whose publication falls within a period of the tenant's days.
func (s *adminServer) ListEpisodesByPublicationDate(
	ctx context.Context,
	req *publiraadminv1.ListEpisodesByPublicationDateRequest,
) (*publiraadminv1.ListEpisodesByPublicationDateResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	timeZone := tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx)))
	zone, err := time.LoadLocation(timeZone)
	if err != nil {
		return nil, s.internalError(ctx, "failed to load the tenant time zone", err,
			"tenant_id", tenant.ID.String(), "time_zone", timeZone)
	}
	period, err := dayperiod.Parse(req.StartDate, req.EndDate, maxPublicationPeriodDays, zone)
	if err != nil {
		return nil, err
	}

	rows, err := s.queriesFor(ctx).ListEpisodesByPublicationTimeForTenant(ctx, dbmodels.ListEpisodesByPublicationTimeForTenantParams{
		TenantID: tenant.ID,
		FromTime: period.From,
		ToTime:   period.To,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episodes by publication date", err, "tenant_id", tenant.ID.String())
	}
	episodes := make([]*publiraadminv1.EpisodePublication, 0, len(rows))
	for _, row := range rows {
		episodes = append(episodes, &publiraadminv1.EpisodePublication{
			SeriesPublicId:  row.SeriesPublicID,
			SeriesTitle:     row.SeriesTitle,
			EpisodePublicId: row.EpisodePublicID,
			EpisodeTitle:    row.EpisodeTitle,
			Status:          row.Status,
			PublishedAt:     row.PublishedAt.UTC().Format(time.RFC3339),
		})
	}
	return &publiraadminv1.ListEpisodesByPublicationDateResponse{Episodes: episodes}, nil
}
