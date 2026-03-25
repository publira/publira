package platformapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/mail"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
)

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

func listOperatorRowToProto(row dbmodels.ListPlatformOperatorsRow) *publirasplatformv1.PlatformOperator {
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
	if _, _, _, err := s.authenticatePlatformSession(ctx, "", req.Header()); err != nil {
		return nil, err
	}
	rows, err := s.queries.ListPlatformOperators(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resp := &publirasplatformv1.ListOperatorsResponse{
		Operators: make([]*publirasplatformv1.PlatformOperator, len(rows)),
	}
	for index, row := range rows {
		resp.Operators[index] = listOperatorRowToProto(row)
	}
	return connect.NewResponse(resp), nil
}

func (s *platformServer) CreateOperator(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.CreateOperatorRequest],
) (*connect.Response[publirasplatformv1.CreateOperatorResponse], error) {
	_, currentUser, currentRole, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}
	if err := ensurePlatformSuperAdmin(currentRole); err != nil {
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	user, err := txq.GetPlatformUserByEmail(ctx, email)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeInternal, err)
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
		user, err = txq.CreatePlatformUser(ctx, dbmodels.CreatePlatformUserParams{
			ID:           userID,
			PublicID:     generatePublicID(),
			Email:        email,
			PasswordHash: passwordHash,
			Name:         name,
		})
		if err != nil {
			if isUniqueViolation(err) {
				return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	roles, err := txq.ListPlatformUserRoles(ctx, user.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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
		if isUniqueViolation(err) {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("operator role already exists"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	operator, err := txq.GetPlatformOperatorByPublicID(ctx, user.PublicID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: currentUser.ID,
		ActorRole:           currentRole,
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
	_, currentUser, currentRole, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}
	if err := ensurePlatformSuperAdmin(currentRole); err != nil {
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	operator, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("operator not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if operator.ID == currentUser.ID && role != rolePlatformSuperAdmin {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("cannot demote yourself"))
	}

	if err := txq.DeletePlatformUserRolesByPlatformUserID(ctx, operator.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = txq.CreatePlatformUserRole(ctx, dbmodels.CreatePlatformUserRoleParams{
		ID:             uuid.Must(uuid.NewV7()),
		PlatformUserID: operator.ID,
		Role:           role,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	updated, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: currentUser.ID,
		ActorRole:           currentRole,
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
	_, currentUser, currentRole, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}
	if err := ensurePlatformSuperAdmin(currentRole); err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	operator, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("operator not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if operator.ID == currentUser.ID {
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := txq.TerminatePlatformUserSessions(ctx, updatedUser.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	updated, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: currentUser.ID,
		ActorRole:           currentRole,
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
	_, currentUser, currentRole, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}
	if err := ensurePlatformSuperAdmin(currentRole); err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	operator, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("operator not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if operator.Status != userStatusSuspended {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("operator is not suspended"))
	}

	_, err = txq.UpdatePlatformUserStatus(ctx, dbmodels.UpdatePlatformUserStatusParams{
		PublicID: publicID,
		Status:   userStatusActive,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	updated, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: currentUser.ID,
		ActorRole:           currentRole,
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
	_, currentUser, currentRole, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}
	if err := ensurePlatformSuperAdmin(currentRole); err != nil {
		return nil, err
	}

	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	operator, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("operator not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if operator.ID == currentUser.ID {
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := txq.TerminatePlatformUserSessions(ctx, updatedUser.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	updated, err := txq.GetPlatformOperatorByPublicID(ctx, publicID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: currentUser.ID,
		ActorRole:           currentRole,
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
