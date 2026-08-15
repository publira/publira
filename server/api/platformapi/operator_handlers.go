package platformapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/mail"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publicid"
)

const (
	defaultOperatorListLimit = 20
	maxOperatorListLimit     = 100
)

type operatorPageRow struct {
	ID        uuid.UUID
	PublicID  string
	Email     string
	Name      string
	Role      string
	Status    string
	CreatedAt time.Time
}

func toOperatorPage[T any](rows []T, convert func(T) operatorPageRow) []operatorPageRow {
	page := make([]operatorPageRow, len(rows))
	for index, row := range rows {
		page[index] = convert(row)
	}
	return page
}

func operatorPageFromAsc(row dbmodels.ListPlatformOperatorsAscRow) operatorPageRow {
	return operatorPageRow{
		ID: row.ID, PublicID: row.PublicID, Email: row.Email, Name: row.Name,
		Role: row.Role, Status: row.Status, CreatedAt: row.CreatedAt,
	}
}

func operatorPageFromDesc(row dbmodels.ListPlatformOperatorsDescRow) operatorPageRow {
	return operatorPageRow{
		ID: row.ID, PublicID: row.PublicID, Email: row.Email, Name: row.Name,
		Role: row.Role, Status: row.Status, CreatedAt: row.CreatedAt,
	}
}

func normalizePlatformOperatorRole(rawRole string) (string, bool) {
	role := strings.TrimSpace(rawRole)
	switch role {
	case rolePlatformSuperAdmin:
		return rolePlatformSuperAdmin, true
	case rolePlatformOperator:
		return rolePlatformOperator, true
	case auth.RolePlatformAuditor:
		return auth.RolePlatformAuditor, true
	default:
		return "", false
	}
}

func operatorToProto(publicID, name, email, role, status string, createdAt string) *publirasplatformv1.PlatformOperator {
	return &publirasplatformv1.PlatformOperator{
		PublicId:  publicID,
		Name:      name,
		Email:     email,
		Role:      role,
		Status:    status,
		CreatedAt: createdAt,
	}
}

func listOperatorRowToProto(row operatorPageRow) *publirasplatformv1.PlatformOperator {
	return operatorToProto(
		row.PublicID,
		row.Name,
		row.Email,
		row.Role,
		row.Status,
		row.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	)
}

func getOperatorRowToProto(row dbmodels.GetPlatformOperatorByPublicIDRow) *publirasplatformv1.PlatformOperator {
	return operatorToProto(
		row.PublicID,
		row.Name,
		row.Email,
		row.Role,
		row.Status,
		row.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	)
}

func createOperatorPassword() (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func ensurePlatformSuperAdmin(role string) error {
	if role != rolePlatformSuperAdmin {
		return connect.NewError(connect.CodePermissionDenied, errors.New("platform super admin role required"))
	}
	return nil
}

func (s *platformServer) ListOperators(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListOperatorsRequest],
) (*connect.Response[publirasplatformv1.ListOperatorsResponse], error) {
	if _, err := s.requirePlatformActor(ctx, req.Header()); err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultOperatorListLimit, maxOperatorListLimit)
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

	rows, err := s.operatorPage(ctx, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError("failed to list operators", err)
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	resp := &publirasplatformv1.ListOperatorsResponse{
		Operators: make([]*publirasplatformv1.PlatformOperator, len(rows)),
	}
	for index, row := range rows {
		resp.Operators[index] = listOperatorRowToProto(row)
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			resp.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			resp.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		resp.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		resp.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return connect.NewResponse(resp), nil
}

func (s *platformServer) operatorPage(
	ctx context.Context,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]operatorPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListPlatformOperatorsAsc(ctx, dbmodels.ListPlatformOperatorsAscParams{
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}

		return toOperatorPage(rows, operatorPageFromAsc), nil
	}

	rows, err := queries.ListPlatformOperatorsDesc(ctx, dbmodels.ListPlatformOperatorsDescParams{
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}

	return toOperatorPage(rows, operatorPageFromDesc), nil
}

func (s *platformServer) GetOperator(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.GetOperatorRequest],
) (*connect.Response[publirasplatformv1.GetOperatorResponse], error) {
	if _, err := s.requirePlatformActor(ctx, req.Header()); err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	operator, err := s.queriesFor(ctx).GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("operator not found"))
		}
		return nil, s.internalDBError("failed to get operator", err, "public_id", publicID)
	}

	return connect.NewResponse(&publirasplatformv1.GetOperatorResponse{
		Operator: getOperatorRowToProto(operator),
	}), nil
}

func (s *platformServer) CreateOperator(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.CreateOperatorRequest],
) (*connect.Response[publirasplatformv1.CreateOperatorResponse], error) {
	actor, err := s.requirePlatformWriteActor(ctx, req.Header())
	if err != nil {
		return nil, err
	}
	if err := ensurePlatformSuperAdmin(actor.Role); err != nil {
		return nil, err
	}

	name := strings.TrimSpace(req.Msg.Name)
	if name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	email := strings.TrimSpace(strings.ToLower(req.Msg.Email))
	if email == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("email is required"))
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email address"))
	}
	role, ok := normalizePlatformOperatorRole(req.Msg.Role)
	if !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid role"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError("failed to begin create operator transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	user, err := txq.GetPlatformUserByEmail(ctx, email)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, s.internalDBError("failed to get platform user by email", err)
		}

		password, err := createOperatorPassword()
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		passwordHash, err := auth.HashPassword(password)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		userID, err := uuid.NewV7()
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		user, err = publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.PlatformUser, error) {
			return txq.CreatePlatformUser(ctx, dbmodels.CreatePlatformUserParams{
				ID:           userID,
				PublicID:     publicID,
				Email:        email,
				PasswordHash: passwordHash,
				Name:         name,
			})
		})
		if err != nil {
			if dberr.IsUniqueViolation(err) {
				return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
			}
			return nil, s.internalDBError("failed to create platform user", err)
		}
	}

	roles, err := txq.ListPlatformUserRoles(ctx, user.ID)
	if err != nil {
		return nil, s.internalDBError("failed to list platform user roles", err, "platform_user_id", user.ID.String())
	}
	if len(roles) > 0 {
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("operator already exists"))
	}

	_, err = txq.CreatePlatformUserRole(ctx, dbmodels.CreatePlatformUserRoleParams{
		ID:             uuid.Must(uuid.NewV7()),
		PlatformUserID: user.ID,
		Role:           role,
	})
	if err != nil {
		if dberr.IsUniqueViolation(err) {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("operator role already exists"))
		}
		return nil, s.internalDBError("failed to create platform user role", err, "platform_user_id", user.ID.String())
	}

	operator, err := txq.GetPlatformOperatorByPublicID(ctx, user.PublicID)
	if err != nil {
		return nil, s.internalDBError("failed to get created operator", err, "platform_user_id", user.ID.String(), "public_id", user.PublicID)
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError("failed to commit create operator", err, "platform_user_id", user.ID.String())
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
		Action:              "operator_created",
		TargetType:          "operator",
		TargetID:            operator.ID.String(),
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.CreateOperatorResponse{
		Operator: getOperatorRowToProto(operator),
	}), nil
}

func (s *platformServer) UpdateOperatorRole(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdateOperatorRoleRequest],
) (*connect.Response[publirasplatformv1.UpdateOperatorRoleResponse], error) {
	actor, err := s.requirePlatformWriteActor(ctx, req.Header())
	if err != nil {
		return nil, err
	}
	if err := ensurePlatformSuperAdmin(actor.Role); err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}
	role, ok := normalizePlatformOperatorRole(req.Msg.Role)
	if !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid role"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError("failed to begin update operator role transaction", err, "public_id", publicID)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	operator, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("operator not found"))
		}
		return nil, s.internalDBError("failed to get operator", err, "public_id", publicID)
	}
	if operator.ID == actor.UserID && role != rolePlatformSuperAdmin {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("cannot demote yourself"))
	}

	if err := txq.DeletePlatformUserRolesByPlatformUserID(ctx, operator.ID); err != nil {
		return nil, s.internalDBError("failed to delete platform user roles", err, "platform_user_id", operator.ID.String())
	}
	_, err = txq.CreatePlatformUserRole(ctx, dbmodels.CreatePlatformUserRoleParams{
		ID:             uuid.Must(uuid.NewV7()),
		PlatformUserID: operator.ID,
		Role:           role,
	})
	if err != nil {
		return nil, s.internalDBError("failed to create platform user role", err, "platform_user_id", operator.ID.String())
	}

	updated, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		return nil, s.internalDBError("failed to get updated operator", err, "platform_user_id", operator.ID.String(), "public_id", publicID)
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError("failed to commit update operator role", err, "platform_user_id", operator.ID.String())
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
		Action:              "operator_updated",
		TargetType:          "operator",
		TargetID:            updated.ID.String(),
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.UpdateOperatorRoleResponse{
		Operator: getOperatorRowToProto(updated),
	}), nil
}

func (s *platformServer) SuspendOperator(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.SuspendOperatorRequest],
) (*connect.Response[publirasplatformv1.SuspendOperatorResponse], error) {
	actor, err := s.requirePlatformWriteActor(ctx, req.Header())
	if err != nil {
		return nil, err
	}
	if err := ensurePlatformSuperAdmin(actor.Role); err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError("failed to begin suspend operator transaction", err, "public_id", publicID)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	operator, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("operator not found"))
		}
		return nil, s.internalDBError("failed to get operator", err, "public_id", publicID)
	}
	if operator.ID == actor.UserID {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("cannot suspend yourself"))
	}
	if operator.Status != userStatusActive {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("operator is not active"))
	}

	updatedUser, err := txq.UpdatePlatformUserStatus(ctx, dbmodels.UpdatePlatformUserStatusParams{
		PublicID: publicID,
		Status:   userStatusSuspended,
	})
	if err != nil {
		return nil, s.internalDBError("failed to suspend operator", err, "platform_user_id", operator.ID.String(), "public_id", publicID)
	}
	if _, err := txq.BumpPlatformUserCredentialsVersion(ctx, updatedUser.ID); err != nil {
		return nil, s.internalDBError("failed to bump operator credentials version", err, "platform_user_id", updatedUser.ID.String())
	}

	updated, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		return nil, s.internalDBError("failed to get suspended operator", err, "platform_user_id", operator.ID.String(), "public_id", publicID)
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError("failed to commit suspend operator", err, "platform_user_id", operator.ID.String())
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
		Action:              "operator_suspended",
		TargetType:          "operator",
		TargetID:            updated.ID.String(),
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.SuspendOperatorResponse{
		Operator: getOperatorRowToProto(updated),
	}), nil
}

func (s *platformServer) UnsuspendOperator(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UnsuspendOperatorRequest],
) (*connect.Response[publirasplatformv1.UnsuspendOperatorResponse], error) {
	actor, err := s.requirePlatformWriteActor(ctx, req.Header())
	if err != nil {
		return nil, err
	}
	if err := ensurePlatformSuperAdmin(actor.Role); err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError("failed to begin unsuspend operator transaction", err, "public_id", publicID)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	operator, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("operator not found"))
		}
		return nil, s.internalDBError("failed to get operator", err, "public_id", publicID)
	}
	if operator.Status != userStatusSuspended {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("operator is not suspended"))
	}

	_, err = txq.UpdatePlatformUserStatus(ctx, dbmodels.UpdatePlatformUserStatusParams{
		PublicID: publicID,
		Status:   userStatusActive,
	})
	if err != nil {
		return nil, s.internalDBError("failed to unsuspend operator", err, "platform_user_id", operator.ID.String(), "public_id", publicID)
	}

	updated, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		return nil, s.internalDBError("failed to get unsuspended operator", err, "platform_user_id", operator.ID.String(), "public_id", publicID)
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError("failed to commit unsuspend operator", err, "platform_user_id", operator.ID.String())
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
		Action:              "operator_resumed",
		TargetType:          "operator",
		TargetID:            updated.ID.String(),
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.UnsuspendOperatorResponse{
		Operator: getOperatorRowToProto(updated),
	}), nil
}

func (s *platformServer) DeactivateOperator(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.DeactivateOperatorRequest],
) (*connect.Response[publirasplatformv1.DeactivateOperatorResponse], error) {
	actor, err := s.requirePlatformWriteActor(ctx, req.Header())
	if err != nil {
		return nil, err
	}
	if err := ensurePlatformSuperAdmin(actor.Role); err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError("failed to begin deactivate operator transaction", err, "public_id", publicID)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	operator, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("operator not found"))
		}
		return nil, s.internalDBError("failed to get operator", err, "public_id", publicID)
	}
	if operator.ID == actor.UserID {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("cannot deactivate yourself"))
	}
	if operator.Status == userStatusInactive {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("operator is already inactive"))
	}

	updatedUser, err := txq.UpdatePlatformUserStatus(ctx, dbmodels.UpdatePlatformUserStatusParams{
		PublicID: publicID,
		Status:   userStatusInactive,
	})
	if err != nil {
		return nil, s.internalDBError("failed to deactivate operator", err, "platform_user_id", operator.ID.String(), "public_id", publicID)
	}
	if _, err := txq.BumpPlatformUserCredentialsVersion(ctx, updatedUser.ID); err != nil {
		return nil, s.internalDBError("failed to bump operator credentials version", err, "platform_user_id", updatedUser.ID.String())
	}

	updated, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		return nil, s.internalDBError("failed to get deactivated operator", err, "platform_user_id", operator.ID.String(), "public_id", publicID)
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError("failed to commit deactivate operator", err, "platform_user_id", operator.ID.String())
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
		Action:              "operator_deleted",
		TargetType:          "operator",
		TargetID:            updated.ID.String(),
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.DeactivateOperatorResponse{
		Operator: getOperatorRowToProto(updated),
	}), nil
}
