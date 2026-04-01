package adminapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
)

const passwordResetTokenTTL = 24 * time.Hour

func adminPasswordResetConfirmationURL(tenant dbmodels.Tenant, token string) (string, error) {
	domain := strings.TrimSpace(tenant.Domain)
	if tenant.AdminDomain.Valid && strings.TrimSpace(tenant.AdminDomain.String) != "" {
		domain = strings.TrimSpace(tenant.AdminDomain.String)
	}
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimSuffix(domain, "/")
	if domain == "" {
		return "", errors.New("tenant domain is not configured")
	}
	return "https://" + domain + "/confirm-password?token=" + url.QueryEscape(token), nil
}

func tenantSMTPSettingsFromRow(config dbmodels.TenantSmtpConfig, password string) emailsettings.SMTPSettings {
	settings := emailsettings.SMTPSettings{Password: password}
	if config.Host.Valid {
		settings.Host = config.Host.String
	}
	if config.Port.Valid {
		settings.Port = config.Port.Int32
	}
	if config.Username.Valid {
		settings.Username = config.Username.String
	}
	if config.Encryption.Valid {
		settings.Encryption = config.Encryption.String
	}
	if config.FromName.Valid {
		settings.FromName = config.FromName.String
	}
	if config.FromAddress.Valid {
		settings.FromAddress = config.FromAddress.String
	}
	if config.ReplyTo.Valid {
		settings.ReplyTo = config.ReplyTo.String
	}
	return settings
}

func platformSMTPSettingsFromRow(config dbmodels.PlatformSmtpConfig, password string) emailsettings.SMTPSettings {
	settings := emailsettings.SMTPSettings{
		Host:        config.Host,
		Port:        config.Port,
		Username:    config.Username,
		Password:    password,
		Encryption:  config.Encryption,
		FromAddress: config.FromAddress,
	}
	if config.ReplyTo.Valid {
		settings.ReplyTo = config.ReplyTo.String
	}
	return settings
}

func (s *adminServer) resolveSMTPSettingsForTenant(ctx context.Context, tenantID uuid.UUID) (emailsettings.SMTPSettings, error) {
	tenantConfig, err := s.queriesFor(ctx).GetTenantSMTPConfigByTenantID(ctx, tenantID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeInternal, err)
	}
	if err == nil && tenantConfig.SmtpOverrideEnabled {
		password, decryptErr := emailsettings.DecryptPassword(tenantConfig.PasswordEncrypted.String, s.encryptor)
		if decryptErr != nil {
			return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("tenant smtp settings are not configured"))
		}
		settings := tenantSMTPSettingsFromRow(tenantConfig, password)
		if validateErr := emailsettings.Validate(settings, true); validateErr != nil {
			return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, validateErr)
		}
		return settings, nil
	}

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
	settings := platformSMTPSettingsFromRow(platformConfig, password)
	if validateErr := emailsettings.Validate(settings, true); validateErr != nil {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, validateErr)
	}
	return settings, nil
}

func (s *adminServer) sendPasswordResetEmail(
	ctx context.Context,
	tenant dbmodels.Tenant,
	recipientEmail string,
	token string,
) error {
	if s.mailer == nil {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("smtp sender is not configured"))
	}
	settings, err := s.resolveSMTPSettingsForTenant(ctx, tenant.ID)
	if err != nil {
		return err
	}
	confirmURL, err := adminPasswordResetConfirmationURL(tenant, token)
	if err != nil {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	subjectPrefix := strings.TrimSpace(tenant.Name)
	if subjectPrefix == "" {
		subjectPrefix = "Publira"
	}
	subject := subjectPrefix + " 管理画面パスワード再設定"
	body := "管理画面アカウントのパスワード再設定リクエストを受け付けました。\r\n" +
		"以下のリンクを開いて新しいパスワードを設定してください。\r\n\r\n" +
		confirmURL + "\r\n\r\n" +
		"このリンクの有効期限は24時間です。\r\n" +
		"心当たりがない場合、このメールは破棄してください。\r\n"
	if err := s.mailer.SendEmail(ctx, settings, recipientEmail, subject, body); err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	return nil
}

func (s *adminServer) tenantRole(ctx context.Context, userID uuid.UUID) (string, error) {
	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, userID)
	if err != nil {
		return "", connect.NewError(connect.CodeInternal, err)
	}
	return auth.ResolveTenantRole(roles), nil
}

func (s *adminServer) currentUserFromSession(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	explicitToken string,
	headers http.Header,
) (dbmodels.Tenant, dbmodels.User, string, error) {
	authCtx, err := s.authenticateSession(ctx, tenantCtx, explicitToken, headers)
	if err != nil {
		return dbmodels.Tenant{}, dbmodels.User{}, "", err
	}
	return authCtx.Tenant, authCtx.User, authCtx.Role, nil
}

func (s *adminServer) CreateSession(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceCreateSessionRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceCreateSessionResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_login", "failure", "", "", "tenant_not_found")
		return nil, err
	}
	user, err := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true}, Email: req.Msg.Email})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "admin_login", "failure", tenant.PublicID, "", "invalid_credentials")
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
		}
		auth.AuditEvent(req.Header(), "admin_login", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !auth.VerifyPassword(req.Msg.Password, user.PasswordHash) {
		auth.AuditEvent(req.Header(), "admin_login", "failure", tenant.PublicID, user.PublicID, "invalid_credentials")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
	}
	role, err := s.tenantRole(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "admin_login", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	sessionToken := hex.EncodeToString(rawToken)
	sessionID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_login", "failure", tenant.PublicID, user.PublicID, "session_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	createdSession, err := s.queriesFor(ctx).CreateSession(ctx, dbmodels.CreateSessionParams{
		ID:        sessionID,
		TenantID:  tenant.ID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(sessionToken),
		ExpiresAt: time.Now().Add(auth.SessionTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_login", "failure", tenant.PublicID, user.PublicID, "session_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resp := &publiraadminv1.AdminAuthServiceCreateSessionResponse{
		User:    &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: role},
		Session: &publirattypesv1.Session{SessionId: sessionToken, ExpiresAt: createdSession.ExpiresAt.UTC().Format(time.RFC3339)},
	}
	response := connect.NewResponse(resp)
	response.Header().Add("Set-Cookie", auth.BuildSessionCookie(sessionToken, createdSession.ExpiresAt))
	auth.AuditEvent(req.Header(), "admin_login", "success", tenant.PublicID, user.PublicID, "session_issued")
	return response, nil
}

func (s *adminServer) DeleteSession(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceDeleteSessionRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceDeleteSessionResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_logout", "failure", "", "", "tenant_not_found")
		return nil, err
	}
	sessionToken, ok := auth.SessionTokenFromRequest(req.Msg.SessionId, req.Header())
	response := connect.NewResponse(&publiraadminv1.AdminAuthServiceDeleteSessionResponse{})
	response.Header().Add("Set-Cookie", auth.BuildClearedSessionCookie())
	if !ok {
		auth.AuditEvent(req.Header(), "admin_logout", "success", tenant.PublicID, "", "no_session_cookie")
		return response, nil
	}
	tokenHash := auth.HashToken(sessionToken)
	lookup, err := auth.LookupSessionByTokenHashForTenant(ctx, s.queries, tenant.ID, tokenHash, time.Now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "admin_logout", "success", tenant.PublicID, "", "session_not_found")
			return response, nil
		}
		auth.AuditEvent(req.Header(), "admin_logout", "failure", tenant.PublicID, "", "session_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if lookup.State == auth.SessionStateRevoked {
		auth.AuditEvent(req.Header(), "admin_logout", "success", tenant.PublicID, "", "already_revoked")
		return response, nil
	}
	if err := s.queriesFor(ctx).RevokeSession(ctx, lookup.Session.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_logout", "failure", tenant.PublicID, "", "session_revoke_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	auth.AuditEvent(req.Header(), "admin_logout", "success", tenant.PublicID, "", "session_revoked")
	return response, nil
}

func (s *adminServer) RequestPasswordReset(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceRequestPasswordResetRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceRequestPasswordResetResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	email := strings.TrimSpace(req.Msg.Email)
	if email == "" {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("email is required"))
	}
	if _, err := mail.ParseAddress(email); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, "", "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email address"))
	}

	user, err := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    email,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "admin_password_reset_request", "success", tenant.PublicID, "", "requested")
			return connect.NewResponse(&publiraadminv1.AdminAuthServiceRequestPasswordResetResponse{Requested: true}), nil
		}
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.queriesFor(ctx).DeleteUserPasswordResetTokensByUserID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_delete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resetToken := hex.EncodeToString(rawToken)
	tokenID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queriesFor(ctx).CreateUserPasswordResetToken(ctx, dbmodels.CreateUserPasswordResetTokenParams{
		ID:        tokenID,
		TenantID:  tenant.ID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(resetToken),
		ExpiresAt: time.Now().Add(passwordResetTokenTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.sendPasswordResetEmail(ctx, tenant, user.Email, resetToken); err != nil {
		_ = s.queriesFor(ctx).DeleteUserPasswordResetTokensByUserID(ctx, user.ID)
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, user.PublicID, "reset_email_send_failed")
		return nil, err
	}

	auth.AuditEvent(req.Header(), "admin_password_reset_request", "success", tenant.PublicID, user.PublicID, "requested")
	return connect.NewResponse(&publiraadminv1.AdminAuthServiceRequestPasswordResetResponse{Requested: true}), nil
}

func (s *adminServer) ConfirmPasswordReset(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceConfirmPasswordResetRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceConfirmPasswordResetResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	token := strings.TrimSpace(req.Msg.Token)
	newPassword := strings.TrimSpace(req.Msg.NewPassword)
	if token == "" || newPassword == "" {
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token and new_password are required"))
	}

	resetToken, err := s.queriesFor(ctx).GetUserPasswordResetTokenByHashForTenant(ctx, dbmodels.GetUserPasswordResetTokenByHashForTenantParams{
		TenantID:  tenant.ID,
		TokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "token_not_found")
			return nil, connect.NewError(connect.CodeNotFound, errors.New("password reset token not found"))
		}
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "token_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if resetToken.CompletedAt.Valid {
		return connect.NewResponse(&publiraadminv1.AdminAuthServiceConfirmPasswordResetResponse{Confirmed: true}), nil
	}
	if resetToken.ExpiresAt.Before(time.Now()) {
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "token_expired")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("password reset token expired"))
	}

	user, err := s.queriesFor(ctx).GetUserByID(ctx, resetToken.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "user_not_found")
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	passwordHash, err := auth.HashPassword(newPassword)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "password_hash_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if _, err := s.queriesFor(ctx).UpdateUserPasswordHashByID(ctx, dbmodels.UpdateUserPasswordHashByIDParams{
		ID:           user.ID,
		PasswordHash: passwordHash,
	}); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "password_update_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queriesFor(ctx).TerminateUserSessions(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "session_terminate_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queriesFor(ctx).MarkUserPasswordResetTokenCompleted(ctx, resetToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "token_complete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "success", tenant.PublicID, user.PublicID, "confirmed")
	return connect.NewResponse(&publiraadminv1.AdminAuthServiceConfirmPasswordResetResponse{Confirmed: true}), nil
}

func (s *adminServer) GetMe(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceGetMeRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceGetMeResponse], error) {
	_, user, role, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.AdminAuthServiceGetMeResponse{User: &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: role}}), nil
}

func (s *adminServer) GetTenant(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceGetTenantRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceGetTenantResponse], error) {
	tenant, _, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		return nil, err
	}

	adminDomain := ""
	if tenant.AdminDomain.Valid {
		adminDomain = tenant.AdminDomain.String
	}

	return connect.NewResponse(&publiraadminv1.AdminAuthServiceGetTenantResponse{
		Tenant: &publiraadminv1.AdminAuthServiceTenant{
			PublicId:    tenant.PublicID,
			Name:        tenant.Name,
			Domain:      tenant.Domain,
			AdminDomain: adminDomain,
		},
	}), nil
}

func (s *adminServer) GetTenantByDomain(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceGetTenantByDomainRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceGetTenantByDomainResponse], error) {
	domains := make([]string, 0, len(req.Msg.Domains))
	for _, candidate := range req.Msg.Domains {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}
		domains = append(domains, strings.ToLower(trimmed))
	}
	if len(domains) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("domains are required"))
	}

	tenant, err := s.queriesFor(ctx).GetAdminTenantByDomains(ctx, domains)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publiraadminv1.AdminAuthServiceGetTenantByDomainResponse{
		TenantPublicId: tenant.PublicID,
	}), nil
}

func (s *adminServer) GetTenantConfig(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceGetTenantConfigRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceGetTenantConfigResponse], error) {
	tenant, _, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		return nil, err
	}

	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewResponse(&publiraadminv1.AdminAuthServiceGetTenantConfigResponse{}), nil
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	response := &publiraadminv1.AdminAuthServiceGetTenantConfigResponse{}
	if config.CopyrightText.Valid {
		response.CopyrightText = config.CopyrightText.String
	}
	if config.SiteDescription.Valid {
		response.SiteDescription = config.SiteDescription.String
	}
	if config.SiteTagline.Valid {
		response.SiteTagline = config.SiteTagline.String
	}

	return connect.NewResponse(response), nil
}

func (s *adminServer) UpdateTenantConfig(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceUpdateTenantConfigRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceUpdateTenantConfigResponse], error) {
	tenant, _, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		return nil, err
	}

	copyrightText := sql.NullString{String: req.Msg.CopyrightText, Valid: strings.TrimSpace(req.Msg.CopyrightText) != ""}
	siteDescription := sql.NullString{String: req.Msg.SiteDescription, Valid: strings.TrimSpace(req.Msg.SiteDescription) != ""}
	siteTagline := sql.NullString{String: req.Msg.SiteTagline, Valid: strings.TrimSpace(req.Msg.SiteTagline) != ""}

	config, err := s.queriesFor(ctx).UpdateTenantConfig(ctx, dbmodels.UpdateTenantConfigParams{
		TenantID:        tenant.ID,
		CopyrightText:   copyrightText,
		SiteDescription: siteDescription,
		SiteTagline:     siteTagline,
	})
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		config, err = s.queriesFor(ctx).CreateTenantConfig(ctx, dbmodels.CreateTenantConfigParams{
			TenantID:        tenant.ID,
			CopyrightText:   copyrightText,
			SiteDescription: siteDescription,
			SiteTagline:     siteTagline,
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	response := &publiraadminv1.AdminAuthServiceUpdateTenantConfigResponse{}
	if config.CopyrightText.Valid {
		response.CopyrightText = config.CopyrightText.String
	}
	if config.SiteDescription.Valid {
		response.SiteDescription = config.SiteDescription.String
	}
	if config.SiteTagline.Valid {
		response.SiteTagline = config.SiteTagline.String
	}

	return connect.NewResponse(response), nil
}
