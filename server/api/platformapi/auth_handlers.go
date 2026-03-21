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
	rolePlatformOperator   = "platform_operator"
	rolePlatformSuperAdmin = "platform_super_admin"
	roleLegacyPlatformOps  = "platform-operator"
	roleLegacySuperAdmin   = "super-admin"
)

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid session"))
}

func platformRoleRequiredError() error {
	return connect.NewError(connect.CodePermissionDenied, errors.New("platform operator role required"))
}

func isPlatformRole(role string) bool {
	switch strings.TrimSpace(role) {
	case rolePlatformOperator, rolePlatformSuperAdmin, roleLegacyPlatformOps, roleLegacySuperAdmin:
		return true
	default:
		return false
	}
}

func (s *platformServer) authenticatePlatformSession(
	ctx context.Context,
	explicitToken string,
	headers http.Header,
) (dbmodels.Session, dbmodels.User, error) {
	sessionToken, ok := auth.SessionTokenFromRequest(explicitToken, headers)
	if !ok {
		return dbmodels.Session{}, dbmodels.User{}, invalidSessionError()
	}
	lookup, err := s.queries.GetSessionByTokenHash(ctx, auth.HashToken(sessionToken))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Session{}, dbmodels.User{}, invalidSessionError()
		}
		return dbmodels.Session{}, dbmodels.User{}, connect.NewError(connect.CodeInternal, err)
	}
	if auth.ClassifySession(lookup, time.Now()) != auth.SessionStateActive {
		return dbmodels.Session{}, dbmodels.User{}, invalidSessionError()
	}
	user, err := s.queries.GetUserByID(ctx, lookup.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Session{}, dbmodels.User{}, invalidSessionError()
		}
		return dbmodels.Session{}, dbmodels.User{}, connect.NewError(connect.CodeInternal, err)
	}
	if !isPlatformRole(user.Role) {
		return dbmodels.Session{}, dbmodels.User{}, platformRoleRequiredError()
	}
	return lookup, user, nil
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
	if !isPlatformRole(user.Role) || !auth.VerifyPassword(password, user.PasswordHash) {
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
		ID:        sessionID,
		TenantID:  user.TenantID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(sessionToken),
		ExpiresAt: time.Now().Add(auth.SessionTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", user.PublicID, "session_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &publirasplatformv1.PlatformAuthServiceCreateSessionResponse{
		User:    &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: user.Role},
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
	sessionToken, ok := auth.SessionTokenFromRequest(req.Msg.SessionId, req.Header())
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
	if err := s.queries.RevokeSession(ctx, dbmodels.RevokeSessionParams{ID: lookup.ID, TenantID: lookup.TenantID}); err != nil {
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
	_, user, err := s.authenticatePlatformSession(ctx, req.Msg.SessionId, req.Header())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceGetMeResponse{
		User: &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: user.Role},
	}), nil
}
