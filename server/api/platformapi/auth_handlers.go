package platformapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	rolePlatformOperator          = auth.RolePlatformOperator
	rolePlatformSuperAdmin        = auth.RolePlatformSuperAdmin
	platformPasswordResetTokenTTL = 24 * time.Hour
	platformEmailChangeTokenTTL   = 24 * time.Hour
)

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid token"))
}

func platformRoleRequiredError() error {
	return connect.NewError(connect.CodePermissionDenied, errors.New("platform operator role required"))
}

func (s *platformServer) platformRoles(ctx context.Context, platformUserID uuid.UUID) ([]string, error) {
	roles, err := s.queriesFor(ctx).ListPlatformUserRoles(ctx, platformUserID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list platform user roles", err, "platform_user_id", platformUserID.String())
	}
	return roles, nil
}

func (s *platformServer) authenticatePlatformSession(
	ctx context.Context,
	_ string,
	headers http.Header,
) (dbmodels.PlatformUser, dbmodels.PlatformUser, string, error) {
	// First return value kept for call-site arity; use the user as both (session removed).
	rawToken, ok := auth.BearerTokenFromHeader(headers)
	if !ok || s.tokens == nil {
		return dbmodels.PlatformUser{}, dbmodels.PlatformUser{}, "", invalidSessionError()
	}
	claims, err := s.tokens.Verify(rawToken, auth.AudiencePlatform)
	if err != nil {
		return dbmodels.PlatformUser{}, dbmodels.PlatformUser{}, "", invalidSessionError()
	}
	platformUser, err := s.queriesFor(ctx).GetPlatformUserByPublicID(ctx, claims.Subject)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.PlatformUser{}, dbmodels.PlatformUser{}, "", invalidSessionError()
		}
		return dbmodels.PlatformUser{}, dbmodels.PlatformUser{}, "", s.internalDBError(ctx, "failed to get platform user by public id", err)
	}
	if platformUser.Status != "active" || platformUser.CredentialsVersion != claims.CredentialsVersion {
		return dbmodels.PlatformUser{}, dbmodels.PlatformUser{}, "", invalidSessionError()
	}
	roles, err := s.platformRoles(ctx, platformUser.ID)
	if err != nil {
		return dbmodels.PlatformUser{}, dbmodels.PlatformUser{}, "", err
	}
	resolvedRole := auth.ResolvePlatformRole(roles)
	if !auth.IsPlatformRole(resolvedRole) {
		return dbmodels.PlatformUser{}, dbmodels.PlatformUser{}, "", platformRoleRequiredError()
	}
	tracing.SetEndUser(ctx, platformUser.PublicID)
	return platformUser, platformUser, resolvedRole, nil
}

// The three platform console auth mails are enqueued as outbox_events rows in
// the transaction that writes what they announce, and rendered and delivered by
// the resident worker. The rows carry no tenant_id: a platform operator belongs
// to no tenant, and publira_platform is BYPASSRLS, so the insert is not subject
// to the tenant-isolation policy.

func enqueuePlatformPasswordResetEmail(ctx context.Context, queries *dbmodels.Queries, tokenID uuid.UUID, token string) error {
	payload, err := json.Marshal(outbox.PlatformPasswordResetEmailPayload{
		TokenID: tokenID.String(),
		Token:   token,
	})
	if err != nil {
		return fmt.Errorf("marshal platform password reset email event: %w", err)
	}
	return insertPlatformOutboxEvent(ctx, queries, outbox.EventTypePlatformPasswordResetEmail, payload,
		"platform_password_reset_email:"+tokenID.String())
}

func enqueuePlatformEmailChangeConfirmationEmail(
	ctx context.Context,
	queries *dbmodels.Queries,
	tokenID uuid.UUID,
	recipientKind string,
	token string,
) error {
	payload, err := json.Marshal(outbox.PlatformEmailChangeConfirmationEmailPayload{
		TokenID: tokenID.String(),
		Token:   token,
	})
	if err != nil {
		return fmt.Errorf("marshal platform email change confirmation email event: %w", err)
	}
	// One row per side, so a failure to deliver to one address is retried on its
	// own rather than resending the other.
	return insertPlatformOutboxEvent(ctx, queries, outbox.EventTypePlatformEmailChangeConfirmationEmail, payload,
		"platform_email_change_confirmation_email:"+tokenID.String()+":"+recipientKind)
}

func enqueuePlatformEmailChangedNoticeEmail(ctx context.Context, queries *dbmodels.Queries, tokenID uuid.UUID) error {
	payload, err := json.Marshal(outbox.PlatformEmailChangedNoticeEmailPayload{TokenID: tokenID.String()})
	if err != nil {
		return fmt.Errorf("marshal platform email changed notice email event: %w", err)
	}
	return insertPlatformOutboxEvent(ctx, queries, outbox.EventTypePlatformEmailChangedNoticeEmail, payload,
		"platform_email_changed_notice_email:"+tokenID.String())
}

func insertPlatformOutboxEvent(
	ctx context.Context,
	queries *dbmodels.Queries,
	eventType string,
	payload []byte,
	idempotencyKey string,
) error {
	_, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		EventType:      eventType,
		Payload:        payload,
		IdempotencyKey: idempotencyKey,
		AvailableAt:    time.Now().UTC(),
	})
	// The insert is a no-op when the same key is already queued, and :one then
	// returns no rows.
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}

func (s *platformServer) Login(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceLoginRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceLoginResponse], error) {
	email := strings.TrimSpace(req.Msg.Email)
	password := req.Msg.Password
	if email == "" || strings.TrimSpace(password) == "" {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", "", "invalid_credentials")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
	}
	platformUser, err := s.queriesFor(ctx).GetPlatformUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "platform_login", "failure", "", "", "invalid_credentials")
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
		}
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", "", "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get platform user for login", err)
	}
	roles, err := s.platformRoles(ctx, platformUser.ID)
	if err != nil {
		return nil, err
	}
	resolvedRole := auth.ResolvePlatformRole(roles)
	if !auth.IsPlatformRole(resolvedRole) || !auth.VerifyPassword(password, platformUser.PasswordHash) {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", platformUser.PublicID, "invalid_credentials")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
	}
	if platformUser.Status != "active" {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", platformUser.PublicID, "user_inactive")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
	}
	if s.tokens == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("token manager is not configured"))
	}
	token, expiresAt, err := s.tokens.Issue(platformUser.PublicID, auth.AudiencePlatform, "", resolvedRole, platformUser.CredentialsVersion, time.Now())
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", platformUser.PublicID, "token_issue_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resp := &publirasplatformv1.PlatformAuthServiceLoginResponse{
		User:        &publirattypesv1.User{PublicId: platformUser.PublicID, Name: platformUser.Name, Role: resolvedRole},
		AccessToken: &publirattypesv1.AccessToken{Token: token, ExpiresAt: auth.FormatExpiresAt(expiresAt)},
	}
	auth.AuditEvent(req.Header(), "platform_login", "success", "", platformUser.PublicID, "token_issued")
	return connect.NewResponse(resp), nil
}

func (s *platformServer) Logout(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceLogoutRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceLogoutResponse], error) {
	if _, ok := auth.BearerTokenFromHeader(req.Header()); ok {
		auth.AuditEvent(req.Header(), "platform_logout", "success", "", "", "client_logout")
	} else {
		auth.AuditEvent(req.Header(), "platform_logout", "success", "", "", "no_token")
	}
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceLogoutResponse{}), nil
}

func (s *platformServer) RequestPasswordReset(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceRequestPasswordResetResponse], error) {
	email := strings.TrimSpace(req.Msg.Email)
	if email == "" {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("email is required"))
	}
	if _, err := mail.ParseAddress(email); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", "", "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email address"))
	}

	platformUser, err := s.queriesFor(ctx).GetPlatformUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "platform_password_reset_request", "success", "", "", "requested")
			return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetResponse{Requested: true}), nil
		}
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", "", "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get platform user for password reset", err)
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", platformUser.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resetToken := hex.EncodeToString(rawToken)
	tokenID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", platformUser.PublicID, "token_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", platformUser.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin password reset transaction", err, "platform_user_id", platformUser.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	if err := txq.DeletePlatformUserPasswordResetTokensByUserID(ctx, platformUser.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", platformUser.PublicID, "token_delete_failed")
		return nil, s.internalDBError(ctx, "failed to delete password reset tokens", err, "platform_user_id", platformUser.ID.String())
	}
	if _, err := txq.CreatePlatformUserPasswordResetToken(ctx, dbmodels.CreatePlatformUserPasswordResetTokenParams{
		ID:             tokenID,
		PlatformUserID: platformUser.ID,
		TokenHash:      auth.HashToken(resetToken),
		ExpiresAt:      time.Now().Add(platformPasswordResetTokenTTL),
	}); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", platformUser.PublicID, "token_create_failed")
		return nil, s.internalDBError(ctx, "failed to create password reset token", err, "platform_user_id", platformUser.ID.String())
	}
	if err := enqueuePlatformPasswordResetEmail(ctx, txq, tokenID, resetToken); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", platformUser.PublicID, "reset_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue platform password reset email", err, "platform_user_id", platformUser.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", platformUser.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit password reset transaction", err, "platform_user_id", platformUser.ID.String())
	}

	auth.AuditEvent(req.Header(), "platform_password_reset_request", "success", "", platformUser.PublicID, "requested")
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetResponse{Requested: true}), nil
}

func (s *platformServer) VerifyPasswordResetToken(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceVerifyPasswordResetTokenRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceVerifyPasswordResetTokenResponse], error) {
	token := strings.TrimSpace(req.Msg.Token)
	if token == "" {
		return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceVerifyPasswordResetTokenResponse{Valid: false}), nil
	}

	resetToken, err := s.queriesFor(ctx).GetPlatformUserPasswordResetTokenByHash(ctx, auth.HashToken(token))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceVerifyPasswordResetTokenResponse{Valid: false}), nil
		}
		return nil, s.internalDBError(ctx, "failed to get password reset token", err)
	}

	valid := !resetToken.CompletedAt.Valid && resetToken.ExpiresAt.After(time.Now())
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceVerifyPasswordResetTokenResponse{Valid: valid}), nil
}

func (s *platformServer) ConfirmPasswordReset(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceConfirmPasswordResetRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceConfirmPasswordResetResponse], error) {
	token := strings.TrimSpace(req.Msg.Token)
	newPassword := strings.TrimSpace(req.Msg.NewPassword)
	if token == "" || newPassword == "" {
		auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token and new_password are required"))
	}

	resetToken, err := s.queriesFor(ctx).GetPlatformUserPasswordResetTokenByHash(ctx, auth.HashToken(token))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", "", "invalid_token")
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("password reset token is invalid or expired"))
		}
		auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", "", "token_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get password reset token", err)
	}

	if resetToken.CompletedAt.Valid {
		return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceConfirmPasswordResetResponse{Confirmed: true}), nil
	}
	if !resetToken.ExpiresAt.After(time.Now()) {
		auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", "", "expired_token")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("password reset token is invalid or expired"))
	}

	platformUser, err := s.queriesFor(ctx).GetPlatformUserByID(ctx, resetToken.PlatformUserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", "", "user_not_found")
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("password reset token is invalid or expired"))
		}
		auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", "", "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get platform user for password reset confirm", err, "platform_user_id", resetToken.PlatformUserID.String())
	}

	passwordHash, err := auth.HashPassword(newPassword)
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", platformUser.PublicID, "password_hash_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if _, err := s.queriesFor(ctx).UpdatePlatformUserPasswordHashByID(ctx, dbmodels.UpdatePlatformUserPasswordHashByIDParams{
		ID:           platformUser.ID,
		PasswordHash: passwordHash,
	}); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", platformUser.PublicID, "password_update_failed")
		return nil, s.internalDBError(ctx, "failed to update password", err, "platform_user_id", platformUser.ID.String())
	}
	if _, err := s.queriesFor(ctx).BumpPlatformUserCredentialsVersion(ctx, platformUser.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", platformUser.PublicID, "session_terminate_failed")
		return nil, s.internalDBError(ctx, "failed to bump credentials version", err, "platform_user_id", platformUser.ID.String())
	}
	if err := s.queriesFor(ctx).MarkPlatformUserPasswordResetTokenCompleted(ctx, resetToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", platformUser.PublicID, "token_complete_failed")
		return nil, s.internalDBError(ctx, "failed to complete password reset token", err, "platform_user_id", platformUser.ID.String(), "token_id", resetToken.ID.String())
	}

	auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "success", "", platformUser.PublicID, "confirmed")
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceConfirmPasswordResetResponse{Confirmed: true}), nil
}

func (s *platformServer) RequestEmailChange(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceRequestEmailChangeRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceRequestEmailChangeResponse], error) {
	_, platformUser, _, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", "", "invalid_session")
		return nil, err
	}

	newEmail := strings.TrimSpace(req.Msg.NewEmail)
	currentEmail := strings.TrimSpace(req.Msg.CurrentEmail)
	currentPassword := strings.TrimSpace(req.Msg.CurrentPassword)
	if currentEmail == "" || newEmail == "" || currentPassword == "" {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("current_email, new_email and current_password are required"))
	}
	if _, err := mail.ParseAddress(currentEmail); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "invalid_current_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid current email address"))
	}
	if _, err := mail.ParseAddress(newEmail); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email address"))
	}
	if !strings.EqualFold(currentEmail, platformUser.Email) {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "current_email_mismatch")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("current email does not match"))
	}
	if strings.EqualFold(newEmail, platformUser.Email) {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "same_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("new email must be different from current email"))
	}
	if !auth.VerifyPassword(currentPassword, platformUser.PasswordHash) {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "invalid_password")
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("invalid current password"), "current_password")
	}

	_, err = s.queriesFor(ctx).GetPlatformUserByEmail(ctx, newEmail)
	if err == nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "email_already_exists")
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
	}
	if !errors.Is(err, sql.ErrNoRows) {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to check email uniqueness", err, "platform_user_id", platformUser.ID.String())
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	currentEmailToken := hex.EncodeToString(rawToken)
	rawToken = make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	newEmailToken := hex.EncodeToString(rawToken)
	tokenID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "token_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin email change transaction", err, "platform_user_id", platformUser.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	if err := txq.DeletePlatformUserEmailChangeTokensByUserID(ctx, platformUser.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "token_delete_failed")
		return nil, s.internalDBError(ctx, "failed to delete email change tokens", err, "platform_user_id", platformUser.ID.String())
	}
	if _, err := txq.CreatePlatformUserEmailChangeToken(ctx, dbmodels.CreatePlatformUserEmailChangeTokenParams{
		ID:                    tokenID,
		PlatformUserID:        platformUser.ID,
		CurrentEmail:          platformUser.Email,
		NewEmail:              newEmail,
		CurrentEmailTokenHash: auth.HashToken(currentEmailToken),
		NewEmailTokenHash:     auth.HashToken(newEmailToken),
		ExpiresAt:             time.Now().Add(platformEmailChangeTokenTTL),
	}); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "token_create_failed")
		return nil, s.internalDBError(ctx, "failed to create email change token", err, "platform_user_id", platformUser.ID.String())
	}
	if err := enqueuePlatformEmailChangeConfirmationEmail(ctx, txq, tokenID, "current_email", currentEmailToken); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "current_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue platform email change confirmation email", err, "platform_user_id", platformUser.ID.String())
	}
	if err := enqueuePlatformEmailChangeConfirmationEmail(ctx, txq, tokenID, "new_email", newEmailToken); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "new_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue platform email change confirmation email", err, "platform_user_id", platformUser.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit email change transaction", err, "platform_user_id", platformUser.ID.String())
	}

	auth.AuditEvent(req.Header(), "platform_email_change_request", "success", "", platformUser.PublicID, "confirmation_emails_queued")
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceRequestEmailChangeResponse{Requested: true}), nil
}

func (s *platformServer) VerifyEmailChangeToken(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceVerifyEmailChangeTokenRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceVerifyEmailChangeTokenResponse], error) {
	token := strings.TrimSpace(req.Msg.Token)
	if token == "" {
		return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceVerifyEmailChangeTokenResponse{Valid: false}), nil
	}

	changeToken, err := s.queriesFor(ctx).GetPlatformUserEmailChangeTokenByHash(ctx, auth.HashToken(token))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceVerifyEmailChangeTokenResponse{Valid: false}), nil
		}
		return nil, s.internalDBError(ctx, "failed to get email change token", err)
	}

	valid := !changeToken.CompletedAt.Valid && changeToken.ExpiresAt.After(time.Now())
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceVerifyEmailChangeTokenResponse{Valid: valid}), nil
}

func (s *platformServer) ConfirmEmailChange(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceConfirmEmailChangeRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceConfirmEmailChangeResponse], error) {
	token := strings.TrimSpace(req.Msg.Token)
	if token == "" {
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", "", "invalid_token")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is required"))
	}

	changeToken, err := s.queriesFor(ctx).GetPlatformUserEmailChangeTokenByHash(ctx, auth.HashToken(token))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", "", "token_not_found")
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change token is invalid or expired"))
		}
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", "", "token_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get email change token", err)
	}

	if changeToken.CompletedAt.Valid {
		return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceConfirmEmailChangeResponse{Confirmed: true, Changed: true}), nil
	}
	if !changeToken.ExpiresAt.After(time.Now()) {
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", "", "expired_token")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change token is invalid or expired"))
	}

	platformUser, err := s.queriesFor(ctx).GetPlatformUserByID(ctx, changeToken.PlatformUserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", "", "user_not_found")
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change token is invalid or expired"))
		}
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", "", "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get platform user for email change confirm", err, "platform_user_id", changeToken.PlatformUserID.String())
	}
	if !strings.EqualFold(platformUser.Email, changeToken.CurrentEmail) {
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "stale_request")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change request is no longer valid"))
	}

	matchedTarget := changeToken.MatchedTarget
	if matchedTarget == "current_email" {
		if err := s.queriesFor(ctx).MarkPlatformUserEmailChangeCurrentEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "current_email_confirm_failed")
			return nil, s.internalDBError(ctx, "failed to confirm current email", err, "platform_user_id", platformUser.ID.String(), "token_id", changeToken.ID.String())
		}
	} else {
		if err := s.queriesFor(ctx).MarkPlatformUserEmailChangeNewEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "new_email_confirm_failed")
			return nil, s.internalDBError(ctx, "failed to confirm new email", err, "platform_user_id", platformUser.ID.String(), "token_id", changeToken.ID.String())
		}
	}

	currentEmailConfirmed := changeToken.CurrentEmailConfirmedAt.Valid || matchedTarget == "current_email"
	newEmailConfirmed := changeToken.NewEmailConfirmedAt.Valid || matchedTarget == "new_email"
	if !currentEmailConfirmed || !newEmailConfirmed {
		pendingTarget := "current_email"
		if !newEmailConfirmed {
			pendingTarget = "new_email"
		}
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "success", "", platformUser.PublicID, "waiting_for_"+pendingTarget)
		return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceConfirmEmailChangeResponse{
			Confirmed:              true,
			Changed:                false,
			PendingConfirmationFor: pendingTarget,
		}), nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin email change confirmation transaction", err, "platform_user_id", platformUser.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	if _, err := txq.UpdatePlatformUserEmailByID(ctx, dbmodels.UpdatePlatformUserEmailByIDParams{
		ID:    platformUser.ID,
		Email: changeToken.NewEmail,
	}); err != nil {
		if dberr.IsUniqueViolation(err) {
			auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "email_already_exists")
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
		}
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "email_update_failed")
		return nil, s.internalDBError(ctx, "failed to update platform user email", err, "platform_user_id", platformUser.ID.String())
	}
	if err := txq.MarkPlatformUserEmailChangeCompleted(ctx, changeToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "request_complete_failed")
		return nil, s.internalDBError(ctx, "failed to complete email change token", err, "platform_user_id", platformUser.ID.String(), "token_id", changeToken.ID.String())
	}
	if err := enqueuePlatformEmailChangedNoticeEmail(ctx, txq, changeToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "old_email_notice_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue platform email changed notice email", err, "platform_user_id", platformUser.ID.String(), "token_id", changeToken.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit email change confirmation transaction", err, "platform_user_id", platformUser.ID.String())
	}

	auth.AuditEvent(req.Header(), "platform_email_change_confirm", "success", "", platformUser.PublicID, "email_changed")
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceConfirmEmailChangeResponse{Confirmed: true, Changed: true}), nil
}

func (s *platformServer) GetMe(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceGetMeRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceGetMeResponse], error) {
	_, platformUser, role, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceGetMeResponse{
		User: &publirattypesv1.User{PublicId: platformUser.PublicID, Name: platformUser.Name, Role: role},
	}), nil
}
