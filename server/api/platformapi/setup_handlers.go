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
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/publicid"
)

func (s *platformServer) CheckSetupStatus(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.CheckSetupStatusRequest],
) (*connect.Response[publirasplatformv1.CheckSetupStatusResponse], error) {
	queries := s.queriesFor(ctx)
	count, err := queries.CountPlatformUsers(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count platform users", err)
	}
	return connect.NewResponse(&publirasplatformv1.CheckSetupStatusResponse{
		DefaultLocale:  savedDefaultLocale(ctx, queries),
		SetupCompleted: count > 0,
	}), nil
}

// savedDefaultLocale reports the platform's stored default locale, or "" when
// there is none to report.
//
// Deliberately not platformconfig.DefaultLocale: that answers locale.Default
// for a row it could not read, which is the whole point of an unauthenticated
// caller asking. The console has to tell "the platform saved ja" from "nobody
// has saved anything yet", because only the second is a reason to fall back to
// what the visitor's browser asked for.
func savedDefaultLocale(ctx context.Context, q Querier) string {
	config, err := q.GetPlatformConfig(ctx)
	if err != nil {
		return ""
	}
	saved, err := locale.Normalize(config.DefaultLocale)
	if err != nil {
		return ""
	}
	return saved
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
	// The setup screen offers the supported locales and sends the one the
	// operator picked; there is no stored preference yet to fall back on, so an
	// absent or unsupported code is rejected rather than guessed at.
	defaultLocale, err := locale.Normalize(req.Msg.DefaultLocale)
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "invalid_locale")
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
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

	// The chosen locale becomes the platform default in the same transaction, so
	// a platform that has an administrator always has a language to render in.
	if _, err := txq.UpsertPlatformDefaultLocale(ctx, defaultLocale); err != nil {
		auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "platform_locale_save_failed")
		return nil, s.internalDBError(ctx, "failed to save the initial platform default locale", err, "platform_user_id", userID.String())
	}

	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "platform_initial_setup", "failure", "", "", "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit initial user transaction", err, "platform_user_id", userID.String())
	}

	auth.AuditEvent(req.Header(), "platform_initial_setup", "success", "", user.PublicID, "")
	return connect.NewResponse(&publirasplatformv1.CreateInitialUserResponse{}), nil
}
