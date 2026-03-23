package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

func toProtoSeries(row dbmodels.GetSeriesByPublicIDForTenantRow) *publirattypesv1.Series {
	series := &publirattypesv1.Series{
		PublicId: row.PublicID,
		Title:    row.Title,
	}
	if row.Synopsis.Valid {
		series.Synopsis = row.Synopsis.String
	}
	if row.ReadingPeriodHours.Valid {
		series.ReadingPeriodHours = row.ReadingPeriodHours.Int32
	}
	return series
}

func toProtoEpisode(row dbmodels.GetEpisodeByPublicIDForTenantRow) *publirattypesv1.Episode {
	episode := &publirattypesv1.Episode{
		PublicId:   row.PublicID,
		Title:      row.Title,
		OrderIndex: row.OrderIndex,
		Price:      row.Price,
		Status:     row.Status,
	}
	if row.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = row.ReadingPeriodHours.Int32
	}
	if row.ScheduledAt.Valid {
		episode.ScheduledAt = row.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if row.PublishedAt.Valid {
		episode.PublishedAt = row.PublishedAt.Time.UTC().Format(time.RFC3339)
	}
	return episode
}

func toProtoEpisodeImage(row dbmodels.EpisodeImage) *publirattypesv1.EpisodeImage {
	return &publirattypesv1.EpisodeImage{
		Id:            row.ID.String(),
		ImageUrl:      row.ImageUrl,
		ContentType:   row.ContentType,
		FileSizeBytes: row.FileSizeBytes,
		DisplayOrder:  row.DisplayOrder,
		Width:         row.Width,
		Height:        row.Height,
	}
}

func toProtoCreator(publicID, name string) *publirattypesv1.Creator {
	return &publirattypesv1.Creator{
		PublicId: publicID,
		Name:     name,
	}
}

func toProtoLabel(publicID, name string) *publirattypesv1.Label {
	return &publirattypesv1.Label{
		PublicId: publicID,
		Name:     name,
	}
}

func normalizePublicIDs(publicIDs []string) ([]string, error) {
	normalized := make([]string, 0, len(publicIDs))
	seen := make(map[string]struct{}, len(publicIDs))
	for _, value := range publicIDs {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator_public_ids contains empty value"))
		}
		if _, ok := seen[trimmed]; ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator_public_ids contains duplicate value"))
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized, nil
}

func (s *adminServer) resolveCreatorsByPublicIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	creatorPublicIDs []string,
) ([]dbmodels.Creator, error) {
	normalized, err := normalizePublicIDs(creatorPublicIDs)
	if err != nil {
		return nil, err
	}
	if len(normalized) == 0 {
		return []dbmodels.Creator{}, nil
	}
	rows, err := s.queries.ListCreatorsByPublicIDsForTenant(ctx, dbmodels.ListCreatorsByPublicIDsForTenantParams{
		TenantID:  tenantID,
		PublicIds: normalized,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(rows) != len(normalized) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator not found"))
	}
	byPublicID := make(map[string]dbmodels.Creator, len(rows))
	for _, row := range rows {
		byPublicID[row.PublicID] = row
	}
	ordered := make([]dbmodels.Creator, 0, len(normalized))
	for _, publicID := range normalized {
		creator, ok := byPublicID[publicID]
		if !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator not found"))
		}
		ordered = append(ordered, creator)
	}
	return ordered, nil
}

func (s *adminServer) syncSeriesCreators(
	ctx context.Context,
	tenantID, seriesID uuid.UUID,
	creatorPublicIDs []string,
	replace bool,
) ([]*publirattypesv1.Creator, error) {
	if replace {
		if err := s.queries.DeleteSeriesCreatorsBySeriesID(ctx, seriesID); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	creators, err := s.resolveCreatorsByPublicIDs(ctx, tenantID, creatorPublicIDs)
	if err != nil {
		return nil, err
	}
	items := make([]*publirattypesv1.Creator, 0, len(creators))
	for index, creator := range creators {
		err := s.queries.CreateSeriesCreator(ctx, dbmodels.CreateSeriesCreatorParams{
			SeriesID:     seriesID,
			CreatorID:    creator.ID,
			Role:         "creator",
			DisplayOrder: int32(index),
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		items = append(items, toProtoCreator(creator.PublicID, creator.Name))
	}
	return items, nil
}

func (s *adminServer) seriesCreatorsBySeriesIDs(
	ctx context.Context,
	seriesIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.Creator, error) {
	if len(seriesIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.Creator{}, nil
	}
	rows, err := s.queries.ListSeriesCreatorsBySeriesIDs(ctx, seriesIDs)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make(map[uuid.UUID][]*publirattypesv1.Creator, len(seriesIDs))
	for _, row := range rows {
		items[row.SeriesID] = append(items[row.SeriesID], &publirattypesv1.Creator{
			PublicId: row.PublicID,
			Name:     row.Name,
			Role:     row.Role,
		})
	}
	return items, nil
}

func generatePublicID() string {
	raw := strings.ReplaceAll(uuid.NewString(), "-", "")
	return strings.ToUpper(raw[:12])
}

func parseScheduledAtOrZero(value string) (sql.NullTime, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullTime{}, nil
	}
	t, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("scheduled_at must be RFC3339"))
	}
	return sql.NullTime{Time: t, Valid: true}, nil
}

func normalizeAndValidateScheduledAt(scheduledAt sql.NullTime, now time.Time) (sql.NullTime, error) {
	if !scheduledAt.Valid {
		return scheduledAt, nil
	}
	normalized := scheduledAt.Time.UTC()
	if !normalized.After(now.UTC()) {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("scheduled_at must be in the future"))
	}
	return sql.NullTime{Time: normalized, Valid: true}, nil
}

func (s *adminServer) CreateSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateSeriesRequest],
) (*connect.Response[publiraadminv1.CreateSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	if req.Msg.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("reading_period_hours must be greater than or equal to 0"))
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
	seriesID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	base, err := s.queries.CreateSeriesBase(ctx, dbmodels.CreateSeriesBaseParams{
		ID: seriesID, TenantID: tenant.ID, LabelID: labelID, PublicID: generatePublicID(), Title: req.Msg.Title,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queries.UpsertSeriesListing(ctx, dbmodels.UpsertSeriesListingParams{
		SeriesID:           base.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queries.UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{
		ID:          base.ID,
		IsPublished: req.Msg.IsPublished,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	creators, err := s.syncSeriesCreators(ctx, tenant.ID, base.ID, req.Msg.CreatorPublicIds, false)
	if err != nil {
		return nil, err
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.Record(ctx, auditlog.Entry{
			ActorUserPublicID: sessionCtx.User.PublicID,
			ActorRole:         sessionCtx.Role,
			TenantPublicID:    tenant.PublicID,
			Action:            "series_created",
			TargetType:        "series",
			TargetID:          base.PublicID,
			Outcome:           auditlog.OutcomeSuccess,
			ClientIP:          auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	return connect.NewResponse(&publiraadminv1.CreateSeriesResponse{Series: &publirattypesv1.Series{
		PublicId: base.PublicID, Title: base.Title, Synopsis: req.Msg.Synopsis, ReadingPeriodHours: req.Msg.ReadingPeriodHours, Creators: creators,
	}}), nil
}

func (s *adminServer) UpdateSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateSeriesRequest],
) (*connect.Response[publiraadminv1.UpdateSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	if req.Msg.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("reading_period_hours must be greater than or equal to 0"))
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
		SeriesID:           current.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queries.UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{
		ID:          current.ID,
		IsPublished: req.Msg.IsPublished,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	creators, err := s.syncSeriesCreators(ctx, tenant.ID, current.ID, req.Msg.CreatorPublicIds, true)
	if err != nil {
		return nil, err
	}
	updated, err := s.queries.GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.Record(ctx, auditlog.Entry{
			ActorUserPublicID: sessionCtx.User.PublicID,
			ActorRole:         sessionCtx.Role,
			TenantPublicID:    tenant.PublicID,
			Action:            "series_updated",
			TargetType:        "series",
			TargetID:          current.PublicID,
			Outcome:           auditlog.OutcomeSuccess,
			ClientIP:          auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	series := toProtoSeries(updated)
	series.Creators = creators
	return connect.NewResponse(&publiraadminv1.UpdateSeriesResponse{Series: series}), nil
}

func (s *adminServer) ListSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListSeriesRequest],
) (*connect.Response[publiraadminv1.ListSeriesResponse], error) {
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
	items := make([]*publirattypesv1.Series, 0, len(rows))
	seriesIDs := make([]uuid.UUID, 0, len(rows))
	itemByID := make(map[uuid.UUID]*publirattypesv1.Series, len(rows))
	for _, row := range rows {
		item := &publirattypesv1.Series{PublicId: row.PublicID, Title: row.Title}
		if row.Synopsis.Valid {
			item.Synopsis = row.Synopsis.String
		}
		if row.ReadingPeriodHours.Valid {
			item.ReadingPeriodHours = row.ReadingPeriodHours.Int32
		}
		seriesIDs = append(seriesIDs, row.ID)
		itemByID[row.ID] = item
		items = append(items, item)
	}
	creatorsBySeriesID, err := s.seriesCreatorsBySeriesIDs(ctx, seriesIDs)
	if err != nil {
		return nil, err
	}
	for seriesID, creators := range creatorsBySeriesID {
		if item, ok := itemByID[seriesID]; ok {
			item.Creators = creators
		}
	}
	defaultReadingPeriodHours := int32(0)
	if tenant.DefaultReadingPeriodHours.Valid {
		defaultReadingPeriodHours = tenant.DefaultReadingPeriodHours.Int32
	}
	return connect.NewResponse(&publiraadminv1.ListSeriesResponse{
		Series:                    items,
		DefaultReadingPeriodHours: defaultReadingPeriodHours,
	}), nil
}

func (s *adminServer) ListCreators(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListCreatorsRequest],
) (*connect.Response[publiraadminv1.ListCreatorsResponse], error) {
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
	rows, err := s.queries.ListCreatorsByTenant(ctx, dbmodels.ListCreatorsByTenantParams{TenantID: tenant.ID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirattypesv1.Creator, 0, len(rows))
	for _, row := range rows {
		items = append(items, toProtoCreator(row.PublicID, row.Name))
	}
	return connect.NewResponse(&publiraadminv1.ListCreatorsResponse{Creators: items}), nil
}

func (s *adminServer) ListLabels(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListLabelsRequest],
) (*connect.Response[publiraadminv1.ListLabelsResponse], error) {
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
	rows, err := s.queries.ListLabelsByTenant(ctx, dbmodels.ListLabelsByTenantParams{TenantID: tenant.ID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirattypesv1.Label, 0, len(rows))
	for _, row := range rows {
		items = append(items, toProtoLabel(row.PublicID, row.Name))
	}
	return connect.NewResponse(&publiraadminv1.ListLabelsResponse{Labels: items}), nil
}

func (s *adminServer) CreateCreator(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateCreatorRequest],
) (*connect.Response[publiraadminv1.CreateCreatorResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	creatorID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	created, err := s.queries.CreateCreator(ctx, dbmodels.CreateCreatorParams{
		ID:          creatorID,
		TenantID:    tenant.ID,
		PublicID:    generatePublicID(),
		Name:        req.Msg.Name,
		ProfileText: sql.NullString{String: req.Msg.ProfileText, Valid: strings.TrimSpace(req.Msg.ProfileText) != ""},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publiraadminv1.CreateCreatorResponse{Creator: toProtoCreator(created.PublicID, created.Name)}), nil
}

func (s *adminServer) UpdateCreator(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateCreatorRequest],
) (*connect.Response[publiraadminv1.UpdateCreatorResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	current, err := s.queries.GetCreatorByPublicIDForTenant(ctx, dbmodels.GetCreatorByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("creator not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queries.UpdateCreator(ctx, dbmodels.UpdateCreatorParams{
		ID:          current.ID,
		Name:        req.Msg.Name,
		ProfileText: sql.NullString{String: req.Msg.ProfileText, Valid: strings.TrimSpace(req.Msg.ProfileText) != ""},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	updated, err := s.queries.GetCreatorByPublicIDForTenant(ctx, dbmodels.GetCreatorByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("creator not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publiraadminv1.UpdateCreatorResponse{Creator: toProtoCreator(updated.PublicID, updated.Name)}), nil
}

func (s *adminServer) CreateLabel(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateLabelRequest],
) (*connect.Response[publiraadminv1.CreateLabelResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	labelID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	created, err := s.queries.CreateLabel(ctx, dbmodels.CreateLabelParams{
		ID:       labelID,
		TenantID: tenant.ID,
		PublicID: generatePublicID(),
		Name:     req.Msg.Name,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publiraadminv1.CreateLabelResponse{Label: toProtoLabel(created.PublicID, created.Name)}), nil
}

func (s *adminServer) UpdateLabel(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateLabelRequest],
) (*connect.Response[publiraadminv1.UpdateLabelResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	current, err := s.queries.GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("label not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queries.UpdateLabel(ctx, dbmodels.UpdateLabelParams{ID: current.ID, Name: req.Msg.Name})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	updated, err := s.queries.GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("label not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publiraadminv1.UpdateLabelResponse{Label: toProtoLabel(updated.PublicID, updated.Name)}), nil
}

func (s *adminServer) GetSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetSeriesRequest],
) (*connect.Response[publiraadminv1.GetSeriesResponse], error) {
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
	creatorsBySeriesID, err := s.seriesCreatorsBySeriesIDs(ctx, []uuid.UUID{row.ID})
	if err != nil {
		return nil, err
	}
	series := toProtoSeries(row)
	series.Creators = creatorsBySeriesID[row.ID]
	return connect.NewResponse(&publiraadminv1.GetSeriesResponse{Series: series}), nil
}

func (s *adminServer) CreateEpisode(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateEpisodeRequest],
) (*connect.Response[publiraadminv1.CreateEpisodeResponse], error) {
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
	scheduledAt, err = normalizeAndValidateScheduledAt(scheduledAt, time.Now())
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
	episodeID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	base, err := s.queries.CreateEpisodeBase(ctx, dbmodels.CreateEpisodeBaseParams{ID: episodeID, SeriesID: series.ID, PublicID: generatePublicID(), Title: req.Msg.Title, OrderIndex: req.Msg.OrderIndex})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	status := "draft"
	if scheduledAt.Valid {
		status = "scheduled"
	}
	listing, err := s.queries.UpsertEpisodeListing(ctx, dbmodels.UpsertEpisodeListingParams{
		EpisodeID:          base.ID,
		Price:              req.Msg.Price,
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
		Status:             status,
		ScheduledAt:        scheduledAt,
		PublishedAt:        sql.NullTime{},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	episode := &publirattypesv1.Episode{PublicId: base.PublicID, Title: base.Title, OrderIndex: base.OrderIndex, Price: listing.Price, Status: listing.Status}
	if listing.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = listing.ReadingPeriodHours.Int32
	}
	if listing.ScheduledAt.Valid {
		episode.ScheduledAt = listing.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if listing.PublishedAt.Valid {
		episode.PublishedAt = listing.PublishedAt.Time.UTC().Format(time.RFC3339)
	}
	return connect.NewResponse(&publiraadminv1.CreateEpisodeResponse{Episode: episode}), nil
}

func (s *adminServer) UploadEpisodeImages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UploadEpisodeImagesRequest],
) (*connect.Response[publiraadminv1.UploadEpisodeImagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if len(req.Msg.Images) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("images are required"))
	}
	episode, err := s.queries.GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.EpisodePublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirattypesv1.EpisodeImage, 0, len(req.Msg.Images))
	for index, imageUpload := range req.Msg.Images {
		if len(imageUpload.Data) == 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d].data is required", index))
		}
		contentType := strings.TrimSpace(imageUpload.ContentType)
		if contentType == "" {
			contentType = http.DetectContentType(imageUpload.Data)
		}
		if !strings.HasPrefix(contentType, "image/") {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d].content_type must be image/*", index))
		}
		imageConfig, _, err := image.DecodeConfig(bytes.NewReader(imageUpload.Data))
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d] is not a decodable image", index))
		}
		if imageConfig.Width <= 0 || imageConfig.Height <= 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d] has invalid dimensions", index))
		}
		displayOrder := imageUpload.DisplayOrder
		if displayOrder < 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d].display_order must be >= 0", index))
		}
		ext := strings.ToLower(filepath.Ext(strings.TrimSpace(imageUpload.Filename)))
		if ext == "" {
			ext = ".bin"
		}
		objectKey := fmt.Sprintf("tenants/%s/episodes/%s/%s%s", tenant.PublicID, req.Msg.EpisodePublicId, uuid.NewString(), ext)
		uploaded, err := s.storage.Upload(ctx, storage.UploadRequest{ObjectKey: objectKey, ContentType: contentType, Data: imageUpload.Data})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		episodeImageID, err := uuid.NewV7()
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		created, err := s.queries.CreateEpisodeImage(ctx, dbmodels.CreateEpisodeImageParams{
			ID:              episodeImageID,
			TenantID:        tenant.ID,
			EpisodeID:       episode.ID,
			StorageProvider: uploaded.Provider,
			ObjectKey:       uploaded.ObjectKey,
			ImageUrl:        uploaded.URL,
			ContentType:     contentType,
			FileSizeBytes:   uploaded.SizeBytes,
			DisplayOrder:    displayOrder,
			Width:           int32(imageConfig.Width),
			Height:          int32(imageConfig.Height),
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		items = append(items, toProtoEpisodeImage(created))
	}
	return connect.NewResponse(&publiraadminv1.UploadEpisodeImagesResponse{Images: items}), nil
}

func (s *adminServer) UpdateEpisodePublishSchedule(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateEpisodePublishScheduleRequest],
) (*connect.Response[publiraadminv1.UpdateEpisodePublishScheduleResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	scheduledAt, err := parseScheduledAtOrZero(req.Msg.ScheduledAt)
	if err != nil {
		return nil, err
	}
	scheduledAt, err = normalizeAndValidateScheduledAt(scheduledAt, time.Now())
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
	return connect.NewResponse(&publiraadminv1.UpdateEpisodePublishScheduleResponse{Episode: toProtoEpisode(ep)}), nil
}
