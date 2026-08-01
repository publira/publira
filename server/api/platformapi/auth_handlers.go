package platformapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
)

const (
	rolePlatformOperator          = auth.RolePlatformOperator
	rolePlatformSuperAdmin        = auth.RolePlatformSuperAdmin
	platformPasswordResetTokenTTL = 24 * time.Hour
	platformEmailChangeTokenTTL   = 24 * time.Hour
	defaultPlatformAppURL         = "http://platform.localhost:3080"
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return dbmodels.PlatformUser{}, dbmodels.PlatformUser{}, "", connect.NewError(connect.CodeInternal, err)
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
	return platformUser, platformUser, resolvedRole, nil
}

func platformPasswordResetConfirmationURL(token string) (string, error) {
	baseURL := strings.TrimSpace(os.Getenv("PUBLIRA_PLATFORM_APP_URL"))
	if baseURL == "" {
		baseURL = defaultPlatformAppURL
	}

	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("platform app url is invalid")
	}

	confirmURL := parsed.ResolveReference(&url.URL{Path: "/confirm-password"})
	query := confirmURL.Query()
	query.Set("token", token)
	confirmURL.RawQuery = query.Encode()
	return confirmURL.String(), nil
}

func platformEmailChangeConfirmationURL(token string) (string, error) {
	baseURL := strings.TrimSpace(os.Getenv("PUBLIRA_PLATFORM_APP_URL"))
	if baseURL == "" {
		baseURL = defaultPlatformAppURL
	}

	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("platform app url is invalid")
	}

	confirmURL := parsed.ResolveReference(&url.URL{Path: "/confirm-email"})
	query := confirmURL.Query()
	query.Set("token", token)
	confirmURL.RawQuery = query.Encode()
	return confirmURL.String(), nil
}

func (s *platformServer) resolvePlatformSMTPSettings(ctx context.Context) (emailsettings.SMTPSettings, error) {
	platformConfig, err := s.queriesFor(ctx).GetPlatformSMTPConfig(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("platform smtp settings are not configured"))
		}
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeInternal, err)
	}

	password, decryptErr := emailsettings.DecryptPassword(platformConfig.PasswordEncrypted, s.encryptor)
	if decryptErr != nil {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("platform smtp settings are not configured"))
	}

	settings := platformEmailSettingsFromConfig(platformConfig, password)
	if validateErr := emailsettings.Validate(settings, true); validateErr != nil {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, validateErr)
	}
	return settings, nil
}

func (s *platformServer) sendPlatformPasswordResetEmail(
	ctx context.Context,
	recipientEmail string,
	token string,
) error {
	if s.mailer == nil {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("smtp sender is not configured"))
	}

	settings, err := s.resolvePlatformSMTPSettings(ctx)
	if err != nil {
		return err
	}

	confirmURL, err := platformPasswordResetConfirmationURL(token)
	if err != nil {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}

	subject := "Publira Platform Console パスワード再設定"
	body := "Platform Console アカウントのパスワード再設定リクエストを受け付けました。\r\n" +
		"以下のリンクを開いて新しいパスワードを設定してください。\r\n\r\n" +
		confirmURL + "\r\n\r\n" +
		"このリンクの有効期限は24時間です。\r\n" +
		"心当たりがない場合、このメールは破棄してください。\r\n"
	if err := s.mailer.SendEmail(ctx, settings, recipientEmail, subject, body); err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	return nil
}

func (s *platformServer) sendPlatformEmailChangeVerificationEmail(
	ctx context.Context,
	recipientEmail string,
	recipientKind string,
	currentEmail string,
	newEmail string,
	token string,
) error {
	if s.mailer == nil {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("smtp sender is not configured"))
	}

	settings, err := s.resolvePlatformSMTPSettings(ctx)
	if err != nil {
		return err
	}

	confirmURL, err := platformEmailChangeConfirmationURL(token)
	if err != nil {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}

	subject := "Publira Platform Console メールアドレス変更確認"
	body := "Platform Console アカウントのメールアドレス変更リクエストを受け付けました。\r\n"
	if recipientKind == "current_email" {
		body += "現在のメールアドレス側の確認が必要です。\r\n"
	} else {
		body += "新しいメールアドレス側の確認が必要です。\r\n"
	}
	body += "以下のリンクを開いて確認を完了してください。\r\n\r\n" +
		confirmURL + "\r\n\r\n" +
		"このリンクの有効期限は24時間です。\r\n" +
		"心当たりがない場合、このメールは破棄してください。\r\n\r\n" +
		"現在のメールアドレス: " + currentEmail + "\r\n" +
		"新しいメールアドレス: " + newEmail + "\r\n"

	if err := s.mailer.SendEmail(ctx, settings, recipientEmail, subject, body); err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	return nil
}

func (s *platformServer) sendPlatformEmailChangedNotice(
	ctx context.Context,
	oldEmail string,
	newEmail string,
) error {
	if s.mailer == nil {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("smtp sender is not configured"))
	}

	settings, err := s.resolvePlatformSMTPSettings(ctx)
	if err != nil {
		return err
	}

	subject := "Publira Platform Console メールアドレス変更完了"
	body := "Platform Console アカウントのメールアドレスが変更されました。\r\n\r\n" +
		"変更前: " + oldEmail + "\r\n" +
		"変更後: " + newEmail + "\r\n\r\n" +
		"この変更に心当たりがない場合は、すぐにパスワード変更などの対応を行ってください。\r\n"

	if err := s.mailer.SendEmail(ctx, settings, oldEmail, subject, body); err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	return nil
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.queriesFor(ctx).DeletePlatformUserPasswordResetTokensByUserID(ctx, platformUser.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", platformUser.PublicID, "token_delete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
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

	_, err = s.queriesFor(ctx).CreatePlatformUserPasswordResetToken(ctx, dbmodels.CreatePlatformUserPasswordResetTokenParams{
		ID:             tokenID,
		PlatformUserID: platformUser.ID,
		TokenHash:      auth.HashToken(resetToken),
		ExpiresAt:      time.Now().Add(platformPasswordResetTokenTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", platformUser.PublicID, "token_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.sendPlatformPasswordResetEmail(ctx, platformUser.Email, resetToken); err != nil {
		_ = s.queriesFor(ctx).DeletePlatformUserPasswordResetTokensByUserID(ctx, platformUser.ID)
		auth.AuditEvent(req.Header(), "platform_password_reset_request", "failure", "", platformUser.PublicID, "reset_email_send_failed")
		return nil, err
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if _, err := s.queriesFor(ctx).BumpPlatformUserCredentialsVersion(ctx, platformUser.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", platformUser.PublicID, "session_terminate_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queriesFor(ctx).MarkPlatformUserPasswordResetTokenCompleted(ctx, resetToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_password_reset_confirm", "failure", "", platformUser.PublicID, "token_complete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid current password"))
	}

	_, err = s.queriesFor(ctx).GetPlatformUserByEmail(ctx, newEmail)
	if err == nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "email_already_exists")
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
	}
	if !errors.Is(err, sql.ErrNoRows) {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.queriesFor(ctx).DeletePlatformUserEmailChangeTokensByUserID(ctx, platformUser.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "token_delete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
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

	_, err = s.queriesFor(ctx).CreatePlatformUserEmailChangeToken(ctx, dbmodels.CreatePlatformUserEmailChangeTokenParams{
		ID:                    tokenID,
		PlatformUserID:        platformUser.ID,
		CurrentEmail:          platformUser.Email,
		NewEmail:              newEmail,
		CurrentEmailTokenHash: auth.HashToken(currentEmailToken),
		NewEmailTokenHash:     auth.HashToken(newEmailToken),
		ExpiresAt:             time.Now().Add(platformEmailChangeTokenTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "token_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.sendPlatformEmailChangeVerificationEmail(ctx, platformUser.Email, "current_email", platformUser.Email, newEmail, currentEmailToken); err != nil {
		_ = s.queriesFor(ctx).DeletePlatformUserEmailChangeTokensByUserID(ctx, platformUser.ID)
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "current_email_send_failed")
		return nil, err
	}
	if err := s.sendPlatformEmailChangeVerificationEmail(ctx, newEmail, "new_email", platformUser.Email, newEmail, newEmailToken); err != nil {
		_ = s.queriesFor(ctx).DeletePlatformUserEmailChangeTokensByUserID(ctx, platformUser.ID)
		auth.AuditEvent(req.Header(), "platform_email_change_request", "failure", "", platformUser.PublicID, "new_email_send_failed")
		return nil, err
	}

	auth.AuditEvent(req.Header(), "platform_email_change_request", "success", "", platformUser.PublicID, "confirmation_emails_sent")
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !strings.EqualFold(platformUser.Email, changeToken.CurrentEmail) {
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "stale_request")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change request is no longer valid"))
	}

	matchedTarget := changeToken.MatchedTarget
	if matchedTarget == "current_email" {
		if err := s.queriesFor(ctx).MarkPlatformUserEmailChangeCurrentEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "current_email_confirm_failed")
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	} else {
		if err := s.queriesFor(ctx).MarkPlatformUserEmailChangeNewEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "new_email_confirm_failed")
			return nil, connect.NewError(connect.CodeInternal, err)
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

	if _, err := s.queriesFor(ctx).UpdatePlatformUserEmailByID(ctx, dbmodels.UpdatePlatformUserEmailByIDParams{
		ID:    platformUser.ID,
		Email: changeToken.NewEmail,
	}); err != nil {
		if isUniqueViolation(err) {
			auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "email_already_exists")
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
		}
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "email_update_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queriesFor(ctx).MarkPlatformUserEmailChangeCompleted(ctx, changeToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "request_complete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.sendPlatformEmailChangedNotice(ctx, changeToken.CurrentEmail, changeToken.NewEmail); err != nil {
		auth.AuditEvent(req.Header(), "platform_email_change_confirm", "failure", "", platformUser.PublicID, "old_email_notice_failed")
		return nil, err
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
