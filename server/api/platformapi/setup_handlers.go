package platformapi

import (
	"context"
	"errors"
	"net/mail"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/publicid"
)

func (s *platformServer) CheckSetupStatus(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.CheckSetupStatusRequest],
) (*connect.Response[publirasplatformv1.CheckSetupStatusResponse], error) {
	count, err := s.queriesFor(ctx).CountPlatformUsers(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count platform users", err)
	}
	return connect.NewResponse(&publirasplatformv1.CheckSetupStatusResponse{
		SetupCompleted: count > 0,
	}), nil
}

func (s *platformServer) CreateInitialUser(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.CreateInitialUserRequest],
) (*connect.Response[publirasplatformv1.CreateInitialUserResponse], error) {
	name := strings.TrimSpace(req.Msg.Name)
	email := strings.TrimSpace(req.Msg.Email)
	password := req.Msg.Password

	if name == "" || email == "" || strings.TrimSpace(password) == "" {
		auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name, email, and password are required"))
	}
	if _, err := mail.ParseAddress(email); err != nil {
		auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email address"))
	}

	// Fast-path: セットアップ済み確認
	count, err := s.queriesFor(ctx).CountPlatformUsers(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count platform users", err)
	}
	if count > 0 {
		auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "already_setup")
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("setup already completed"))
	}

	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "password_hash_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin initial user transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	userID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	user, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.PlatformUser, error) {
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
			auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "already_setup")
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("setup already completed"))
		}
		auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "user_creation_failed")
		return nil, s.internalDBError(ctx, "failed to create initial platform user", err)
	}
	_, err = txq.CreatePlatformUserRole(ctx, dbmodels.CreatePlatformUserRoleParams{
		ID:             uuid.Must(uuid.NewV7()),
		PlatformUserID: userID,
		Role:           rolePlatformSuperAdmin,
	})
	if err != nil {
		if dberr.IsUniqueViolation(err) {
			auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "already_setup")
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("setup already completed"))
		}
		auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "platform_role_creation_failed")
		return nil, s.internalDBError(ctx, "failed to create initial platform user role", err, "platform_user_id", userID.String())
	}

	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit initial user transaction", err, "platform_user_id", userID.String())
	}

	auth.AuditEvent(req.Header(), "platform_initial_setup", "success", "", user.PublicID, "")
	return connect.NewResponse(&publirasplatformv1.CreateInitialUserResponse{}), nil
}
