package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
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

func newEndUser(id uuid.UUID, publicID, name, email, status string, createdAt time.Time, tenantPublicID, tenantName string) *publirasplatformv1.EndUser {
	return &publirasplatformv1.EndUser{
		Id:         id.String(),
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
	return newEndUser(u.id, u.publicID, u.name, u.email, u.status, u.createdAt, u.tenantPublicID, u.tenantName)
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

func parseEndUserID(raw string) (uuid.UUID, error) {
	id := strings.TrimSpace(raw)
	if id == "" {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_id is required"))
	}
	parsed, err := uuid.Parse(id)
	if err != nil {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_id is not an identifier"))
	}
	return parsed, nil
}

// ensureManageableEndUser reads the user a request names, refusing a tenant
// member, whom only the tenant manages.
func (s *platformServer) ensureManageableEndUser(ctx context.Context, userID uuid.UUID) (dbmodels.User, error) {
	user, err := s.queriesFor(ctx).GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.User{}, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return dbmodels.User{}, s.internalDBError(ctx, "failed to get user", err, "user_id", userID.String())
	}

	tenantRoles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return dbmodels.User{}, s.internalDBError(ctx, "failed to list tenant user roles", err, "user_id", user.ID.String())
	}
	if len(tenantRoles) > 0 {
		return dbmodels.User{}, connect.NewError(connect.CodePermissionDenied, errors.New("cannot operate tenant member users"))
	}

	return user, nil
}

// parseUserIDs reads the user_ids filter, refusing a value that is not a
// primary key rather than matching nothing for it.
func parseUserIDs(values []string) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0, len(values))
	seen := make(map[uuid.UUID]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		id, err := uuid.Parse(trimmed)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_ids contains a value that is not an identifier"))
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, nil
	}
	return ids, nil
}

func uuidStrings(ids []uuid.UUID) []string {
	values := make([]string, len(ids))
	for index, id := range ids {
		values[index] = id.String()
	}
	return values
}

type endUserQueryFilters struct {
	createdAfter   sql.NullTime
	createdBefore  sql.NullTime
	userIDs        []uuid.UUID
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
			Ids:             filters.userIDs,
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
		Ids:             filters.userIDs,
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

	userIDs, err := parseUserIDs(req.Msg.UserIds)
	if err != nil {
		return nil, err
	}
	filterStatus := strings.TrimSpace(req.Msg.Status)
	filterTenantPublicID := strings.TrimSpace(req.Msg.TenantPublicId)
	filters := endUserQueryFilters{
		createdAfter:   createdAfterFilter,
		createdBefore:  createdBeforeFilter,
		userIDs:        userIDs,
		status:         sql.NullString{String: filterStatus, Valid: filterStatus != ""},
		tenantPublicID: sql.NullString{String: filterTenantPublicID, Valid: filterTenantPublicID != ""},
	}
	listKey := pagination.NewListKey("created_at_desc").
		Time("created_after", createdAfterFilter.Time, createdAfterFilter.Valid).
		Time("created_before", createdBeforeFilter.Time, createdBeforeFilter.Valid).
		Value("status", filterStatus).
		Values("user_ids", uuidStrings(userIDs)).
		Value("tenant_public_id", filterTenantPublicID)
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = listKey.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, rpcerrors.NewPageTokenError(err)
		}
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
			resp.PreviousToken = listKey.EncodeTimeUUID(pagination.Backward, users[0].createdAt, users[0].id)
		}
		if hasNext {
			last := users[len(users)-1]
			resp.NextToken = listKey.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		resp.PreviousToken = listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		resp.NextToken = listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
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
		User: newEndUser(user.ID, user.PublicID, user.Name, user.Email, user.Status, user.CreatedAt, tenantPublicID, tenantName),
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

	userID, err := parseEndUserID(req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	user, err := s.ensureManageableEndUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Update the status.
	updated, err := s.queriesFor(ctx).UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{
		ID:     user.ID,
		Status: userStatusSuspended,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to suspend end user", err, "user_id", user.ID.String())
	}

	// Invalidate the existing sessions.
	if _, err := s.queriesFor(ctx).BumpUserCredentialsVersion(ctx, updated.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to bump end user credentials version", err, "user_id", updated.ID.String())
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
		User: newEndUser(updated.ID, updated.PublicID, updated.Name, updated.Email, updated.Status, updated.CreatedAt, tenantPublicID, tenantName),
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

	userID, err := parseEndUserID(req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	user, err := s.ensureManageableEndUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	updated, err := s.queriesFor(ctx).UnsuspendUserByID(ctx, user.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, s.internalDBError(ctx, "failed to unsuspend end user", err, "user_id", user.ID.String())
	}

	tenantPublicID, tenantName, err := s.endUserTenant(ctx, updated.ID)
	if err != nil {
		return nil, err
	}

	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
		Action:              "user_unsuspended",
		TargetType:          "user",
		TargetID:            updated.ID.String(),
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.UnsuspendEndUserResponse{
		User: newEndUser(updated.ID, updated.PublicID, updated.Name, updated.Email, updated.Status, updated.CreatedAt, tenantPublicID, tenantName),
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

	userID, err := parseEndUserID(req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	user, err := s.ensureManageableEndUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Delete the user row itself.
	if err := s.queriesFor(ctx).DeleteUserByID(ctx, user.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to delete end user", err, "user_id", user.ID.String())
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
		PublicId: user.PublicID,
	}), nil
}
