package publicapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

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
	createdSession, err := s.queries.CreateSession(ctx, dbmodels.CreateSessionParams{
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
	roles, err := s.queries.ListTenantUserRoles(ctx, userID)
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
	user, err := s.queries.GetUserByID(ctx, authCtx.Session.UserID)
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
	user, err := s.queries.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true}, Email: req.Msg.Email})
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

	_, err = s.queries.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
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
	user, err := s.queries.CreateUser(ctx, dbmodels.CreateUserParams{
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

	issuedSession, err := s.issueUserSession(ctx, tenant, user, "")
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "session_create_failed")
		return nil, err
	}

	auth.AuditEvent(req.Header(), "signup", "success", tenant.PublicID, user.PublicID, "user_created")
	response := connect.NewResponse(&publirav1.CreateUserResponse{
		User:    issuedSession.Msg.User,
		Session: issuedSession.Msg.Session,
	})
	for _, cookie := range issuedSession.Header().Values("Set-Cookie") {
		response.Header().Add("Set-Cookie", cookie)
	}
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
	if err := s.queries.RevokeSession(ctx, lookup.Session.ID); err != nil {
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
