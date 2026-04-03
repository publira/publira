package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

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
) ([]dbmodels.ListCreatorsByPublicIDsForTenantRow, error) {
	normalized, err := normalizePublicIDs(creatorPublicIDs)
	if err != nil {
		return nil, err
	}
	if len(normalized) == 0 {
		return []dbmodels.ListCreatorsByPublicIDsForTenantRow{}, nil
	}
	rows, err := s.queriesFor(ctx).ListCreatorsByPublicIDsForTenant(ctx, dbmodels.ListCreatorsByPublicIDsForTenantParams{
		TenantID:  tenantID,
		PublicIds: normalized,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(rows) != len(normalized) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator not found"))
	}
	byPublicID := make(map[string]dbmodels.ListCreatorsByPublicIDsForTenantRow, len(rows))
	for _, row := range rows {
		byPublicID[row.PublicID] = row
	}
	ordered := make([]dbmodels.ListCreatorsByPublicIDsForTenantRow, 0, len(normalized))
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
		if err := s.queriesFor(ctx).DeleteSeriesCreatorsBySeriesID(ctx, seriesID); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	creators, err := s.resolveCreatorsByPublicIDs(ctx, tenantID, creatorPublicIDs)
	if err != nil {
		return nil, err
	}
	items := make([]*publirattypesv1.Creator, 0, len(creators))
	for index, creator := range creators {
		err := s.queriesFor(ctx).CreateSeriesCreator(ctx, dbmodels.CreateSeriesCreatorParams{
			SeriesID:     seriesID,
			CreatorID:    creator.ID,
			Role:         "creator",
			DisplayOrder: int32(index),
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		items = append(items, protomapper.Creator(creator.PublicID, creator.Name, creator.ProfileText.String))
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
	rows, err := s.queriesFor(ctx).ListSeriesCreatorsBySeriesIDs(ctx, seriesIDs)
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

func seriesRevalidateTags(tenantPublicID, seriesPublicID string) []string {
	normalizedTenantPublicID := strings.TrimSpace(tenantPublicID)
	normalizedSeriesPublicID := strings.TrimSpace(seriesPublicID)
	return []string{
		fmt.Sprintf("tenant:%s:public:site", normalizedTenantPublicID),
		fmt.Sprintf("tenant:%s:catalog:series:list", normalizedTenantPublicID),
		fmt.Sprintf("tenant:%s:catalog:series:detail", normalizedTenantPublicID),
		fmt.Sprintf("tenant:%s:catalog:series:%s", normalizedTenantPublicID, normalizedSeriesPublicID),
		fmt.Sprintf("tenant:%s:catalog:authors", normalizedTenantPublicID),
	}
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
		label, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.LabelPublicId})
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
	base, err := s.queriesFor(ctx).CreateSeriesBase(ctx, dbmodels.CreateSeriesBaseParams{
		ID: seriesID, TenantID: tenant.ID, LabelID: labelID, PublicID: generatePublicID(), Title: req.Msg.Title,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queriesFor(ctx).UpsertSeriesListing(ctx, dbmodels.UpsertSeriesListingParams{
		SeriesID:           base.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queriesFor(ctx).UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{
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
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "series_created",
			TargetType:  "series",
			TargetID:    base.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if req.Msg.IsPublished && s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, tenant.PublicID, tenant.Domain, seriesRevalidateTags(tenant.PublicID, base.PublicID)); err != nil {
			s.logger.Warn("failed to request next revalidate after series create", "tenant_public_id", tenant.PublicID, "series_public_id", base.PublicID, "error", err)
		}
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
	current, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	labelPublicID := strings.TrimSpace(req.Msg.LabelPublicId)
	if labelPublicID == "" && current.LabelPublicID.Valid {
		labelPublicID = current.LabelPublicID.String
	}
	labelID := uuid.NullUUID{}
	if labelPublicID != "" {
		label, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: labelPublicID})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("label not found"))
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		labelID = uuid.NullUUID{UUID: label.ID, Valid: true}
	}
	err = s.queriesFor(ctx).UpdateSeriesBase(ctx, dbmodels.UpdateSeriesBaseParams{ID: current.ID, Title: req.Msg.Title, LabelID: labelID})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queriesFor(ctx).UpsertSeriesListing(ctx, dbmodels.UpsertSeriesListingParams{
		SeriesID:           current.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queriesFor(ctx).UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{
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
	updated, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "series_updated",
			TargetType:  "series",
			TargetID:    current.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if s.reval != nil {
		if current.IsPublished || req.Msg.IsPublished {
			if err := s.reval.RevalidateTags(ctx, tenant.PublicID, tenant.Domain, seriesRevalidateTags(tenant.PublicID, current.PublicID)); err != nil {
				s.logger.Warn("failed to request next revalidate after series update", "tenant_public_id", tenant.PublicID, "series_public_id", current.PublicID, "error", err)
			}
		}
	}
	series := protomapper.SeriesFromGetSeriesByPublicIDForTenantRow(updated)
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
	rows, err := s.queriesFor(ctx).ListSeriesByTenant(ctx, dbmodels.ListSeriesByTenantParams{TenantID: tenant.ID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirattypesv1.Series, 0, len(rows))
	seriesIDs := make([]uuid.UUID, 0, len(rows))
	itemByID := make(map[uuid.UUID]*publirattypesv1.Series, len(rows))
	for _, row := range rows {
		item := &publirattypesv1.Series{PublicId: row.PublicID, Title: row.Title}
		if row.LabelPublicID.Valid {
			item.Label = protomapper.Label(row.LabelPublicID.String, row.LabelName.String)
		}
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

func (s *adminServer) GetSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetSeriesRequest],
) (*connect.Response[publiraadminv1.GetSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
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
	series := protomapper.SeriesFromGetSeriesByPublicIDForTenantRow(row)
	series.Creators = creatorsBySeriesID[row.ID]
	return connect.NewResponse(&publiraadminv1.GetSeriesResponse{Series: series}), nil
}
