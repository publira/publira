package apiserver

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

func (s *apiServer) authenticateSession(
	ctx context.Context,
	tenantCtx *publirav1.TenantContext,
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
	lookup, err := s.queries.LookupSessionByTokenHashForTenant(ctx, tenant.ID, auth.HashToken(sessionToken), time.Now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, err)
	}
	if lookup.State != dbmodels.SessionStateActive {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	return rpcmiddleware.SessionContext{Tenant: tenant, Session: lookup.Session}, nil
}

func (s *apiServer) currentUserFromSession(
	ctx context.Context,
	tenantCtx *publirav1.TenantContext,
	explicitToken string,
	headers http.Header,
) (dbmodels.Tenant, dbmodels.User, error) {
	authCtx, err := s.authenticateSession(ctx, tenantCtx, explicitToken, headers)
	if err != nil {
		return dbmodels.Tenant{}, dbmodels.User{}, err
	}
	user, err := s.queries.GetUserByID(ctx, authCtx.Session.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Tenant{}, dbmodels.User{}, invalidSessionError()
		}
		return dbmodels.Tenant{}, dbmodels.User{}, connect.NewError(connect.CodeInternal, err)
	}
	return authCtx.Tenant, user, nil
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
	user, err := s.queries.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{TenantID: tenant.ID, Email: req.Msg.Email})
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
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "login", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	sessionToken := hex.EncodeToString(rawToken)
	createdSession, err := s.queries.CreateSession(ctx, dbmodels.CreateSessionParams{
		ID:        uuid.New(),
		TenantID:  tenant.ID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(sessionToken),
		ExpiresAt: time.Now().Add(auth.SessionTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "login", "failure", tenant.PublicID, user.PublicID, "session_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resp := &publirav1.CreateSessionResponse{
		User: &publirav1.User{PublicId: user.PublicID, Name: user.Name, Role: user.Role},
		Session: &publirav1.Session{SessionId: sessionToken, ExpiresAt: createdSession.ExpiresAt.UTC().Format(time.RFC3339)},
	}
	response := connect.NewResponse(resp)
	response.Header().Add("Set-Cookie", auth.BuildSessionCookie(sessionToken, createdSession.ExpiresAt))
	auth.AuditEvent(req.Header(), "login", "success", tenant.PublicID, user.PublicID, "session_issued")
	return response, nil
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
	lookup, err := s.queries.LookupSessionByTokenHashForTenant(ctx, tenant.ID, tokenHash, time.Now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "logout", "success", tenant.PublicID, "", "session_not_found")
			return response, nil
		}
		auth.AuditEvent(req.Header(), "logout", "failure", tenant.PublicID, "", "session_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if lookup.State == dbmodels.SessionStateRevoked {
		auth.AuditEvent(req.Header(), "logout", "success", tenant.PublicID, "", "already_revoked")
		return response, nil
	}
	if err := s.queries.RevokeSession(ctx, dbmodels.RevokeSessionParams{ID: lookup.Session.ID, TenantID: tenant.ID}); err != nil {
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
	_, user, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Msg.SessionId, req.Header())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publirav1.GetMeResponse{User: &publirav1.User{PublicId: user.PublicID, Name: user.Name, Role: user.Role}}), nil
}
