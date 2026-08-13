package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	userStatusActive    = "active"
	userStatusSuspended = "suspended"
	userStatusInactive  = "inactive"
)

func tenantIDs(publicID string) []string {
	if publicID == "" {
		return []string{}
	}
	return []string{publicID}
}

func newEndUser(publicID, name, email, status string, createdAt time.Time, tenantPublicID, tenantName string) *publirasplatformv1.EndUser {
	return &publirasplatformv1.EndUser{
		PublicId:   publicID,
		Name:       name,
		Email:      email,
		Status:     status,
		CreatedAt:  createdAt.UTC().Format("2006-01-02T15:04:05Z"),
		TenantIds:  tenantIDs(tenantPublicID),
		TenantName: tenantName,
	}
}

func endUserFromListRow(u dbmodels.ListEndUsersRow) *publirasplatformv1.EndUser {
	return newEndUser(u.PublicID, u.Name, u.Email, u.Status, u.CreatedAt, u.TenantPublicID, u.TenantName)
}

func (s *platformServer) endUserTenant(ctx context.Context, userID uuid.UUID) (publicID, name string, err error) {
	tenant, err := s.queriesFor(ctx).GetTenantByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", nil
		}
		return "", "", connect.NewError(connect.CodeInternal, err)
	}
	return tenant.PublicID, tenant.Name, nil
}

func normalizePublicIDs(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(values))
	publicIDs := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		publicIDs = append(publicIDs, trimmed)
	}

	if len(publicIDs) == 0 {
		return nil
	}

	return publicIDs
}

func (s *platformServer) ensureManageableEndUser(ctx context.Context, userID string) (dbmodels.GetUserByPublicIDRow, error) {
	user, err := s.queriesFor(ctx).GetUserByPublicID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetUserByPublicIDRow{}, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return dbmodels.GetUserByPublicIDRow{}, connect.NewError(connect.CodeInternal, err)
	}

	tenantRoles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return dbmodels.GetUserByPublicIDRow{}, connect.NewError(connect.CodeInternal, err)
	}
	if len(tenantRoles) > 0 {
		return dbmodels.GetUserByPublicIDRow{}, connect.NewError(connect.CodePermissionDenied, errors.New("cannot operate tenant member users"))
	}

	return user, nil
}

func (s *platformServer) ListEndUsers(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListEndUsersRequest],
) (*connect.Response[publirasplatformv1.ListEndUsersResponse], error) {
	// Platform管理権限チェック
	if _, _, _, err := s.authenticatePlatformSession(ctx, "", req.Header()); err != nil {
		return nil, err
	}

	limit := req.Msg.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	offset := req.Msg.Offset
	if offset < 0 {
		offset = 0
	}

	// フィルタパラメータを処理
	var createdAfterFilter sql.NullTime
	if req.Msg.CreatedAfter != "" {
		t, err := time.Parse(time.RFC3339, req.Msg.CreatedAfter)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid created_after format"))
		}
		createdAfterFilter = sql.NullTime{Time: t, Valid: true}
	}
	var createdBeforeFilter sql.NullTime
	if req.Msg.CreatedBefore != "" {
		t, err := time.Parse(time.RFC3339, req.Msg.CreatedBefore)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid created_before format"))
		}
		createdBeforeFilter = sql.NullTime{Time: t, Valid: true}
	}

	filterStatus := strings.TrimSpace(req.Msg.Status)
	publicIDs := normalizePublicIDs(req.Msg.PublicIds)
	filterTenantPublicID := strings.TrimSpace(req.Msg.TenantPublicId)

	users, err := s.queriesFor(ctx).ListEndUsers(ctx, dbmodels.ListEndUsersParams{
		Limit:          limit,
		Offset:         offset,
		CreatedAfter:   createdAfterFilter,
		CreatedBefore:  createdBeforeFilter,
		PublicIds:      publicIDs,
		Status:         sql.NullString{String: filterStatus, Valid: filterStatus != ""},
		TenantPublicID: sql.NullString{String: filterTenantPublicID, Valid: filterTenantPublicID != ""},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &publirasplatformv1.ListEndUsersResponse{
		Users: make([]*publirasplatformv1.EndUser, 0, len(users)),
	}
	for _, u := range users {
		resp.Users = append(resp.Users, endUserFromListRow(u))
	}

	return connect.NewResponse(resp), nil
}

func (s *platformServer) GetEndUser(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.GetEndUserRequest],
) (*connect.Response[publirasplatformv1.GetEndUserResponse], error) {
	// Platform管理権限チェック
	if _, _, _, err := s.authenticatePlatformSession(ctx, "", req.Header()); err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	user, err := s.queriesFor(ctx).GetUserByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tenantPublicID, tenantName, err := s.endUserTenant(ctx, user.ID)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publirasplatformv1.GetEndUserResponse{
		User: newEndUser(user.PublicID, user.Name, user.Email, user.Status, user.CreatedAt, tenantPublicID, tenantName),
	}), nil
}

func (s *platformServer) SuspendEndUser(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.SuspendEndUserRequest],
) (*connect.Response[publirasplatformv1.SuspendEndUserResponse], error) {
	// Platform管理権限チェック
	_, actorUser, actorRole, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	if _, err := s.ensureManageableEndUser(ctx, publicID); err != nil {
		return nil, err
	}

	// ステータスを更新
	updated, err := s.queriesFor(ctx).UpdateUserStatus(ctx, dbmodels.UpdateUserStatusParams{
		PublicID: publicID,
		Status:   userStatusSuspended,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// セッションを失効させる
	if _, err := s.queriesFor(ctx).BumpUserCredentialsVersion(ctx, updated.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tenantPublicID, tenantName, err := s.endUserTenant(ctx, updated.ID)
	if err != nil {
		return nil, err
	}

	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actorUser.ID,
		ActorRole:           actorRole,
		Action:              "user_suspended",
		TargetType:          "user",
		TargetID:            updated.ID.String(),
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.SuspendEndUserResponse{
		User: newEndUser(updated.PublicID, updated.Name, updated.Email, updated.Status, updated.CreatedAt, tenantPublicID, tenantName),
	}), nil
}

func (s *platformServer) UnsuspendEndUser(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UnsuspendEndUserRequest],
) (*connect.Response[publirasplatformv1.UnsuspendEndUserResponse], error) {
	// Platform管理権限チェック
	_, actorUser, actorRole, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	if _, err := s.ensureManageableEndUser(ctx, publicID); err != nil {
		return nil, err
	}

	// ステータスを更新
	updated, err := s.queriesFor(ctx).UpdateUserStatus(ctx, dbmodels.UpdateUserStatusParams{
		PublicID: publicID,
		Status:   userStatusActive,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tenantPublicID, tenantName, err := s.endUserTenant(ctx, updated.ID)
	if err != nil {
		return nil, err
	}

	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actorUser.ID,
		ActorRole:           actorRole,
		Action:              "user_activated",
		TargetType:          "user",
		TargetID:            updated.ID.String(),
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.UnsuspendEndUserResponse{
		User: newEndUser(updated.PublicID, updated.Name, updated.Email, updated.Status, updated.CreatedAt, tenantPublicID, tenantName),
	}), nil
}

func (s *platformServer) DeleteEndUser(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.DeleteEndUserRequest],
) (*connect.Response[publirasplatformv1.DeleteEndUserResponse], error) {
	// Platform管理権限チェック
	_, actorUser, actorRole, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	user, err := s.ensureManageableEndUser(ctx, publicID)
	if err != nil {
		return nil, err
	}

	// ユーザーを物理削除
	if err := s.queriesFor(ctx).DeleteUserByID(ctx, user.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actorUser.ID,
		ActorRole:           actorRole,
		Action:              "user_deleted",
		TargetType:          "user",
		TargetID:            user.ID.String(),
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.DeleteEndUserResponse{
		PublicId: publicID,
	}), nil
}
