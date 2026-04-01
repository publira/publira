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

func (s *platformServer) platformRoles(ctx context.Context, platformUserID uuid.UUID) ([]string, error) {
	roles, err := s.queriesFor(ctx).ListPlatformUserRoles(ctx, platformUserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return roles, nil
}

func (s *platformServer) authenticatePlatformSession(
	ctx context.Context,
	explicitToken string,
	headers http.Header,
) (dbmodels.PlatformSession, dbmodels.PlatformUser, string, error) {
	sessionToken, ok := auth.SessionTokenFromRequest(explicitToken, headers)
	if !ok {
		return dbmodels.PlatformSession{}, dbmodels.PlatformUser{}, "", invalidSessionError()
	}
	lookup, err := auth.LookupPlatformSessionByTokenHash(ctx, s.queries, auth.HashToken(sessionToken), time.Now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.PlatformSession{}, dbmodels.PlatformUser{}, "", invalidSessionError()
		}
		return dbmodels.PlatformSession{}, dbmodels.PlatformUser{}, "", connect.NewError(connect.CodeInternal, err)
	}
	if lookup.State != auth.SessionStateActive {
		return dbmodels.PlatformSession{}, dbmodels.PlatformUser{}, "", invalidSessionError()
	}
	platformUser, err := s.queriesFor(ctx).GetPlatformUserByID(ctx, lookup.Session.PlatformUserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.PlatformSession{}, dbmodels.PlatformUser{}, "", invalidSessionError()
		}
		return dbmodels.PlatformSession{}, dbmodels.PlatformUser{}, "", connect.NewError(connect.CodeInternal, err)
	}
	roles, err := s.platformRoles(ctx, platformUser.ID)
	if err != nil {
		return dbmodels.PlatformSession{}, dbmodels.PlatformUser{}, "", err
	}
	resolvedRole := auth.ResolvePlatformRole(roles)
	if !auth.IsPlatformRole(resolvedRole) {
		return dbmodels.PlatformSession{}, dbmodels.PlatformUser{}, "", platformRoleRequiredError()
	}
	return lookup.Session, platformUser, resolvedRole, nil
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

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", platformUser.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	sessionToken := hex.EncodeToString(rawToken)
	sessionID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", platformUser.PublicID, "session_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	createdSession, err := s.queriesFor(ctx).CreatePlatformSession(ctx, dbmodels.CreatePlatformSessionParams{
		ID:             sessionID,
		PlatformUserID: platformUser.ID,
		TokenHash:      auth.HashToken(sessionToken),
		ExpiresAt:      time.Now().Add(auth.SessionTTL),
	})
	if err != nil {
		auth.AuditEvent(req.Header(), "platform_login", "failure", "", platformUser.PublicID, "session_create_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &publirasplatformv1.PlatformAuthServiceCreateSessionResponse{
		User:    &publirattypesv1.User{PublicId: platformUser.PublicID, Name: platformUser.Name, Role: resolvedRole},
		Session: &publirattypesv1.Session{SessionId: sessionToken, ExpiresAt: createdSession.ExpiresAt.UTC().Format(time.RFC3339)},
	}
	response := connect.NewResponse(resp)
	response.Header().Add("Set-Cookie", auth.BuildSessionCookie(sessionToken, createdSession.ExpiresAt))
	auth.AuditEvent(req.Header(), "platform_login", "success", "", platformUser.PublicID, "session_issued")
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

	lookup, err := auth.LookupPlatformSessionByTokenHash(ctx, s.queries, auth.HashToken(sessionToken), time.Now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "platform_logout", "success", "", "", "session_not_found")
			return response, nil
		}
		auth.AuditEvent(req.Header(), "platform_logout", "failure", "", "", "session_lookup_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if lookup.State == auth.SessionStateRevoked {
		auth.AuditEvent(req.Header(), "platform_logout", "success", "", "", "already_revoked")
		return response, nil
	}
	if err := s.queriesFor(ctx).RevokePlatformSession(ctx, lookup.Session.ID); err != nil {
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
	_, platformUser, role, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publirasplatformv1.PlatformAuthServiceGetMeResponse{
		User: &publirattypesv1.User{PublicId: platformUser.PublicID, Name: platformUser.Name, Role: role},
	}), nil
}
