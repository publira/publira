package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"connectrpc.com/connect"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

type creatorJSON struct {
	Name string `json:"name"`
	Role string `json:"role"`
}

type episodeJSON struct {
	PublicID           string  `json:"public_id"`
	Title              string  `json:"title"`
	OrderIndex         int32   `json:"order_index"`
	Price              int32   `json:"price"`
	ReadingPeriodHours *int32  `json:"reading_period_hours"`
	Status             string  `json:"status"`
	ScheduledAt        *string `json:"scheduled_at"`
	PublishedAt        *string `json:"published_at"`
}

func (s *apiServer) ListPublishedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedSeriesRequest],
) (*connect.Response[publirav1.ListPublishedSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := req.Msg.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := req.Msg.Offset
	if offset < 0 {
		offset = 0
	}
	rows, err := s.queries.ListActiveSeries(ctx, dbmodels.ListActiveSeriesParams{TenantID: tenant.ID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirattypesv1.Series, 0, len(rows))
	for _, row := range rows {
		item := &publirattypesv1.Series{PublicId: row.PublicID, Title: row.Title}
		if row.Synopsis.Valid {
			item.Synopsis = row.Synopsis.String
		}
		items = append(items, item)
	}
	return connect.NewResponse(&publirav1.ListPublishedSeriesResponse{Series: items}), nil
}

func (s *apiServer) GetSeriesDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetSeriesDetailRequest],
) (*connect.Response[publirav1.GetSeriesDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queries.GetSeriesDetail(ctx, dbmodels.GetSeriesDetailParams{PublicID: req.Msg.PublicId, TenantID: tenant.ID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !row.IsPublished || !row.PublishedAt.Valid || row.PublishedAt.Time.After(time.Now()) {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("series is not published"))
	}

	creators := make([]creatorJSON, 0)
	if len(row.Creators) > 0 {
		if err := json.Unmarshal(row.Creators, &creators); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	episodes := make([]episodeJSON, 0)
	if len(row.Episodes) > 0 {
		if err := json.Unmarshal(row.Episodes, &episodes); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	res := connect.NewResponse(&publirav1.GetSeriesDetailResponse{
		Series:   &publirattypesv1.Series{PublicId: row.PublicID, Title: row.Title},
		Episodes: make([]*publirattypesv1.Episode, 0, len(episodes)),
	})
	if row.Synopsis.Valid {
		res.Msg.Series.Synopsis = row.Synopsis.String
	}
	if row.LabelName.Valid {
		res.Msg.Series.Label = &publirattypesv1.Label{Name: row.LabelName.String}
	}
	res.Msg.Series.Creators = make([]*publirattypesv1.Creator, 0, len(creators))
	for _, creator := range creators {
		res.Msg.Series.Creators = append(res.Msg.Series.Creators, &publirattypesv1.Creator{Name: creator.Name, Role: creator.Role})
	}
	for _, episode := range episodes {
		item := &publirattypesv1.Episode{
			PublicId:   episode.PublicID,
			Title:      episode.Title,
			OrderIndex: episode.OrderIndex,
			Price:      episode.Price,
			Status:     episode.Status,
		}
		if episode.ReadingPeriodHours != nil {
			item.ReadingPeriodHours = *episode.ReadingPeriodHours
		}
		if episode.ScheduledAt != nil {
			item.ScheduledAt = *episode.ScheduledAt
		}
		if episode.PublishedAt != nil {
			item.PublishedAt = *episode.PublishedAt
		}
		res.Msg.Episodes = append(res.Msg.Episodes, item)
	}
	return res, nil
}

func (s *apiServer) GetEpisodeDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetEpisodeDetailRequest],
) (*connect.Response[publirav1.GetEpisodeDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queries.GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.GetEpisodeDetailResponse{Episode: toProtoEpisode(row)}), nil
}
