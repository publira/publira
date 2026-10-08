package adminapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const emailChangeTokenTTL = 24 * time.Hour

// queueAdminPasswordResetRequest records a reset asked for in the admin console.
// It is the handler's only write; the worker looks the address up.
func queueAdminPasswordResetRequest(ctx context.Context, queries dbmodels.Querier, tenantID uuid.UUID, email string) error {
	payload, err := json.Marshal(outbox.AdminPasswordResetRequestPayload{
		TenantID: tenantID.String(),
		Email:    email,
	})
	if err != nil {
		return fmt.Errorf("marshal admin password reset request event: %w", err)
	}
	requestID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate outbox event id: %w", err)
	}
	_, err = queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             requestID,
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeAdminPasswordResetRequest,
		Payload:        payload,
		IdempotencyKey: outbox.EventTypeAdminPasswordResetRequest + ":" + requestID.String(),
		AvailableAt:    time.Now().UTC(),
	})
	return err
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

// tenantRole is the role userID acts as in the console, or "" when the
// account holds none of the tenant staff roles. An empty answer means the
// account may hold no console session at all: a reader of the tenant has a
// password and an active status too, and nothing else tells them apart.
func (s *adminServer) tenantRole(ctx context.Context, userID uuid.UUID) (string, error) {
	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, userID)
	if err != nil {
		return "", s.internalDBError(ctx, "failed to list tenant user roles", err, "user_id", userID.String())
	}
	if !auth.IsTenantStaff(roles) {
		return "", nil
	}
	return auth.ResolveTenantRole(roles), nil
}

func (s *adminServer) currentUserFromSession(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	headers *connect.Header,
) (dbmodels.Tenant, dbmodels.User, string, error) {
	authCtx, err := s.authenticateSession(ctx, tenantCtx, headers)
	if err != nil {
		return dbmodels.Tenant{}, dbmodels.User{}, "", err
	}
	return authCtx.Tenant, authCtx.User, authCtx.Role, nil
}

func (s *adminServer) Login(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceLoginRequest,
) (*publiraadminv1.AdminAuthServiceLoginResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "failure", "", "", "tenant_not_found")
		return nil, err
	}
	// Charged before the address is looked up, so the refusal is the same
	// whether or not it holds an account and costs no bcrypt. The storefront
	// charges the same allowance for the same account.
	attempt, err := s.login.Begin(ctx, tenant.ID.String(), req.Email)
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "failure", tenant.PublicID, "", "rate_limited")
		return nil, err
	}
	user, err := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true}, Email: req.Email})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "failure", tenant.PublicID, "", "invalid_credentials")
			return nil, connect.NewError(connect.CodeUnauthenticated, "invalid credentials")
		}
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get user for login", err, "tenant_id", tenant.ID.String())
	}
	if !auth.VerifyUserPassword(req.Password, user.PasswordHash) {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "failure", tenant.PublicID, user.PublicID, "invalid_credentials")
		return nil, connect.NewError(connect.CodeUnauthenticated, "invalid credentials")
	}
	attempt.Verified(ctx)
	if user.Status != "active" {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "failure", tenant.PublicID, user.PublicID, "user_inactive")
		return nil, connect.NewError(connect.CodeUnauthenticated, "invalid credentials")
	}
	role, err := s.tenantRole(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	// Answered like a wrong password, and before an MFA challenge could say
	// otherwise, so the console does not confirm which addresses are readers
	// with a password that works.
	if role == "" {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "failure", tenant.PublicID, user.PublicID, "no_tenant_role")
		return nil, connect.NewError(connect.CodeUnauthenticated, "invalid credentials")
	}
	if s.tokens == nil {
		return nil, connect.NewError(connect.CodeInternal, "token manager is not configured")
	}

	// The password is right, but it is only half of what this account owes.
	// A challenge is handed out instead of a session, so nothing signed by
	// this request can act on the tenant until the factor is settled.
	challengeKind, err := s.mfaChallengeKindFor(ctx, user, role)
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "failure", tenant.PublicID, user.PublicID, "mfa_state_lookup_failed")
		return nil, err
	}
	if challengeKind != publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED {
		challenge, err := s.mfaChallengeFor(tenant, user, challengeKind)
		if err != nil {
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "failure", tenant.PublicID, user.PublicID, "mfa_challenge_issue_failed")
			return nil, err
		}
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "success", tenant.PublicID, user.PublicID, "mfa_challenge_issued")
		return &publiraadminv1.AdminAuthServiceLoginResponse{MfaChallenge: challenge}, nil
	}

	token, expiresAt, err := s.tokens.Issue(user.PublicID, auth.AudienceAdmin, tenant.ID.String(), role, user.CredentialsVersion, time.Now())
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "failure", tenant.PublicID, user.PublicID, "token_issue_failed")
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	resp := &publiraadminv1.AdminAuthServiceLoginResponse{
		User:        &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: role},
		AccessToken: &publirattypesv1.AccessToken{Token: token, ExpiresAt: auth.FormatExpiresAt(expiresAt)},
	}
	auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_login", "success", tenant.PublicID, user.PublicID, "token_issued")
	return resp, nil
}

func (s *adminServer) Logout(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceLogoutRequest,
) (*publiraadminv1.AdminAuthServiceLogoutResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_logout", "failure", "", "", "tenant_not_found")
		return nil, err
	}
	if _, ok := auth.BearerTokenFromHeader(rpcmiddleware.RequestHeader(ctx)); ok {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_logout", "success", tenant.PublicID, "", "client_logout")
	} else {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_logout", "success", tenant.PublicID, "", "no_token")
	}
	return &publiraadminv1.AdminAuthServiceLogoutResponse{}, nil
}

func (s *adminServer) RequestPasswordReset(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceRequestPasswordResetRequest,
) (*publiraadminv1.AdminAuthServiceRequestPasswordResetResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_request", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	email := strings.TrimSpace(req.Email)
	if email == "" {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_request", "failure", tenant.PublicID, "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, "email is required")
	}
	if _, err := mail.ParseAddress(email); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_request", "failure", tenant.PublicID, "", "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid email address")
	}
	if err := s.mail.Allow(ctx, tenant.ID.String(), email); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_request", "failure", tenant.PublicID, "", "rate_limited")
		return nil, err
	}

	// Recorded for the worker whether or not the address has an account, so an
	// unknown address takes as long to answer as a registered one.
	if err := queueAdminPasswordResetRequest(ctx, s.queriesFor(ctx), tenant.ID, email); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_request", "failure", tenant.PublicID, "", "request_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue admin password reset request", err, "tenant_id", tenant.ID.String())
	}

	auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_request", "success", tenant.PublicID, "", "requested")
	return &publiraadminv1.AdminAuthServiceRequestPasswordResetResponse{Requested: true}, nil
}

func (s *adminServer) ConfirmPasswordReset(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceConfirmPasswordResetRequest,
) (*publiraadminv1.AdminAuthServiceConfirmPasswordResetResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	token := strings.TrimSpace(req.Token)
	newPassword := req.NewPassword
	if token == "" || strings.TrimSpace(newPassword) == "" {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, "token and new_password are required")
	}

	resetToken, err := s.queriesFor(ctx).GetUserPasswordResetTokenByHashForTenant(ctx, dbmodels.GetUserPasswordResetTokenByHashForTenantParams{
		TenantID:  tenant.ID,
		TokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "token_not_found")
			return nil, connect.NewError(connect.CodeNotFound, "password reset token not found")
		}
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "token_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get password reset token", err, "tenant_id", tenant.ID.String())
	}

	if resetToken.CompletedAt.Valid {
		return &publiraadminv1.AdminAuthServiceConfirmPasswordResetResponse{Confirmed: true}, nil
	}
	if resetToken.ExpiresAt.Before(time.Now()) {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "token_expired")
		return nil, connect.NewError(connect.CodeFailedPrecondition, "password reset token expired")
	}

	user, err := s.queriesFor(ctx).GetUserByID(ctx, resetToken.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "user_not_found")
			return nil, connect.NewError(connect.CodeNotFound, "user not found")
		}
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get user for password reset confirm", err, "tenant_id", tenant.ID.String(), "user_id", resetToken.UserID.String())
	}

	passwordHash, err := auth.HashPassword(newPassword)
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "password_hash_failed")
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}

	if _, err := s.queriesFor(ctx).UpdateUserPasswordHashByID(ctx, dbmodels.UpdateUserPasswordHashByIDParams{
		ID:           user.ID,
		PasswordHash: sql.NullString{String: passwordHash, Valid: true},
	}); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "password_update_failed")
		return nil, s.internalDBError(ctx, "failed to update password", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if _, err := s.queriesFor(ctx).BumpUserCredentialsVersion(ctx, user.ID); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "credentials_version_bump_failed")
		return nil, s.internalDBError(ctx, "failed to bump credentials version", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := s.queriesFor(ctx).MarkUserPasswordResetTokenCompleted(ctx, resetToken.ID); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "token_complete_failed")
		return nil, s.internalDBError(ctx, "failed to complete password reset token", err, "tenant_id", tenant.ID.String(), "token_id", resetToken.ID.String())
	}

	auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_password_reset_confirm", "success", tenant.PublicID, user.PublicID, "confirmed")
	return &publiraadminv1.AdminAuthServiceConfirmPasswordResetResponse{Confirmed: true}, nil
}

func (s *adminServer) GetMe(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceGetMeRequest,
) (*publiraadminv1.AdminAuthServiceGetMeResponse, error) {
	_, user, role, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.AdminAuthServiceGetMeResponse{User: &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: role}}, nil
}

func (s *adminServer) GetTenant(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceGetTenantRequest,
) (*publiraadminv1.AdminAuthServiceGetTenantResponse, error) {
	ctx, err := s.withOperatorSession(ctx, req)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAuditor(ctx)
	if err != nil {
		return nil, err
	}
	tenant := session.Tenant

	adminDomain := ""
	if tenant.AdminDomain.Valid {
		adminDomain = tenant.AdminDomain.String
	}

	return &publiraadminv1.AdminAuthServiceGetTenantResponse{
		Tenant: &publiraadminv1.AdminAuthServiceTenant{
			PublicId:    tenant.PublicID,
			Name:        tenant.Name,
			Domain:      tenant.Domain,
			AdminDomain: adminDomain,
		},
	}, nil
}

func (s *adminServer) GetTenantByDomain(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceGetTenantByDomainRequest,
) (*publiraadminv1.AdminAuthServiceGetTenantByDomainResponse, error) {
	domains := make([]string, 0, len(req.Domains))
	for _, candidate := range req.Domains {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}
		domains = append(domains, strings.ToLower(trimmed))
	}
	if len(domains) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, "domains are required")
	}

	tenant, err := s.queriesFor(ctx).GetAdminTenantByDomains(ctx, domains)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "tenant not found")
		}
		return nil, s.internalDBError(ctx, "failed to get tenant by domain", err)
	}

	defaultLocale, err := locale.Resolve(tenant.DefaultLocale)
	if err != nil {
		return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
	}

	return &publiraadminv1.AdminAuthServiceGetTenantByDomainResponse{
		TenantId:      tenant.ID.String(),
		DefaultLocale: defaultLocale,
	}, nil
}

func (s *adminServer) GetTenantConfig(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceGetTenantConfigRequest,
) (*publiraadminv1.AdminAuthServiceGetTenantConfigResponse, error) {
	ctx, err := s.withOperatorSession(ctx, req)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAuditor(ctx)
	if err != nil {
		return nil, err
	}
	tenant := session.Tenant

	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return &publiraadminv1.AdminAuthServiceGetTenantConfigResponse{}, nil
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

	return response, nil
}

// tenantSiteCopyRevalidateTags names the tenant read that carries the
// copyright notice, the site tagline, and the site description.
func tenantSiteCopyRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:site", strings.TrimSpace(tenantID))}
}

func (s *adminServer) UpdateTenantConfig(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceUpdateTenantConfigRequest,
) (*publiraadminv1.AdminAuthServiceUpdateTenantConfigResponse, error) {
	ctx, err := s.withOperatorSession(ctx, req)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant := session.Tenant

	copyrightText := sql.NullString{String: req.CopyrightText, Valid: strings.TrimSpace(req.CopyrightText) != ""}
	siteDescription := sql.NullString{String: req.SiteDescription, Valid: strings.TrimSpace(req.SiteDescription) != ""}
	siteTagline := sql.NullString{String: req.SiteTagline, Valid: strings.TrimSpace(req.SiteTagline) != ""}

	var config dbmodels.TenantConfig
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		row, err := s.queriesFor(txCtx).UpdateTenantConfig(txCtx, dbmodels.UpdateTenantConfigParams{
			TenantID:        tenant.ID,
			CopyrightText:   copyrightText,
			SiteDescription: siteDescription,
			SiteTagline:     siteTagline,
		})
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return nil, s.internalDBError(ctx, "failed to update tenant config", err, "tenant_id", tenant.ID.String())
			}

			row, err = s.queriesFor(txCtx).CreateTenantConfig(txCtx, dbmodels.CreateTenantConfigParams{
				TenantID:        tenant.ID,
				CopyrightText:   copyrightText,
				SiteDescription: siteDescription,
				SiteTagline:     siteTagline,
			})
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to create tenant config", err, "tenant_id", tenant.ID.String())
			}
		}
		config = row
		return tenantSiteCopyRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
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

	return response, nil
}

func (s *adminServer) RequestEmailChange(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceRequestEmailChangeRequest,
) (*publiraadminv1.AdminAuthServiceRequestEmailChangeResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", "", "", "invalid_session")
		return nil, err
	}

	newEmail := strings.TrimSpace(req.NewEmail)
	currentEmail := strings.TrimSpace(req.CurrentEmail)
	currentPassword := req.CurrentPassword
	if currentEmail == "" || newEmail == "" || strings.TrimSpace(currentPassword) == "" {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, "current_email, new_email and current_password are required")
	}
	if _, err := mail.ParseAddress(currentEmail); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_current_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid current email address")
	}
	if _, err := mail.ParseAddress(newEmail); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, "invalid email address")
	}
	if !strings.EqualFold(currentEmail, user.Email) {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "current_email_mismatch")
		return nil, connect.NewError(connect.CodeInvalidArgument, "current email does not match")
	}
	if strings.EqualFold(newEmail, user.Email) {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "same_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, "new email must be different from current email")
	}
	if !auth.VerifyUserPassword(currentPassword, user.PasswordHash) {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "invalid_password")
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("invalid current password"), "current_password")
	}

	_, err = s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    newEmail,
	})
	if err == nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "email_already_exists")
		return nil, connect.NewError(connect.CodeAlreadyExists, "email already exists")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to check email uniqueness", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	// The session says who is asking, not that the address they named is
	// theirs, so the mail this queues for it is bounded like any other mail to
	// an address nobody has confirmed.
	//
	// Charged here rather than before the lookup above, which is the order the
	// forms that must not disclose an account use. This one discloses on
	// purpose and mails nothing when it does, so charging first would let any
	// signed-in caller spend the allowance of every address they can name by
	// naming ones that already have accounts.
	if err := s.mail.Allow(ctx, tenant.ID.String(), newEmail); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "rate_limited")
		return nil, err
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	currentEmailToken := hex.EncodeToString(rawToken)
	rawToken = make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	newEmailToken := hex.EncodeToString(rawToken)
	tokenID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin email change transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	// The delete below locks only the rows it finds, so two requests arriving at
	// once each insert a token and leave two live links behind. Locking the
	// account row orders them: the second one's statements then run on a
	// snapshot that already holds the first one's token.
	locked, err := txq.GetUserByIDForUpdate(ctx, user.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// The account was closed while this request waited, so the session
			// it came with is over and there is no address left to move.
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "account_gone")
			return nil, invalidSessionError()
		}
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "user_lock_failed")
		return nil, s.internalDBError(ctx, "failed to lock the account for an email change request", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	// The password and the address above were checked against the row this
	// request read before the transaction, and the lock is what makes those
	// checks current. A password set while this request waited ends the session
	// it came with, since every path that writes one bumps credentials_version.
	if locked.CredentialsVersion != user.CredentialsVersion {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "stale_session")
		return nil, invalidSessionError()
	}
	if !strings.EqualFold(currentEmail, locked.Email) {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "current_email_mismatch")
		return nil, connect.NewError(connect.CodeInvalidArgument, "current email does not match")
	}

	if err := txq.DeleteUserEmailChangeTokensByUserID(ctx, user.ID); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_delete_failed")
		return nil, s.internalDBError(ctx, "failed to delete email change tokens", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if _, err := txq.CreateUserEmailChangeToken(ctx, dbmodels.CreateUserEmailChangeTokenParams{
		ID:                    tokenID,
		TenantID:              tenant.ID,
		UserID:                user.ID,
		CurrentEmail:          locked.Email,
		NewEmail:              newEmail,
		CurrentEmailTokenHash: auth.HashToken(currentEmailToken),
		NewEmailTokenHash:     auth.HashToken(newEmailToken),
		ExpiresAt:             time.Now().Add(emailChangeTokenTTL),
	}); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, s.internalDBError(ctx, "failed to create email change token", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := enqueueAdminEmailChangeConfirmationEmail(ctx, txq, tenant.ID, tokenID, "current_email", currentEmailToken); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "current_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue admin email change confirmation email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := enqueueAdminEmailChangeConfirmationEmail(ctx, txq, tenant.ID, tokenID, "new_email", newEmailToken); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "new_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue admin email change confirmation email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit email change transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_request", "success", tenant.PublicID, user.PublicID, "confirmation_emails_enqueued")
	return &publiraadminv1.AdminAuthServiceRequestEmailChangeResponse{Requested: true}, nil
}

func (s *adminServer) ConfirmEmailChange(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceConfirmEmailChangeRequest,
) (*publiraadminv1.AdminAuthServiceConfirmEmailChangeResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	token := strings.TrimSpace(req.Token)
	if token == "" {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, "", "invalid_token")
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is required")
	}

	changeToken, err := s.queriesFor(ctx).GetUserEmailChangeTokenByHashForTenant(ctx, dbmodels.GetUserEmailChangeTokenByHashForTenantParams{
		TenantID:              tenant.ID,
		CurrentEmailTokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, "", "token_not_found")
			return nil, connect.NewError(connect.CodeNotFound, "email change token not found")
		}
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, "", "token_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get email change token", err, "tenant_id", tenant.ID.String())
	}

	if changeToken.CompletedAt.Valid {
		return &publiraadminv1.AdminAuthServiceConfirmEmailChangeResponse{Confirmed: true, Changed: true}, nil
	}
	if changeToken.ExpiresAt.Before(time.Now()) {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, "", "token_expired")
		return nil, connect.NewError(connect.CodeFailedPrecondition, "email change token expired")
	}

	user, err := s.queriesFor(ctx).GetUserByID(ctx, changeToken.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, "", "user_not_found")
			return nil, connect.NewError(connect.CodeNotFound, "user not found")
		}
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get user for email change confirm", err, "tenant_id", tenant.ID.String(), "user_id", changeToken.UserID.String())
	}
	if !strings.EqualFold(user.Email, changeToken.CurrentEmail) {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "stale_request")
		return nil, connect.NewError(connect.CodeFailedPrecondition, "email change request is no longer valid")
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin email change confirm transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	matchedTarget := changeToken.MatchedTarget
	if matchedTarget == "current_email" {
		if err := txq.MarkUserEmailChangeCurrentEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "current_email_confirm_failed")
			return nil, s.internalDBError(ctx, "failed to confirm current email", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
		}
	} else {
		if err := txq.MarkUserEmailChangeNewEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "new_email_confirm_failed")
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
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
			return nil, s.internalDBError(ctx, "failed to commit email change confirm transaction", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
		}
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "success", tenant.PublicID, user.PublicID, "waiting_for_"+pendingTarget)
		return &publiraadminv1.AdminAuthServiceConfirmEmailChangeResponse{
			Confirmed:              true,
			Changed:                false,
			PendingConfirmationFor: pendingTarget,
		}, nil
	}

	if _, err := txq.UpdateUserEmailByID(ctx, dbmodels.UpdateUserEmailByIDParams{
		ID:    user.ID,
		Email: changeToken.NewEmail,
	}); err != nil {
		if dberr.IsUniqueViolation(err) {
			auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "email_already_exists")
			return nil, connect.NewError(connect.CodeAlreadyExists, "email already exists")
		}
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "email_update_failed")
		return nil, s.internalDBError(ctx, "failed to update user email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := txq.MarkUserEmailChangeCompleted(ctx, changeToken.ID); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "request_complete_failed")
		return nil, s.internalDBError(ctx, "failed to complete email change token", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
	}
	// The notice rides the same transaction as the address it announces, so the
	// old address is never told about a change that did not commit — and never
	// left untold about one that did.
	if err := enqueueAdminEmailChangedNoticeEmail(ctx, txq, tenant.ID, changeToken.ID); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "old_email_notice_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue admin email changed notice email", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit email change confirm transaction", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
	}

	auth.AuditEvent(rpcmiddleware.RequestHeader(ctx), "admin_email_change_confirm", "success", tenant.PublicID, user.PublicID, "email_changed")
	return &publiraadminv1.AdminAuthServiceConfirmEmailChangeResponse{Confirmed: true, Changed: true}, nil
}
