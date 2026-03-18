package apiserver

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

func (s *apiServer) CreateSeries(
	ctx context.Context,
	req *connect.Request[publirav1.CreateSeriesRequest],
) (*connect.Response[publirav1.CreateSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	labelID := uuid.NullUUID{}
	if strings.TrimSpace(req.Msg.LabelPublicId) != "" {
		label, err := s.queries.GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.LabelPublicId})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("label not found"))
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		labelID = uuid.NullUUID{UUID: label.ID, Valid: true}
	}
	base, err := s.queries.CreateSeriesBase(ctx, dbmodels.CreateSeriesBaseParams{
		ID: uuid.New(), TenantID: tenant.ID, LabelID: labelID, PublicID: generatePublicID(), Title: req.Msg.Title,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queries.UpsertSeriesListing(ctx, dbmodels.UpsertSeriesListingParams{
		ID: base.ID,
		Synopsis: sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{},
		IsPublished: req.Msg.IsPublished,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.CreateSeriesResponse{Series: &publirav1.Series{
		PublicId: base.PublicID, Title: base.Title, Synopsis: req.Msg.Synopsis,
	}}), nil
}

func (s *apiServer) UpdateSeries(
	ctx context.Context,
	req *connect.Request[publirav1.UpdateSeriesRequest],
) (*connect.Response[publirav1.UpdateSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	current, err := s.queries.GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queries.UpdateSeriesBase(ctx, dbmodels.UpdateSeriesBaseParams{ID: current.ID, Title: req.Msg.Title, LabelID: uuid.NullUUID{}})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queries.UpsertSeriesListing(ctx, dbmodels.UpsertSeriesListingParams{
		ID: current.ID,
		Synopsis: sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{},
		IsPublished: req.Msg.IsPublished,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	updated, err := s.queries.GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.UpdateSeriesResponse{Series: toProtoSeries(updated)}), nil
}

func (s *apiServer) ListSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListSeriesRequest],
) (*connect.Response[publirav1.ListSeriesResponse], error) {
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
	rows, err := s.queries.ListSeriesByTenant(ctx, dbmodels.ListSeriesByTenantParams{TenantID: tenant.ID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirav1.Series, 0, len(rows))
	for _, row := range rows {
		item := &publirav1.Series{PublicId: row.PublicID, Title: row.Title}
		if row.Synopsis.Valid {
			item.Synopsis = row.Synopsis.String
		}
		items = append(items, item)
	}
	return connect.NewResponse(&publirav1.ListSeriesResponse{Series: items}), nil
}

func (s *apiServer) GetSeries(
	ctx context.Context,
	req *connect.Request[publirav1.GetSeriesRequest],
) (*connect.Response[publirav1.GetSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queries.GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.GetSeriesResponse{Series: toProtoSeries(row)}), nil
}

func (s *apiServer) CreateEpisode(
	ctx context.Context,
	req *connect.Request[publirav1.CreateEpisodeRequest],
) (*connect.Response[publirav1.CreateEpisodeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	if req.Msg.OrderIndex <= 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("order_index must be greater than 0"))
	}
	if req.Msg.Price < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("price must be greater than or equal to 0"))
	}
	if req.Msg.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("reading_period_hours must be greater than or equal to 0"))
	}
	scheduledAt, err := parseScheduledAtOrZero(req.Msg.ScheduledAt)
	if err != nil {
		return nil, err
	}
	series, err := s.queries.GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.SeriesPublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	base, err := s.queries.CreateEpisodeBase(ctx, dbmodels.CreateEpisodeBaseParams{ID: uuid.New(), SeriesID: series.ID, PublicID: generatePublicID(), Title: req.Msg.Title, OrderIndex: req.Msg.OrderIndex})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	status := "draft"
	if scheduledAt.Valid {
		status = "scheduled"
	}
	listing, err := s.queries.UpsertEpisodeListing(ctx, dbmodels.UpsertEpisodeListingParams{
		EpisodeID: base.ID,
		Price: req.Msg.Price,
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
		Status: status,
		ScheduledAt: scheduledAt,
		PublishedAt: sql.NullTime{},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	episode := &publirav1.Episode{PublicId: base.PublicID, Title: base.Title, OrderIndex: base.OrderIndex, Price: listing.Price, Status: listing.Status}
	if listing.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = listing.ReadingPeriodHours.Int32
	}
	if listing.ScheduledAt.Valid {
		episode.ScheduledAt = listing.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if listing.PublishedAt.Valid {
		episode.PublishedAt = listing.PublishedAt.Time.UTC().Format(time.RFC3339)
	}
	return connect.NewResponse(&publirav1.CreateEpisodeResponse{Episode: episode}), nil
}

func (s *apiServer) UpdateEpisodePublishSchedule(
	ctx context.Context,
	req *connect.Request[publirav1.UpdateEpisodePublishScheduleRequest],
) (*connect.Response[publirav1.UpdateEpisodePublishScheduleResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	scheduledAt, err := parseScheduledAtOrZero(req.Msg.ScheduledAt)
	if err != nil {
		return nil, err
	}
	err = s.queries.UpdateEpisodePublishScheduleByPublicIDForTenant(ctx, dbmodels.UpdateEpisodePublishScheduleByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.EpisodePublicId, ScheduledAt: scheduledAt})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	ep, err := s.queries.GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.EpisodePublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.UpdateEpisodePublishScheduleResponse{Episode: toProtoEpisode(ep)}), nil
}
