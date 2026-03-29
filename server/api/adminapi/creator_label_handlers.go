package adminapi

import (
	"context"
	"database/sql"
	"errors"
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
		items = append(items, protomapper.Creator(row.PublicID, row.Name, row.ProfileText.String))
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
		items = append(items, protomapper.Label(row.PublicID, row.Name))
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
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "creator_created",
			TargetType:  "creator",
			TargetID:    created.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	return connect.NewResponse(&publiraadminv1.CreateCreatorResponse{Creator: protomapper.Creator(created.PublicID, created.Name, created.ProfileText.String)}), nil
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
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "creator_updated",
			TargetType:  "creator",
			TargetID:    updated.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	return connect.NewResponse(&publiraadminv1.UpdateCreatorResponse{Creator: protomapper.Creator(updated.PublicID, updated.Name, updated.ProfileText.String)}), nil
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
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "label_created",
			TargetType:  "label",
			TargetID:    created.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	return connect.NewResponse(&publiraadminv1.CreateLabelResponse{Label: protomapper.Label(created.PublicID, created.Name)}), nil
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
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "label_updated",
			TargetType:  "label",
			TargetID:    updated.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	return connect.NewResponse(&publiraadminv1.UpdateLabelResponse{Label: protomapper.Label(updated.PublicID, updated.Name)}), nil
}
