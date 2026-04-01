package publicapi

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

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const emailVerificationTokenTTL = 24 * time.Hour

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func generatePublicID() string {
	raw := strings.ReplaceAll(uuid.NewString(), "-", "")
	return strings.ToUpper(raw[:12])
}

func (s *apiServer) issueUserSession(
	ctx context.Context,
	tenant dbmodels.Tenant,
	user dbmodels.User,
	role string,
) (*connect.Response[publirav1.CreateSessionResponse], error) {
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	sessionToken := hex.EncodeToString(rawToken)
	sessionID, err := uuid.NewV7()
	if err != nil {
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &publirav1.CreateSessionResponse{
		User: &publirattypesv1.User{
			PublicId: user.PublicID,
			Name:     user.Name,
			Role:     role,
		},
		Session: &publirattypesv1.Session{
			SessionId: sessionToken,
			ExpiresAt: createdSession.ExpiresAt.UTC().Format(time.RFC3339),
		},
	}
	response := connect.NewResponse(resp)
	response.Header().Add("Set-Cookie", auth.BuildSessionCookie(sessionToken, createdSession.ExpiresAt))
	return response, nil
}

func (s *apiServer) tenantRole(ctx context.Context, userID uuid.UUID) (string, error) {
	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, userID)
	if err != nil {
		return "", connect.NewError(connect.CodeInternal, err)
	}
	return auth.ResolveTenantRole(roles), nil
}

func (s *apiServer) authenticateSession(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	explicitToken string,
	headers http.Header,
) (rpcmiddleware.SessionContext, error) {
	tenant, err := s.tenantByContext(ctx, tenantCtx)
	if err != nil {
		return rpcmiddleware.SessionContext{}, err
	}
	sessionToken, ok := auth.SessionTokenFromRequest(explicitToken, headers)
	if !ok {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	lookup, err := auth.LookupSessionByTokenHashForTenant(ctx, s.queries, tenant.ID, auth.HashToken(sessionToken), time.Now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, err)
	}
	if lookup.State != auth.SessionStateActive {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	return rpcmiddleware.SessionContext{Tenant: tenant, Session: lookup.Session}, nil
}

func (s *apiServer) currentUserFromSession(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	explicitToken string,
	headers http.Header,
) (dbmodels.Tenant, dbmodels.User, string, error) {
	authCtx, err := s.authenticateSession(ctx, tenantCtx, explicitToken, headers)
	if err != nil {
		return dbmodels.Tenant{}, dbmodels.User{}, "", err
	}
	user, err := s.queriesFor(ctx).GetUserByID(ctx, authCtx.Session.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Tenant{}, dbmodels.User{}, "", invalidSessionError()
		}
		return dbmodels.Tenant{}, dbmodels.User{}, "", connect.NewError(connect.CodeInternal, err)
	}
	role, err := s.tenantRole(ctx, user.ID)
	if err != nil {
		return dbmodels.Tenant{}, dbmodels.User{}, "", err
	}
	return authCtx.Tenant, user, role, nil
}

func (s *apiServer) CreateSession(
	ctx context.Context,
	req *connect.Request[publirav1.CreateSessionRequest],
) (*connect.Response[publirav1.CreateSessionResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "login", "failure", "", "", "tenant_not_found")
		return nil, err
	}
	user, err := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true}, Email: req.Msg.Email})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "login", "failure", tenant.PublicID, "", "invalid_credentials")
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
		}
		auth.AuditEvent(req.Header(), "login", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !auth.VerifyPassword(req.Msg.Password, user.PasswordHash) {
		auth.AuditEvent(req.Header(), "login", "failure", tenant.PublicID, user.PublicID, "invalid_credentials")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
	}
	if user.Status != "active" || !user.EmailVerifiedAt.Valid {
		auth.AuditEvent(req.Header(), "login", "failure", tenant.PublicID, user.PublicID, "email_not_verified")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email is not verified"))
	}
	role, err := s.tenantRole(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	response, err := s.issueUserSession(ctx, tenant, user, role)
	if err != nil {
		auth.AuditEvent(req.Header(), "login", "failure", tenant.PublicID, user.PublicID, "session_create_failed")
		return nil, err
	}
	auth.AuditEvent(req.Header(), "login", "success", tenant.PublicID, user.PublicID, "session_issued")
	return response, nil
}

func tenantEmailSettingsFromRow(config dbmodels.TenantSmtpConfig, password string) emailsettings.SMTPSettings {
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

func platformEmailSettingsFromRow(config dbmodels.PlatformSmtpConfig, password string) emailsettings.SMTPSettings {
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

func (s *apiServer) resolveSMTPSettingsForTenant(ctx context.Context, tenantID uuid.UUID) (emailsettings.SMTPSettings, error) {
	tenantConfig, err := s.queriesFor(ctx).GetTenantSMTPConfigByTenantID(ctx, tenantID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeInternal, err)
	}
	if err == nil && tenantConfig.SmtpOverrideEnabled {
		password, decryptErr := emailsettings.DecryptPassword(tenantConfig.PasswordEncrypted.String, s.encryptor)
		if decryptErr != nil {
			return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("tenant smtp settings are not configured"))
		}
		settings := tenantEmailSettingsFromRow(tenantConfig, password)
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
	settings := platformEmailSettingsFromRow(platformConfig, password)
	if validateErr := emailsettings.Validate(settings, true); validateErr != nil {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, validateErr)
	}
	return settings, nil
}

func verificationURL(tenant dbmodels.Tenant, token string) (string, error) {
	domain := strings.TrimSpace(tenant.Domain)
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimSuffix(domain, "/")
	if domain == "" {
		return "", errors.New("tenant domain is not configured")
	}
	return "https://" + domain + "/verify?token=" + url.QueryEscape(token), nil
}

func emailChangeConfirmationURL(tenant dbmodels.Tenant, token string) (string, error) {
	domain := strings.TrimSpace(tenant.Domain)
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimSuffix(domain, "/")
	if domain == "" {
		return "", errors.New("tenant domain is not configured")
	}
	return "https://" + domain + "/confirm-email?token=" + url.QueryEscape(token), nil
}

func passwordResetConfirmationURL(tenant dbmodels.Tenant, token string) (string, error) {
	domain := strings.TrimSpace(tenant.Domain)
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimSuffix(domain, "/")
	if domain == "" {
		return "", errors.New("tenant domain is not configured")
	}
	return "https://" + domain + "/confirm-password?token=" + url.QueryEscape(token), nil
}

func (s *apiServer) sendVerificationEmail(ctx context.Context, tenant dbmodels.Tenant, user dbmodels.User, token string) error {
	if s.mailer == nil {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("smtp sender is not configured"))
	}
	settings, err := s.resolveSMTPSettingsForTenant(ctx, tenant.ID)
	if err != nil {
		return err
	}
	verifyURL, err := verificationURL(tenant, token)
	if err != nil {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	subjectPrefix := strings.TrimSpace(tenant.Name)
	if subjectPrefix == "" {
		subjectPrefix = "Publira"
	}
	subject := subjectPrefix + " メールアドレス確認"
	body := "Publira のご登録ありがとうございます。\r\n" +
		"以下のリンクを開いてメールアドレス確認を完了してください。\r\n\r\n" +
		verifyURL + "\r\n\r\n" +
		"このリンクの有効期限は24時間です。\r\n"
	if err := s.mailer.SendEmail(ctx, settings, user.Email, subject, body); err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	return nil
}

func (s *apiServer) sendEmailChangeVerificationEmail(
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
	confirmURL, err := emailChangeConfirmationURL(tenant, token)
	if err != nil {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	subjectPrefix := strings.TrimSpace(tenant.Name)
	if subjectPrefix == "" {
		subjectPrefix = "Publira"
	}
	subject := subjectPrefix + " メールアドレス変更確認"
	body := "メールアドレス変更のリクエストを受け付けました。\r\n"
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

func (s *apiServer) sendEmailChangedNotice(
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
	subject := subjectPrefix + " メールアドレス変更完了"
	body := "アカウントのメールアドレスが変更されました。\r\n\r\n" +
		"変更前: " + oldEmail + "\r\n" +
		"変更後: " + newEmail + "\r\n\r\n" +
		"この変更に心当たりがない場合は、すぐにパスワード変更などの対応を行ってください。\r\n"
	if err := s.mailer.SendEmail(ctx, settings, oldEmail, subject, body); err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	return nil
}

func (s *apiServer) sendPasswordResetEmail(
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
	confirmURL, err := passwordResetConfirmationURL(tenant, token)
	if err != nil {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	subjectPrefix := strings.TrimSpace(tenant.Name)
	if subjectPrefix == "" {
		subjectPrefix = "Publira"
	}
	subject := subjectPrefix + " パスワード再設定"
	body := "パスワード再設定のリクエストを受け付けました。\r\n" +
		"以下のリンクを開いて新しいパスワードを設定してください。\r\n\r\n" +
		confirmURL + "\r\n\r\n" +
		"このリンクの有効期限は24時間です。\r\n" +
		"心当たりがない場合、このメールは破棄してください。\r\n"
	if err := s.mailer.SendEmail(ctx, settings, recipientEmail, subject, body); err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	return nil
}

func (s *apiServer) CreateUser(
	ctx context.Context,
	req *connect.Request[publirav1.CreateUserRequest],
) (*connect.Response[publirav1.CreateUserResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	name := strings.TrimSpace(req.Msg.Name)
	email := strings.TrimSpace(req.Msg.Email)
	password := strings.TrimSpace(req.Msg.Password)
	if name == "" || email == "" || password == "" {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name, email, and password are required"))
	}
	if _, err := mail.ParseAddress(email); err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email address"))
	}

	_, err = s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    email,
	})
	if err == nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "email_already_exists")
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
	}
	if !errors.Is(err, sql.ErrNoRows) {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "password_hash_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	userID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "user_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	user, err := s.queriesFor(ctx).CreateUser(ctx, dbmodels.CreateUserParams{
		ID:           userID,
		TenantID:     uuid.NullUUID{UUID: tenant.ID, Valid: true},
		PublicID:     generatePublicID(),
		Email:        email,
		PasswordHash: passwordHash,
		Name:         name,
	})
	if err != nil {
		if isUniqueViolation(err) {
			auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "email_already_exists")
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
		}
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "user_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	user, err = s.queriesFor(ctx).UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{ID: user.ID, Status: "inactive"})
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "set_inactive_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	verificationToken := hex.EncodeToString(rawToken)
	verificationID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "token_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queriesFor(ctx).CreateUserEmailVerificationToken(ctx, dbmodels.CreateUserEmailVerificationTokenParams{
		ID:        verificationID,
		TenantID:  tenant.ID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(verificationToken),
		ExpiresAt: time.Now().Add(emailVerificationTokenTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.sendVerificationEmail(ctx, tenant, user, verificationToken); err != nil {
		_ = s.queriesFor(ctx).DeleteUserByID(ctx, user.ID)
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "verification_email_send_failed")
		return nil, err
	}
	auth.AuditEvent(req.Header(), "signup", "success", tenant.PublicID, user.PublicID, "verification_email_sent")
	response := connect.NewResponse(&publirav1.CreateUserResponse{
		User: &publirattypesv1.User{
			PublicId: user.PublicID,
			Name:     user.Name,
		},
	})
	return response, nil
}

func (s *apiServer) VerifyUserEmail(
	ctx context.Context,
	req *connect.Request[publirav1.VerifyUserEmailRequest],
) (*connect.Response[publirav1.VerifyUserEmailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	token := strings.TrimSpace(req.Msg.Token)
	if token == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is required"))
	}
	verificationToken, err := s.queriesFor(ctx).GetUserEmailVerificationTokenByHashForTenant(ctx, dbmodels.GetUserEmailVerificationTokenByHashForTenantParams{
		TenantID:  tenant.ID,
		TokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("verification token not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if verificationToken.UsedAt.Valid {
		return connect.NewResponse(&publirav1.VerifyUserEmailResponse{Verified: true}), nil
	}
	if verificationToken.ExpiresAt.Before(time.Now()) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("verification token expired"))
	}
	user, err := s.queriesFor(ctx).GetUserByID(ctx, verificationToken.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queriesFor(ctx).MarkUserEmailVerificationTokenUsed(ctx, verificationToken.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if _, err := s.queriesFor(ctx).UpdateUserEmailVerifiedAtByID(ctx, dbmodels.UpdateUserEmailVerifiedAtByIDParams{
		ID:              user.ID,
		EmailVerifiedAt: sql.NullTime{Time: time.Now(), Valid: true},
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if _, err := s.queriesFor(ctx).UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{ID: user.ID, Status: "active"}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.VerifyUserEmailResponse{Verified: true}), nil
}

func (s *apiServer) RequestEmailChange(
	ctx context.Context,
	req *connect.Request[publirav1.RequestEmailChangeRequest],
) (*connect.Response[publirav1.RequestEmailChangeResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", "", "", "invalid_session")
		return nil, err
	}

	newEmail := strings.TrimSpace(req.Msg.NewEmail)
	currentEmail := strings.TrimSpace(req.Msg.CurrentEmail)
	currentPassword := strings.TrimSpace(req.Msg.CurrentPassword)
	if currentEmail == "" || newEmail == "" || currentPassword == "" {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("current_email, new_email and current_password are required"))
	}
	if _, err := mail.ParseAddress(currentEmail); err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_current_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid current email address"))
	}
	if _, err := mail.ParseAddress(newEmail); err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email address"))
	}
	if !strings.EqualFold(currentEmail, user.Email) {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "current_email_mismatch")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("current email does not match"))
	}
	if strings.EqualFold(newEmail, user.Email) {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "same_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("new email must be different from current email"))
	}
	if !auth.VerifyPassword(currentPassword, user.PasswordHash) {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_password")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid current password"))
	}

	_, err = s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    newEmail,
	})
	if err == nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "email_already_exists")
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
	}
	if !errors.Is(err, sql.ErrNoRows) {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.queriesFor(ctx).DeleteUserEmailChangeTokensByUserID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "token_delete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	currentEmailToken := hex.EncodeToString(rawToken)
	rawToken = make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	newEmailToken := hex.EncodeToString(rawToken)
	tokenID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "token_id_generation_failed")
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
		ExpiresAt:             time.Now().Add(emailVerificationTokenTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.sendEmailChangeVerificationEmail(ctx, tenant, user.Email, "current_email", user.Email, newEmail, currentEmailToken); err != nil {
		_ = s.queriesFor(ctx).DeleteUserEmailChangeTokensByUserID(ctx, user.ID)
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "current_email_send_failed")
		return nil, err
	}
	if err := s.sendEmailChangeVerificationEmail(ctx, tenant, newEmail, "new_email", user.Email, newEmail, newEmailToken); err != nil {
		_ = s.queriesFor(ctx).DeleteUserEmailChangeTokensByUserID(ctx, user.ID)
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "new_email_send_failed")
		return nil, err
	}

	auth.AuditEvent(req.Header(), "email_change_request", "success", tenant.PublicID, user.PublicID, "confirmation_emails_sent")
	return connect.NewResponse(&publirav1.RequestEmailChangeResponse{Requested: true}), nil
}

func (s *apiServer) ConfirmEmailChange(
	ctx context.Context,
	req *connect.Request[publirav1.ConfirmEmailChangeRequest],
) (*connect.Response[publirav1.ConfirmEmailChangeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	token := strings.TrimSpace(req.Msg.Token)
	if token == "" {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, "", "invalid_token")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is required"))
	}

	changeToken, err := s.queriesFor(ctx).GetUserEmailChangeTokenByHashForTenant(ctx, dbmodels.GetUserEmailChangeTokenByHashForTenantParams{
		TenantID:              tenant.ID,
		CurrentEmailTokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, "", "token_not_found")
			return nil, connect.NewError(connect.CodeNotFound, errors.New("email change token not found"))
		}
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, "", "token_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if changeToken.CompletedAt.Valid {
		return connect.NewResponse(&publirav1.ConfirmEmailChangeResponse{Confirmed: true, Changed: true}), nil
	}
	if changeToken.ExpiresAt.Before(time.Now()) {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, "", "token_expired")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change token expired"))
	}

	user, err := s.queriesFor(ctx).GetUserByID(ctx, changeToken.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, "", "user_not_found")
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !strings.EqualFold(user.Email, changeToken.CurrentEmail) {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "stale_request")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change request is no longer valid"))
	}

	matchedTarget := changeToken.MatchedTarget
	if matchedTarget == "current_email" {
		if err := s.queriesFor(ctx).MarkUserEmailChangeCurrentEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "current_email_confirm_failed")
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	} else {
		if err := s.queriesFor(ctx).MarkUserEmailChangeNewEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "new_email_confirm_failed")
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
		auth.AuditEvent(req.Header(), "email_change_confirm", "success", tenant.PublicID, user.PublicID, "waiting_for_"+pendingTarget)
		return connect.NewResponse(&publirav1.ConfirmEmailChangeResponse{
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
			auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "email_already_exists")
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
		}
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "email_update_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queriesFor(ctx).MarkUserEmailChangeCompleted(ctx, changeToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "request_complete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.sendEmailChangedNotice(ctx, tenant, changeToken.CurrentEmail, changeToken.NewEmail); err != nil {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "old_email_notice_failed")
		return nil, err
	}

	auth.AuditEvent(req.Header(), "email_change_confirm", "success", tenant.PublicID, user.PublicID, "email_changed")
	return connect.NewResponse(&publirav1.ConfirmEmailChangeResponse{Confirmed: true, Changed: true}), nil
}

func (s *apiServer) RequestPasswordReset(
	ctx context.Context,
	req *connect.Request[publirav1.RequestPasswordResetRequest],
) (*connect.Response[publirav1.RequestPasswordResetResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	email := strings.TrimSpace(req.Msg.Email)
	if email == "" {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("email is required"))
	}
	if _, err := mail.ParseAddress(email); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, "", "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email address"))
	}

	user, err := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    email,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "password_reset_request", "success", tenant.PublicID, "", "requested")
			return connect.NewResponse(&publirav1.RequestPasswordResetResponse{Requested: true}), nil
		}
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.queriesFor(ctx).DeleteUserPasswordResetTokensByUserID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_delete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resetToken := hex.EncodeToString(rawToken)
	tokenID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queriesFor(ctx).CreateUserPasswordResetToken(ctx, dbmodels.CreateUserPasswordResetTokenParams{
		ID:        tokenID,
		TenantID:  tenant.ID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(resetToken),
		ExpiresAt: time.Now().Add(emailVerificationTokenTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.sendPasswordResetEmail(ctx, tenant, user.Email, resetToken); err != nil {
		_ = s.queriesFor(ctx).DeleteUserPasswordResetTokensByUserID(ctx, user.ID)
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, user.PublicID, "reset_email_send_failed")
		return nil, err
	}

	auth.AuditEvent(req.Header(), "password_reset_request", "success", tenant.PublicID, user.PublicID, "requested")
	return connect.NewResponse(&publirav1.RequestPasswordResetResponse{Requested: true}), nil
}

func (s *apiServer) ConfirmPasswordReset(
	ctx context.Context,
	req *connect.Request[publirav1.ConfirmPasswordResetRequest],
) (*connect.Response[publirav1.ConfirmPasswordResetResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	token := strings.TrimSpace(req.Msg.Token)
	newPassword := strings.TrimSpace(req.Msg.NewPassword)
	if token == "" || newPassword == "" {
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token and new_password are required"))
	}

	resetToken, err := s.queriesFor(ctx).GetUserPasswordResetTokenByHashForTenant(ctx, dbmodels.GetUserPasswordResetTokenByHashForTenantParams{
		TenantID:  tenant.ID,
		TokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, "", "token_not_found")
			return nil, connect.NewError(connect.CodeNotFound, errors.New("password reset token not found"))
		}
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, "", "token_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if resetToken.CompletedAt.Valid {
		return connect.NewResponse(&publirav1.ConfirmPasswordResetResponse{Confirmed: true}), nil
	}
	if resetToken.ExpiresAt.Before(time.Now()) {
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, "", "token_expired")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("password reset token expired"))
	}

	user, err := s.queriesFor(ctx).GetUserByID(ctx, resetToken.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, "", "user_not_found")
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	passwordHash, err := auth.HashPassword(newPassword)
	if err != nil {
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "password_hash_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if _, err := s.queriesFor(ctx).UpdateUserPasswordHashByID(ctx, dbmodels.UpdateUserPasswordHashByIDParams{
		ID:           user.ID,
		PasswordHash: passwordHash,
	}); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "password_update_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queriesFor(ctx).TerminateUserSessions(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "session_terminate_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queriesFor(ctx).MarkUserPasswordResetTokenCompleted(ctx, resetToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "token_complete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	auth.AuditEvent(req.Header(), "password_reset_confirm", "success", tenant.PublicID, user.PublicID, "confirmed")
	return connect.NewResponse(&publirav1.ConfirmPasswordResetResponse{Confirmed: true}), nil
}

func (s *apiServer) DeleteSession(
	ctx context.Context,
	req *connect.Request[publirav1.DeleteSessionRequest],
) (*connect.Response[publirav1.DeleteSessionResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "logout", "failure", "", "", "tenant_not_found")
		return nil, err
	}
	sessionToken, ok := auth.SessionTokenFromRequest(req.Msg.SessionId, req.Header())
	response := connect.NewResponse(&publirav1.DeleteSessionResponse{})
	response.Header().Add("Set-Cookie", auth.BuildClearedSessionCookie())
	if !ok {
		auth.AuditEvent(req.Header(), "logout", "success", tenant.PublicID, "", "no_session_cookie")
		return response, nil
	}
	tokenHash := auth.HashToken(sessionToken)
	lookup, err := auth.LookupSessionByTokenHashForTenant(ctx, s.queries, tenant.ID, tokenHash, time.Now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "logout", "success", tenant.PublicID, "", "session_not_found")
			return response, nil
		}
		auth.AuditEvent(req.Header(), "logout", "failure", tenant.PublicID, "", "session_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if lookup.State == auth.SessionStateRevoked {
		auth.AuditEvent(req.Header(), "logout", "success", tenant.PublicID, "", "already_revoked")
		return response, nil
	}
	if err := s.queriesFor(ctx).RevokeSession(ctx, lookup.Session.ID); err != nil {
		auth.AuditEvent(req.Header(), "logout", "failure", tenant.PublicID, "", "session_revoke_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	auth.AuditEvent(req.Header(), "logout", "success", tenant.PublicID, "", "session_revoked")
	return response, nil
}

func (s *apiServer) GetMe(
	ctx context.Context,
	req *connect.Request[publirav1.GetMeRequest],
) (*connect.Response[publirav1.GetMeResponse], error) {
	_, user, role, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publirav1.GetMeResponse{User: &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: role}}), nil
}

func (s *apiServer) UpdateMe(
	ctx context.Context,
	req *connect.Request[publirav1.UpdateMeRequest],
) (*connect.Response[publirav1.UpdateMeResponse], error) {
	_, user, role, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		auth.AuditEvent(req.Header(), "update_me", "failure", "", "", "invalid_session")
		return nil, err
	}
	name := strings.TrimSpace(req.Msg.Name)
	if name == "" {
		auth.AuditEvent(req.Header(), "update_me", "failure", user.PublicID, user.PublicID, "invalid_name")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	if len([]rune(name)) > 100 {
		auth.AuditEvent(req.Header(), "update_me", "failure", user.PublicID, user.PublicID, "name_too_long")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name must be 100 characters or fewer"))
	}
	updated, err := s.queriesFor(ctx).UpdateUserNameByID(ctx, dbmodels.UpdateUserNameByIDParams{
		ID:   user.ID,
		Name: name,
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "update_me", "failure", user.PublicID, user.PublicID, "update_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	auth.AuditEvent(req.Header(), "update_me", "success", user.PublicID, user.PublicID, "name_updated")
	return connect.NewResponse(&publirav1.UpdateMeResponse{User: &publirattypesv1.User{PublicId: updated.PublicID, Name: updated.Name, Role: role}}), nil
}

func (s *apiServer) DeleteMe(
	ctx context.Context,
	req *connect.Request[publirav1.DeleteMeRequest],
) (*connect.Response[publirav1.DeleteMeResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		auth.AuditEvent(req.Header(), "delete_me", "failure", "", "", "invalid_session")
		return nil, err
	}
	password := strings.TrimSpace(req.Msg.Password)
	if password == "" {
		auth.AuditEvent(req.Header(), "delete_me", "failure", tenant.PublicID, user.PublicID, "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("password is required"))
	}
	if !auth.VerifyPassword(password, user.PasswordHash) {
		auth.AuditEvent(req.Header(), "delete_me", "failure", tenant.PublicID, user.PublicID, "invalid_password")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid password"))
	}
	if err := s.queriesFor(ctx).TerminateUserSessions(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "delete_me", "failure", tenant.PublicID, user.PublicID, "session_terminate_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if err := s.queriesFor(ctx).DeleteUserByID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "delete_me", "failure", tenant.PublicID, user.PublicID, "delete_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	auth.AuditEvent(req.Header(), "delete_me", "success", tenant.PublicID, user.PublicID, "user_deleted")
	response := connect.NewResponse(&publirav1.DeleteMeResponse{})
	response.Header().Add("Set-Cookie", auth.BuildClearedSessionCookie())
	return response, nil
}

func (s *apiServer) GetNotificationSettings(
	ctx context.Context,
	req *connect.Request[publirav1.GetNotificationSettingsRequest],
) (*connect.Response[publirav1.GetNotificationSettingsResponse], error) {
	_, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		return nil, err
	}
	settings, err := s.queriesFor(ctx).GetUserNotificationSettings(ctx, user.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewResponse(&publirav1.GetNotificationSettingsResponse{EmailNotificationsEnabled: true}), nil
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.GetNotificationSettingsResponse{EmailNotificationsEnabled: settings.EmailNotificationsEnabled}), nil
}

func (s *apiServer) UpdateNotificationSettings(
	ctx context.Context,
	req *connect.Request[publirav1.UpdateNotificationSettingsRequest],
) (*connect.Response[publirav1.UpdateNotificationSettingsResponse], error) {
	_, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		return nil, err
	}
	updated, err := s.queriesFor(ctx).UpsertUserNotificationSettings(ctx, dbmodels.UpsertUserNotificationSettingsParams{
		UserID:                    user.ID,
		EmailNotificationsEnabled: req.Msg.EmailNotificationsEnabled,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&publirav1.UpdateNotificationSettingsResponse{EmailNotificationsEnabled: updated.EmailNotificationsEnabled}), nil
}
