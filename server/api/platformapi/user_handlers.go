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
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
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

type endUserPageRow struct {
	id             uuid.UUID
	publicID       string
	name           string
	email          string
	status         string
	createdAt      time.Time
	tenantPublicID string
	tenantName     string
}

func endUserPageFromDesc(row dbmodels.ListEndUsersDescRow) endUserPageRow {
	return endUserPageRow{
		id:             row.ID,
		publicID:       row.PublicID,
		name:           row.Name,
		email:          row.Email,
		status:         row.Status,
		createdAt:      row.CreatedAt,
		tenantPublicID: row.TenantPublicID,
		tenantName:     row.TenantName,
	}
}

func endUserPageFromAsc(row dbmodels.ListEndUsersAscRow) endUserPageRow {
	return endUserPageRow{
		id:             row.ID,
		publicID:       row.PublicID,
		name:           row.Name,
		email:          row.Email,
		status:         row.Status,
		createdAt:      row.CreatedAt,
		tenantPublicID: row.TenantPublicID,
		tenantName:     row.TenantName,
	}
}

func endUserFromListRow(u endUserPageRow) *publirasplatformv1.EndUser {
	return newEndUser(u.publicID, u.name, u.email, u.status, u.createdAt, u.tenantPublicID, u.tenantName)
}

func (s *platformServer) endUserTenant(ctx context.Context, userID uuid.UUID) (publicID, name string, err error) {
	tenant, err := s.queriesFor(ctx).GetTenantByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", nil
		}
		return "", "", s.internalDBError(ctx, "failed to get tenant by user id", err, "user_id", userID.String())
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
		return dbmodels.GetUserByPublicIDRow{}, s.internalDBError(ctx, "failed to get user by public id", err, "public_id", userID)
	}

	tenantRoles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return dbmodels.GetUserByPublicIDRow{}, s.internalDBError(ctx, "failed to list tenant user roles", err, "user_id", user.ID.String(), "public_id", userID)
	}
	if len(tenantRoles) > 0 {
		return dbmodels.GetUserByPublicIDRow{}, connect.NewError(connect.CodePermissionDenied, errors.New("cannot operate tenant member users"))
	}

	return user, nil
}

type endUserQueryFilters struct {
	createdAfter   sql.NullTime
	createdBefore  sql.NullTime
	publicIDs      []string
	status         sql.NullString
	tenantPublicID sql.NullString
}

func (s *platformServer) endUserPage(
	ctx context.Context,
	filters endUserQueryFilters,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]endUserPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListEndUsersAsc(ctx, dbmodels.ListEndUsersAscParams{
			CreatedAfter:    filters.createdAfter,
			CreatedBefore:   filters.createdBefore,
			PublicIds:       filters.publicIDs,
			Status:          filters.status,
			TenantPublicID:  filters.tenantPublicID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}

		return toPage(rows, endUserPageFromAsc), nil
	}

	rows, err := queries.ListEndUsersDesc(ctx, dbmodels.ListEndUsersDescParams{
		CreatedAfter:    filters.createdAfter,
		CreatedBefore:   filters.createdBefore,
		PublicIds:       filters.publicIDs,
		Status:          filters.status,
		TenantPublicID:  filters.tenantPublicID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}

	return toPage(rows, endUserPageFromDesc), nil
}

func (s *platformServer) ListEndUsers(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListEndUsersRequest],
) (*connect.Response[publirasplatformv1.ListEndUsersResponse], error) {
	// Check for platform operator permission.
	if _, err := s.requirePlatformActor(ctx, req.Header()); err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultListLimit, maxListLimit)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// Build the filter parameters.
	var createdAfterFilter sql.NullTime
	if req.Msg.CreatedAfter != "" {
		t, parseErr := time.Parse(time.RFC3339, req.Msg.CreatedAfter)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid created_after format"))
		}
		createdAfterFilter = sql.NullTime{Time: t, Valid: true}
	}
	var createdBeforeFilter sql.NullTime
	if req.Msg.CreatedBefore != "" {
		t, parseErr := time.Parse(time.RFC3339, req.Msg.CreatedBefore)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid created_before format"))
		}
		createdBeforeFilter = sql.NullTime{Time: t, Valid: true}
	}

	filterStatus := strings.TrimSpace(req.Msg.Status)
	filterTenantPublicID := strings.TrimSpace(req.Msg.TenantPublicId)
	filters := endUserQueryFilters{
		createdAfter:   createdAfterFilter,
		createdBefore:  createdBeforeFilter,
		publicIDs:      normalizePublicIDs(req.Msg.PublicIds),
		status:         sql.NullString{String: filterStatus, Valid: filterStatus != ""},
		tenantPublicID: sql.NullString{String: filterTenantPublicID, Valid: filterTenantPublicID != ""},
	}

	users, err := s.endUserPage(ctx, filters, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list end users", err)
	}
	users, hasMore := pagination.Page(users, limit, cursor.Direction)

	resp := &publirasplatformv1.ListEndUsersResponse{
		Users: make([]*publirasplatformv1.EndUser, 0, len(users)),
	}
	for _, u := range users {
		resp.Users = append(resp.Users, endUserFromListRow(u))
	}
	switch {
	case len(users) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			resp.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, users[0].createdAt, users[0].id)
		}
		if hasNext {
			last := users[len(users)-1]
			resp.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		resp.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		resp.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(resp), nil
}

func (s *platformServer) GetEndUser(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.GetEndUserRequest],
) (*connect.Response[publirasplatformv1.GetEndUserResponse], error) {
	// Check for platform operator permission.
	if _, err := s.requirePlatformActor(ctx, req.Header()); err != nil {
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
		return nil, s.internalDBError(ctx, "failed to get end user", err, "public_id", publicID)
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
	// Check for platform operator permission.
	actor, err := s.requirePlatformWriteActor(ctx, req.Header())
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

	// Update the status.
	updated, err := s.queriesFor(ctx).UpdateUserStatus(ctx, dbmodels.UpdateUserStatusParams{
		PublicID: publicID,
		Status:   userStatusSuspended,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to suspend end user", err, "public_id", publicID)
	}

	// Invalidate the existing sessions.
	if _, err := s.queriesFor(ctx).BumpUserCredentialsVersion(ctx, updated.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to bump end user credentials version", err, "user_id", updated.ID.String(), "public_id", publicID)
	}

	tenantPublicID, tenantName, err := s.endUserTenant(ctx, updated.ID)
	if err != nil {
		return nil, err
	}

	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
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
	// Check for platform operator permission.
	actor, err := s.requirePlatformWriteActor(ctx, req.Header())
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

	// Update the status.
	updated, err := s.queriesFor(ctx).UpdateUserStatus(ctx, dbmodels.UpdateUserStatusParams{
		PublicID: publicID,
		Status:   userStatusActive,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, s.internalDBError(ctx, "failed to unsuspend end user", err, "public_id", publicID)
	}

	tenantPublicID, tenantName, err := s.endUserTenant(ctx, updated.ID)
	if err != nil {
		return nil, err
	}

	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
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
	// Check for platform operator permission.
	actor, err := s.requirePlatformWriteActor(ctx, req.Header())
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

	// Delete the user row itself.
	if err := s.queriesFor(ctx).DeleteUserByID(ctx, user.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to delete end user", err, "user_id", user.ID.String(), "public_id", publicID)
	}

	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
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
