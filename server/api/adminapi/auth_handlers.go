package adminapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
)

func (s *adminServer) tenantRole(ctx context.Context, userID uuid.UUID) (string, error) {
	roles, err := s.queries.ListTenantUserRoles(ctx, userID)
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
	user, err := s.queries.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true}, Email: req.Msg.Email})
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
	createdSession, err := s.queries.CreateSession(ctx, dbmodels.CreateSessionParams{
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
	if err := s.queries.RevokeSession(ctx, lookup.Session.ID); err != nil {
		auth.AuditEvent(req.Header(), "admin_logout", "failure", tenant.PublicID, "", "session_revoke_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	auth.AuditEvent(req.Header(), "admin_logout", "success", tenant.PublicID, "", "session_revoked")
	return response, nil
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

	tenant, err := s.queries.GetAdminTenantByDomains(ctx, domains)
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
