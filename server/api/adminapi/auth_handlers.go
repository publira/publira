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
	"github.com/jackc/pgx/v5/pgconn"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
)

const passwordResetTokenTTL = 24 * time.Hour
const emailChangeTokenTTL = 24 * time.Hour

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

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
	headers http.Header,
) (dbmodels.Tenant, dbmodels.User, string, error) {
	authCtx, err := s.authenticateSession(ctx, tenantCtx, headers)
	if err != nil {
		return dbmodels.Tenant{}, dbmodels.User{}, "", err
	}
	return authCtx.Tenant, authCtx.User, authCtx.Role, nil
}

func (s *adminServer) Login(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceLoginRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceLoginResponse], error) {
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
	if user.Status != "active" {
		auth.AuditEvent(req.Header(), "admin_login", "failure", tenant.PublicID, user.PublicID, "user_inactive")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
	}
	role, err := s.tenantRole(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	if s.tokens == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("token manager is not configured"))
	}
	token, expiresAt, err := s.tokens.Issue(user.PublicID, auth.AudienceAdmin, tenant.PublicID, role, user.CredentialsVersion, time.Now())
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_login", "failure", tenant.PublicID, user.PublicID, "token_issue_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resp := &publiraadminv1.AdminAuthServiceLoginResponse{
		User:        &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: role},
		AccessToken: &publirattypesv1.AccessToken{Token: token, ExpiresAt: auth.FormatExpiresAt(expiresAt)},
	}
	auth.AuditEvent(req.Header(), "admin_login", "success", tenant.PublicID, user.PublicID, "token_issued")
	return connect.NewResponse(resp), nil
}

func (s *adminServer) Logout(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceLogoutRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceLogoutResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_logout", "failure", "", "", "tenant_not_found")
		return nil, err
	}
	if _, ok := auth.BearerTokenFromHeader(req.Header()); ok {
		auth.AuditEvent(req.Header(), "admin_logout", "success", tenant.PublicID, "", "client_logout")
	} else {
		auth.AuditEvent(req.Header(), "admin_logout", "success", tenant.PublicID, "", "no_token")
	}
	return connect.NewResponse(&publiraadminv1.AdminAuthServiceLogoutResponse{}), nil
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
	if _, err := s.queriesFor(ctx).BumpUserCredentialsVersion(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "credentials_version_bump_failed")
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
	_, user, role, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.AdminAuthServiceGetMeResponse{User: &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: role}}), nil
}

func (s *adminServer) GetTenant(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceGetTenantRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceGetTenantResponse], error) {
	tenant, _, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
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
	tenant, _, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
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
	tenant, _, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
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

func adminEmailChangeConfirmationURL(tenant dbmodels.Tenant, token string) (string, error) {
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
	return "https://" + domain + "/confirm-email?token=" + url.QueryEscape(token), nil
}

func (s *adminServer) sendAdminEmailChangeVerificationEmail(
	ctx context.Context,
	tenant dbmodels.Tenant,
	recipientEmail string,
	recipientKind string,
	currentEmail string,
	newEmail string,
	token string,
) error {
	if s.mailer == nil {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("smtp sender is not configured"))
	}
	settings, err := s.resolveSMTPSettingsForTenant(ctx, tenant.ID)
	if err != nil {
		return err
	}
	confirmURL, err := adminEmailChangeConfirmationURL(tenant, token)
	if err != nil {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	subjectPrefix := strings.TrimSpace(tenant.Name)
	if subjectPrefix == "" {
		subjectPrefix = "Publira"
	}
	subject := subjectPrefix + " 管理画面メールアドレス変更確認"
	body := "管理画面アカウントのメールアドレス変更リクエストを受け付けました。\r\n"
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

func (s *adminServer) sendAdminEmailChangedNotice(
	ctx context.Context,
	tenant dbmodels.Tenant,
	oldEmail string,
	newEmail string,
) error {
	if s.mailer == nil {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("smtp sender is not configured"))
	}
	settings, err := s.resolveSMTPSettingsForTenant(ctx, tenant.ID)
	if err != nil {
		return err
	}
	subjectPrefix := strings.TrimSpace(tenant.Name)
	if subjectPrefix == "" {
		subjectPrefix = "Publira"
	}
	subject := subjectPrefix + " 管理画面メールアドレス変更完了"
	body := "管理画面アカウントのメールアドレスが変更されました。\r\n\r\n" +
		"変更前: " + oldEmail + "\r\n" +
		"変更後: " + newEmail + "\r\n\r\n" +
		"この変更に心当たりがない場合は、すぐにパスワード変更などの対応を行ってください。\r\n"
	if err := s.mailer.SendEmail(ctx, settings, oldEmail, subject, body); err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	return nil
}

func (s *adminServer) RequestEmailChange(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceRequestEmailChangeRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceRequestEmailChangeResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", "", "", "invalid_session")
		return nil, err
	}

	newEmail := strings.TrimSpace(req.Msg.NewEmail)
	currentEmail := strings.TrimSpace(req.Msg.CurrentEmail)
	currentPassword := strings.TrimSpace(req.Msg.CurrentPassword)
	if currentEmail == "" || newEmail == "" || currentPassword == "" {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("current_email, new_email and current_password are required"))
	}
	if _, err := mail.ParseAddress(currentEmail); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_current_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid current email address"))
	}
	if _, err := mail.ParseAddress(newEmail); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email address"))
	}
	if !strings.EqualFold(currentEmail, user.Email) {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "current_email_mismatch")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("current email does not match"))
	}
	if strings.EqualFold(newEmail, user.Email) {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "same_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("new email must be different from current email"))
	}
	if !auth.VerifyPassword(currentPassword, user.PasswordHash) {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_password")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid current password"))
	}

	_, err = s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    newEmail,
	})
	if err == nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "email_already_exists")
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
	}
	if !errors.Is(err, sql.ErrNoRows) {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.queriesFor(ctx).DeleteUserEmailChangeTokensByUserID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_delete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	currentEmailToken := hex.EncodeToString(rawToken)
	rawToken = make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	newEmailToken := hex.EncodeToString(rawToken)
	tokenID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queriesFor(ctx).CreateUserEmailChangeToken(ctx, dbmodels.CreateUserEmailChangeTokenParams{
		ID:                    tokenID,
		TenantID:              tenant.ID,
		UserID:                user.ID,
		CurrentEmail:          user.Email,
		NewEmail:              newEmail,
		CurrentEmailTokenHash: auth.HashToken(currentEmailToken),
		NewEmailTokenHash:     auth.HashToken(newEmailToken),
		ExpiresAt:             time.Now().Add(emailChangeTokenTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.sendAdminEmailChangeVerificationEmail(ctx, tenant, user.Email, "current_email", user.Email, newEmail, currentEmailToken); err != nil {
		_ = s.queriesFor(ctx).DeleteUserEmailChangeTokensByUserID(ctx, user.ID)
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "current_email_send_failed")
		return nil, err
	}
	if err := s.sendAdminEmailChangeVerificationEmail(ctx, tenant, newEmail, "new_email", user.Email, newEmail, newEmailToken); err != nil {
		_ = s.queriesFor(ctx).DeleteUserEmailChangeTokensByUserID(ctx, user.ID)
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "new_email_send_failed")
		return nil, err
	}

	auth.AuditEvent(req.Header(), "admin_email_change_request", "success", tenant.PublicID, user.PublicID, "confirmation_emails_sent")
	return connect.NewResponse(&publiraadminv1.AdminAuthServiceRequestEmailChangeResponse{Requested: true}), nil
}

func (s *adminServer) ConfirmEmailChange(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceConfirmEmailChangeRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceConfirmEmailChangeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	token := strings.TrimSpace(req.Msg.Token)
	if token == "" {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, "", "invalid_token")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is required"))
	}

	changeToken, err := s.queriesFor(ctx).GetUserEmailChangeTokenByHashForTenant(ctx, dbmodels.GetUserEmailChangeTokenByHashForTenantParams{
		TenantID:              tenant.ID,
		CurrentEmailTokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, "", "token_not_found")
			return nil, connect.NewError(connect.CodeNotFound, errors.New("email change token not found"))
		}
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, "", "token_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if changeToken.CompletedAt.Valid {
		return connect.NewResponse(&publiraadminv1.AdminAuthServiceConfirmEmailChangeResponse{Confirmed: true, Changed: true}), nil
	}
	if changeToken.ExpiresAt.Before(time.Now()) {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, "", "token_expired")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change token expired"))
	}

	user, err := s.queriesFor(ctx).GetUserByID(ctx, changeToken.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, "", "user_not_found")
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !strings.EqualFold(user.Email, changeToken.CurrentEmail) {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "stale_request")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change request is no longer valid"))
	}

	matchedTarget := changeToken.MatchedTarget
	if matchedTarget == "current_email" {
		if err := s.queriesFor(ctx).MarkUserEmailChangeCurrentEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "current_email_confirm_failed")
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	} else {
		if err := s.queriesFor(ctx).MarkUserEmailChangeNewEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "new_email_confirm_failed")
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
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "success", tenant.PublicID, user.PublicID, "waiting_for_"+pendingTarget)
		return connect.NewResponse(&publiraadminv1.AdminAuthServiceConfirmEmailChangeResponse{
			Confirmed:              true,
			Changed:                false,
			PendingConfirmationFor: pendingTarget,
		}), nil
	}

	if _, err := s.queriesFor(ctx).UpdateUserEmailByID(ctx, dbmodels.UpdateUserEmailByIDParams{
		ID:    user.ID,
		Email: changeToken.NewEmail,
	}); err != nil {
		if isUniqueViolation(err) {
			auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "email_already_exists")
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
		}
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "email_update_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queriesFor(ctx).MarkUserEmailChangeCompleted(ctx, changeToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "request_complete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.sendAdminEmailChangedNotice(ctx, tenant, changeToken.CurrentEmail, changeToken.NewEmail); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "old_email_notice_failed")
		return nil, err
	}

	auth.AuditEvent(req.Header(), "admin_email_change_confirm", "success", tenant.PublicID, user.PublicID, "email_changed")
	return connect.NewResponse(&publiraadminv1.AdminAuthServiceConfirmEmailChangeResponse{Confirmed: true, Changed: true}), nil
}
