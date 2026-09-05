package adminapi

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

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

const passwordResetTokenTTL = 24 * time.Hour
const emailChangeTokenTTL = 24 * time.Hour

func enqueueAdminPasswordResetEmail(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, tokenID uuid.UUID,
	token string,
) error {
	payload, err := json.Marshal(outbox.AdminPasswordResetEmailPayload{
		TenantID: tenantID.String(),
		TokenID:  tokenID.String(),
		Token:    token,
	})
	if err != nil {
		return fmt.Errorf("marshal admin password reset email event: %w", err)
	}
	return insertAdminOutboxEvent(ctx, queries, tenantID, outbox.EventTypeAdminPasswordResetEmail, payload,
		"admin_password_reset_email:"+tokenID.String())
}

// enqueueAdminEmailChangeConfirmationEmail queues the mail for one side of an
// address change. The key names the side, so the two events of one request
// stay distinct and each address is retried on its own.
func enqueueAdminEmailChangeConfirmationEmail(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, tokenID uuid.UUID,
	recipientKind, token string,
) error {
	payload, err := json.Marshal(outbox.AdminEmailChangeConfirmationEmailPayload{
		TenantID: tenantID.String(),
		TokenID:  tokenID.String(),
		Token:    token,
	})
	if err != nil {
		return fmt.Errorf("marshal admin email change confirmation email event: %w", err)
	}
	return insertAdminOutboxEvent(ctx, queries, tenantID, outbox.EventTypeAdminEmailChangeConfirmationEmail, payload,
		"admin_email_change_confirmation_email:"+tokenID.String()+":"+recipientKind)
}

func enqueueAdminEmailChangedNoticeEmail(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, tokenID uuid.UUID,
) error {
	payload, err := json.Marshal(outbox.AdminEmailChangedNoticeEmailPayload{
		TenantID: tenantID.String(),
		TokenID:  tokenID.String(),
	})
	if err != nil {
		return fmt.Errorf("marshal admin email changed notice email event: %w", err)
	}
	return insertAdminOutboxEvent(ctx, queries, tenantID, outbox.EventTypeAdminEmailChangedNoticeEmail, payload,
		"admin_email_changed_notice_email:"+tokenID.String())
}

func insertAdminOutboxEvent(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	eventType string,
	payload []byte,
	idempotencyKey string,
) error {
	eventID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate outbox event id: %w", err)
	}
	_, err = queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             eventID,
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
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

func (s *adminServer) tenantRole(ctx context.Context, userID uuid.UUID) (string, error) {
	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, userID)
	if err != nil {
		return "", s.internalDBError(ctx, "failed to list tenant user roles", err, "user_id", userID.String())
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
		return nil, s.internalDBError(ctx, "failed to get user for login", err, "tenant_id", tenant.ID.String())
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

	// The password is right, but it is only half of what this account owes.
	// A challenge is handed out instead of a session, so nothing signed by
	// this request can act on the tenant until the factor is settled.
	challengeKind, err := s.mfaChallengeKindFor(ctx, user, role)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_login", "failure", tenant.PublicID, user.PublicID, "mfa_state_lookup_failed")
		return nil, err
	}
	if challengeKind != publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED {
		challenge, err := s.mfaChallengeFor(tenant, user, challengeKind)
		if err != nil {
			auth.AuditEvent(req.Header(), "admin_login", "failure", tenant.PublicID, user.PublicID, "mfa_challenge_issue_failed")
			return nil, err
		}
		auth.AuditEvent(req.Header(), "admin_login", "success", tenant.PublicID, user.PublicID, "mfa_challenge_issued")
		return connect.NewResponse(&publiraadminv1.AdminAuthServiceLoginResponse{MfaChallenge: challenge}), nil
	}

	token, expiresAt, err := s.tokens.Issue(user.PublicID, auth.AudienceAdmin, tenant.ID.String(), role, user.CredentialsVersion, time.Now())
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
		return nil, s.internalDBError(ctx, "failed to get user for password reset", err, "tenant_id", tenant.ID.String())
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

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, user.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin password reset transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	if err := txq.DeleteUserPasswordResetTokensByUserID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_delete_failed")
		return nil, s.internalDBError(ctx, "failed to delete password reset tokens", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if _, err := txq.CreateUserPasswordResetToken(ctx, dbmodels.CreateUserPasswordResetTokenParams{
		ID:        tokenID,
		TenantID:  tenant.ID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(resetToken),
		ExpiresAt: time.Now().Add(passwordResetTokenTTL),
	}); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, s.internalDBError(ctx, "failed to create password reset token", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := enqueueAdminPasswordResetEmail(ctx, txq, tenant.ID, tokenID, resetToken); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, user.PublicID, "reset_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue admin password reset email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_request", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit password reset transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to get password reset token", err, "tenant_id", tenant.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to get user for password reset confirm", err, "tenant_id", tenant.ID.String(), "user_id", resetToken.UserID.String())
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
		return nil, s.internalDBError(ctx, "failed to update password", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if _, err := s.queriesFor(ctx).BumpUserCredentialsVersion(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "credentials_version_bump_failed")
		return nil, s.internalDBError(ctx, "failed to bump credentials version", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := s.queriesFor(ctx).MarkUserPasswordResetTokenCompleted(ctx, resetToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "token_complete_failed")
		return nil, s.internalDBError(ctx, "failed to complete password reset token", err, "tenant_id", tenant.ID.String(), "token_id", resetToken.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to get tenant by domain", err)
	}

	defaultLocale, err := locale.Resolve(tenant.DefaultLocale)
	if err != nil {
		return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.AdminAuthServiceGetTenantByDomainResponse{
		TenantId:      tenant.ID.String(),
		DefaultLocale: defaultLocale,
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
		return nil, s.internalDBError(ctx, "failed to get tenant config", err, "tenant_id", tenant.ID.String())
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
			return nil, s.internalDBError(ctx, "failed to update tenant config", err, "tenant_id", tenant.ID.String())
		}

		config, err = s.queriesFor(ctx).CreateTenantConfig(ctx, dbmodels.CreateTenantConfigParams{
			TenantID:        tenant.ID,
			CopyrightText:   copyrightText,
			SiteDescription: siteDescription,
			SiteTagline:     siteTagline,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to create tenant config", err, "tenant_id", tenant.ID.String())
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
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("invalid current password"), "current_password")
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
		return nil, s.internalDBError(ctx, "failed to check email uniqueness", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
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

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin email change transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	if err := txq.DeleteUserEmailChangeTokensByUserID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_delete_failed")
		return nil, s.internalDBError(ctx, "failed to delete email change tokens", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if _, err := txq.CreateUserEmailChangeToken(ctx, dbmodels.CreateUserEmailChangeTokenParams{
		ID:                    tokenID,
		TenantID:              tenant.ID,
		UserID:                user.ID,
		CurrentEmail:          user.Email,
		NewEmail:              newEmail,
		CurrentEmailTokenHash: auth.HashToken(currentEmailToken),
		NewEmailTokenHash:     auth.HashToken(newEmailToken),
		ExpiresAt:             time.Now().Add(emailChangeTokenTTL),
	}); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, s.internalDBError(ctx, "failed to create email change token", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := enqueueAdminEmailChangeConfirmationEmail(ctx, txq, tenant.ID, tokenID, "current_email", currentEmailToken); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "current_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue admin email change confirmation email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := enqueueAdminEmailChangeConfirmationEmail(ctx, txq, tenant.ID, tokenID, "new_email", newEmailToken); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "new_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue admin email change confirmation email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit email change transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	auth.AuditEvent(req.Header(), "admin_email_change_request", "success", tenant.PublicID, user.PublicID, "confirmation_emails_enqueued")
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
		return nil, s.internalDBError(ctx, "failed to get email change token", err, "tenant_id", tenant.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to get user for email change confirm", err, "tenant_id", tenant.ID.String(), "user_id", changeToken.UserID.String())
	}
	if !strings.EqualFold(user.Email, changeToken.CurrentEmail) {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "stale_request")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change request is no longer valid"))
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin email change confirm transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	matchedTarget := changeToken.MatchedTarget
	if matchedTarget == "current_email" {
		if err := txq.MarkUserEmailChangeCurrentEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "current_email_confirm_failed")
			return nil, s.internalDBError(ctx, "failed to confirm current email", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
		}
	} else {
		if err := txq.MarkUserEmailChangeNewEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "new_email_confirm_failed")
			return nil, s.internalDBError(ctx, "failed to confirm new email", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
		}
	}

	currentEmailConfirmed := changeToken.CurrentEmailConfirmedAt.Valid || matchedTarget == "current_email"
	newEmailConfirmed := changeToken.NewEmailConfirmedAt.Valid || matchedTarget == "new_email"
	if !currentEmailConfirmed || !newEmailConfirmed {
		pendingTarget := "current_email"
		if !newEmailConfirmed {
			pendingTarget = "new_email"
		}
		if err := tx.Commit(); err != nil {
			auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
			return nil, s.internalDBError(ctx, "failed to commit email change confirm transaction", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
		}
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "success", tenant.PublicID, user.PublicID, "waiting_for_"+pendingTarget)
		return connect.NewResponse(&publiraadminv1.AdminAuthServiceConfirmEmailChangeResponse{
			Confirmed:              true,
			Changed:                false,
			PendingConfirmationFor: pendingTarget,
		}), nil
	}

	if _, err := txq.UpdateUserEmailByID(ctx, dbmodels.UpdateUserEmailByIDParams{
		ID:    user.ID,
		Email: changeToken.NewEmail,
	}); err != nil {
		if dberr.IsUniqueViolation(err) {
			auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "email_already_exists")
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
		}
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "email_update_failed")
		return nil, s.internalDBError(ctx, "failed to update user email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := txq.MarkUserEmailChangeCompleted(ctx, changeToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "request_complete_failed")
		return nil, s.internalDBError(ctx, "failed to complete email change token", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
	}
	// The notice rides the same transaction as the address it announces, so the
	// old address is never told about a change that did not commit — and never
	// left untold about one that did.
	if err := enqueueAdminEmailChangedNoticeEmail(ctx, txq, tenant.ID, changeToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "old_email_notice_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue admin email changed notice email", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit email change confirm transaction", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
	}

	auth.AuditEvent(req.Header(), "admin_email_change_confirm", "success", tenant.PublicID, user.PublicID, "email_changed")
	return connect.NewResponse(&publiraadminv1.AdminAuthServiceConfirmEmailChangeResponse{Confirmed: true, Changed: true}), nil
}
