package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect/v2"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenanttz"
)

var errDropOffEpisodeNotFound = errors.New("episode not found")

// GetEpisodeDropOff reports how many of one episode's readers reached each of
// its pages over a period of the tenant's days. The counts are the daily
// aggregates of the readers' saved positions, so a day reaches the report once
// aggregate-content-stats has rebuilt it.
func (s *adminServer) GetEpisodeDropOff(
	ctx context.Context,
	req *publiraadminv1.GetEpisodeDropOffRequest,
) (*publiraadminv1.GetEpisodeDropOffResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	period, err := parseStatsPeriod(req.StartDate, req.EndDate)
	if err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)
	episode, err := queries.GetEpisodePageCountByPublicID(ctx, dbmodels.GetEpisodePageCountByPublicIDParams{
		TenantID: tenant.ID,
		PublicID: req.EpisodePublicId,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeNotFound, errDropOffEpisodeNotFound, "episode_public_id")
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to resolve episode for drop-off", err, "tenant_id", tenant.ID.String())
	}

	reach, err := queries.ListEpisodePageReach(ctx, dbmodels.ListEpisodePageReachParams{
		TenantID:  tenant.ID,
		EpisodeID: episode.ID,
		PageCount: episode.PageCount,
		StartDate: period.start,
		EndDate:   period.end,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the page reach of an episode", err, "tenant_id", tenant.ID.String())
	}

	pages := make([]*publiraadminv1.EpisodePageReach, 0, len(reach))
	for _, page := range reach {
		pages = append(pages, &publiraadminv1.EpisodePageReach{
			PageIndex:   page.PageIndex,
			ReaderCount: page.ReaderCount,
		})
	}
	return &publiraadminv1.GetEpisodeDropOffResponse{
		Pages:     pages,
		PageCount: episode.PageCount,
		StartDate: period.start.Format(time.DateOnly),
		EndDate:   period.end.Format(time.DateOnly),
		TimeZone:  tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries)),
	}, nil
}
