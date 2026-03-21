package platformapi

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

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	rolePlatformOperator   = auth.RolePlatformOperator
	rolePlatformSuperAdmin = auth.RolePlatformSuperAdmin
)

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid session"))
}

func platformRoleRequiredError() error {
	return connect.NewError(connect.CodePermissionDenied, errors.New("platform operator role required"))
}

func (s *platformServer) platformRoles(ctx context.Context, userID uuid.UUID) ([]string, error) {
	roles, err := s.queries.ListPlatformUserRoles(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return roles, nil
}

func (s *platformServer) authenticatePlatformSession(
	ctx context.Context,
	explicitToken string,
	headers http.Header,
) (dbmodels.Session, dbmodels.User, string, error) {
	sessionToken, ok := auth.SessionTokenFromRequest(explicitToken, headers)
	if !ok {
		return dbmodels.Session{}, dbmodels.User{}, "", invalidSessionError()
	}
	lookup, err := s.queries.GetSessionByTokenHash(ctx, auth.HashToken(sessionToken))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Session{}, dbmodels.User{}, "", invalidSessionError()
		}
		return dbmodels.Session{}, dbmodels.User{}, "", connect.NewError(connect.CodeInternal, err)
	}
	if auth.ClassifySession(lookup, time.Now()) != auth.SessionStateActive {
		return dbmodels.Session{}, dbmodels.User{}, "", invalidSessionError()
	}
	user, err := s.queries.GetUserByID(ctx, lookup.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Session{}, dbmodels.User{}, "", invalidSessionError()
		}
		return dbmodels.Session{}, dbmodels.User{}, "", connect.NewError(connect.CodeInternal, err)
	}
	roles, err := s.platformRoles(ctx, user.ID)
	if err != nil {
		return dbmodels.Session{}, dbmodels.User{}, "", err
	}
	resolvedRole := auth.ResolvePlatformRole(roles)
	if !auth.IsPlatformRole(resolvedRole) {
		return dbmodels.Session{}, dbmodels.User{}, "", platformRoleRequiredError()
	}
	return lookup, user, resolvedRole, nil
}

func (s *platformServer) CreateSession(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceCreateSessionRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceCreateSessionResponse], error) {
	email := strings.TrimSpace(req.Msg.Email)
	password := req.Msg.Password
	if email == "" || strings.TrimSpace(password) == "" {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", "", "invalid_credentials")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
	}
	user, err := s.queries.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "platform_login", "failure", "", "", "invalid_credentials")
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
		}
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", "", "user_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	roles, err := s.platformRoles(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	resolvedRole := auth.ResolvePlatformRole(roles)
	if !auth.IsPlatformRole(resolvedRole) || !auth.VerifyPassword(password, user.PasswordHash) {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", user.PublicID, "invalid_credentials")
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	sessionToken := hex.EncodeToString(rawToken)
	sessionID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", user.PublicID, "session_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	createdSession, err := s.queries.CreateSession(ctx, dbmodels.CreateSessionParams{
		ID:              sessionID,
		CurrentTenantID: uuid.NullUUID{},
		UserID:          user.ID,
		TokenHash:       auth.HashToken(sessionToken),
		ExpiresAt:       time.Now().Add(auth.SessionTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", user.PublicID, "session_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &publirasplatformv1.PlatformAuthServiceCreateSessionResponse{
		User:    &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: resolvedRole},
		Session: &publirattypesv1.Session{SessionId: sessionToken, ExpiresAt: createdSession.ExpiresAt.UTC().Format(time.RFC3339)},
	}
	response := connect.NewResponse(resp)
	response.Header().Add("Set-Cookie", auth.BuildSessionCookie(sessionToken, createdSession.ExpiresAt))
	auth.AuditEvent(req.Header(), "platform_login", "success", "", user.PublicID, "session_issued")
	return response, nil
}

func (s *platformServer) DeleteSession(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceDeleteSessionRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceDeleteSessionResponse], error) {
	sessionToken, ok := auth.SessionTokenFromRequest("", req.Header())
	response := connect.NewResponse(&publirasplatformv1.PlatformAuthServiceDeleteSessionResponse{})
	response.Header().Add("Set-Cookie", auth.BuildClearedSessionCookie())
	if !ok {
		auth.AuditEvent(req.Header(), "platform_logout", "success", "", "", "no_session_cookie")
		return response, nil
	}

	lookup, err := s.queries.GetSessionByTokenHash(ctx, auth.HashToken(sessionToken))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "platform_logout", "success", "", "", "session_not_found")
			return response, nil
		}
		auth.AuditEvent(req.Header(), "platform_logout", "failure", "", "", "session_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if auth.ClassifySession(lookup, time.Now()) == auth.SessionStateRevoked {
		auth.AuditEvent(req.Header(), "platform_logout", "success", "", "", "already_revoked")
		return response, nil
	}
	if err := s.queries.RevokeSession(ctx, lookup.ID); err != nil {
		auth.AuditEvent(req.Header(), "platform_logout", "failure", "", "", "session_revoke_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	auth.AuditEvent(req.Header(), "platform_logout", "success", "", "", "session_revoked")
	return response, nil
}

func (s *platformServer) GetMe(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.PlatformAuthServiceGetMeRequest],
) (*connect.Response[publirasplatformv1.PlatformAuthServiceGetMeResponse], error) {
	_, user, role, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceGetMeResponse{
		User: &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: role},
	}), nil
}
