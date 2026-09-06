package publicapi

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
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	emailVerificationTokenTTL = 24 * time.Hour

	defaultAnnouncementPageSize = int32(20)
	maxAnnouncementPageSize     = int32(100)
)

func (s *apiServer) issueAccessToken(
	tenant dbmodels.Tenant,
	user dbmodels.User,
	role string,
) (*connect.Response[publirav1.LoginResponse], error) {
	if s.tokens == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("token manager is not configured"))
	}
	token, expiresAt, err := s.tokens.Issue(
		user.PublicID,
		auth.AudiencePublic,
		tenant.ID.String(),
		role,
		user.CredentialsVersion,
		time.Now(),
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resp := &publirav1.LoginResponse{
		User: &publirattypesv1.User{
			PublicId: user.PublicID,
			Name:     user.Name,
			Role:     role,
		},
		AccessToken: &publirattypesv1.AccessToken{
			Token:     token,
			ExpiresAt: auth.FormatExpiresAt(expiresAt),
		},
	}
	return connect.NewResponse(resp), nil
}

func (s *apiServer) tenantRole(ctx context.Context, userID uuid.UUID) (string, error) {
	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, userID)
	if err != nil {
		return "", s.internalDBError(ctx, "failed to list tenant user roles", err, "user_id", userID.String())
	}
	return auth.ResolveTenantRole(roles), nil
}

func (s *apiServer) authenticateAccessToken(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	headers http.Header,
) (rpcmiddleware.SessionContext, error) {
	tenant, err := s.tenantByContext(ctx, tenantCtx)
	if err != nil {
		return rpcmiddleware.SessionContext{}, err
	}
	rawToken, ok := auth.BearerTokenFromHeader(headers)
	if !ok || s.tokens == nil {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	claims, err := s.tokens.Verify(rawToken, auth.AudiencePublic)
	if err != nil {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	if claims.TenantID != "" && claims.TenantID != tenant.ID.String() {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	userRef, err := s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
		PublicID: claims.Subject,
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, s.internalDBError(ctx, "failed to get user by public id", err, "tenant_id", tenant.ID.String(), "public_id", claims.Subject)
	}
	user, err := s.queriesFor(ctx).GetUserByID(ctx, userRef.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, s.internalDBError(ctx, "failed to get user", err, "tenant_id", tenant.ID.String(), "user_id", userRef.ID.String())
	}
	if user.Status != "active" || user.CredentialsVersion != claims.CredentialsVersion {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	role, err := s.tenantRole(ctx, user.ID)
	if err != nil {
		return rpcmiddleware.SessionContext{}, err
	}
	tracing.SetEndUser(ctx, user.PublicID)
	return rpcmiddleware.SessionContext{Tenant: tenant, User: user, Role: role}, nil
}

func (s *apiServer) currentUserFromSession(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	headers http.Header,
) (dbmodels.Tenant, dbmodels.User, string, error) {
	authCtx, err := s.authenticateAccessToken(ctx, tenantCtx, headers)
	if err != nil {
		return dbmodels.Tenant{}, dbmodels.User{}, "", err
	}
	return authCtx.Tenant, authCtx.User, authCtx.Role, nil
}

func (s *apiServer) Login(
	ctx context.Context,
	req *connect.Request[publirav1.LoginRequest],
) (*connect.Response[publirav1.LoginResponse], error) {
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
		return nil, s.internalDBError(ctx, "failed to get user for login", err, "tenant_id", tenant.ID.String())
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
	response, err := s.issueAccessToken(tenant, user, role)
	if err != nil {
		auth.AuditEvent(req.Header(), "login", "failure", tenant.PublicID, user.PublicID, "token_issue_failed")
		return nil, err
	}
	auth.AuditEvent(req.Header(), "login", "success", tenant.PublicID, user.PublicID, "token_issued")
	return response, nil
}

// The four reader auth mails are enqueued as outbox_events rows in the
// transaction that writes what they announce, and rendered and delivered by the
// resident worker. Every row names the tenant the account belongs to, in the
// column and in the payload alike, which is what the table's own check
// constraint and its tenant-isolation policy both require.

func enqueueReaderEmailVerificationEmail(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, tokenID uuid.UUID,
	token string,
) error {
	payload, err := json.Marshal(outbox.ReaderEmailVerificationEmailPayload{
		TenantID: tenantID.String(),
		TokenID:  tokenID.String(),
		Token:    token,
	})
	if err != nil {
		return fmt.Errorf("marshal reader email verification email event: %w", err)
	}
	return insertReaderOutboxEvent(ctx, queries, tenantID, outbox.EventTypeReaderEmailVerificationEmail, payload,
		"reader_email_verification_email:"+tokenID.String())
}

func enqueueReaderEmailChangeConfirmationEmail(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, tokenID uuid.UUID,
	recipientKind string,
	token string,
) error {
	payload, err := json.Marshal(outbox.ReaderEmailChangeConfirmationEmailPayload{
		TenantID: tenantID.String(),
		TokenID:  tokenID.String(),
		Token:    token,
	})
	if err != nil {
		return fmt.Errorf("marshal reader email change confirmation email event: %w", err)
	}
	// One row per side, so a failure to deliver to one address is retried on its
	// own rather than resending the other.
	return insertReaderOutboxEvent(ctx, queries, tenantID, outbox.EventTypeReaderEmailChangeConfirmationEmail, payload,
		"reader_email_change_confirmation_email:"+tokenID.String()+":"+recipientKind)
}

func enqueueReaderEmailChangedNoticeEmail(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, tokenID uuid.UUID,
) error {
	payload, err := json.Marshal(outbox.ReaderEmailChangedNoticeEmailPayload{
		TenantID: tenantID.String(),
		TokenID:  tokenID.String(),
	})
	if err != nil {
		return fmt.Errorf("marshal reader email changed notice email event: %w", err)
	}
	return insertReaderOutboxEvent(ctx, queries, tenantID, outbox.EventTypeReaderEmailChangedNoticeEmail, payload,
		"reader_email_changed_notice_email:"+tokenID.String())
}

func enqueueReaderPasswordResetEmail(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, tokenID uuid.UUID,
	token string,
) error {
	payload, err := json.Marshal(outbox.ReaderPasswordResetEmailPayload{
		TenantID: tenantID.String(),
		TokenID:  tokenID.String(),
		Token:    token,
	})
	if err != nil {
		return fmt.Errorf("marshal reader password reset email event: %w", err)
	}
	return insertReaderOutboxEvent(ctx, queries, tenantID, outbox.EventTypeReaderPasswordResetEmail, payload,
		"reader_password_reset_email:"+tokenID.String())
}

func enqueueReaderSignupAttemptNoticeEmail(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, userID, attemptID uuid.UUID,
) error {
	payload, err := json.Marshal(outbox.ReaderSignupAttemptNoticeEmailPayload{
		TenantID: tenantID.String(),
		UserID:   userID.String(),
	})
	if err != nil {
		return fmt.Errorf("marshal reader signup attempt notice email event: %w", err)
	}
	// Every other reader mail is keyed by the row it announces, which collapses
	// a repeated write into one send. An attempt writes no row, and a reader who
	// is targeted again months later has to hear about it, so the key names the
	// attempt instead.
	return insertReaderOutboxEvent(ctx, queries, tenantID, outbox.EventTypeReaderSignupAttemptNoticeEmail, payload,
		"reader_signup_attempt_notice_email:"+attemptID.String())
}

func insertReaderOutboxEvent(
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

	// Hashing before the lookup on purpose. Both addresses are answered the same
	// way, so the work behind the answer must not be what separates them, and
	// the hash is the one expensive step in this handler.
	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "password_hash_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	existing, err := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    email,
	})
	if err == nil {
		return s.acceptSignupForRegisteredEmail(ctx, req, tenant, existing)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to check email uniqueness", err, "tenant_id", tenant.ID.String())
	}

	userID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "user_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	verificationToken := hex.EncodeToString(rawToken)
	verificationID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "token_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The account, its verification token, and the mail that carries the link
	// are one write: a signup that leaves an inactive account behind with no way
	// to activate it is the state this transaction exists to rule out.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin signup transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	user, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.User, error) {
		return txq.CreateUser(ctx, dbmodels.CreateUserParams{
			ID:           userID,
			TenantID:     uuid.NullUUID{UUID: tenant.ID, Valid: true},
			PublicID:     publicID,
			Email:        email,
			PasswordHash: passwordHash,
			Name:         name,
		})
	})
	if err != nil {
		if dberr.IsUniqueViolation(err) {
			// Two sign-ups for the same address raced past the read above. The
			// loser is answered like the one that saw the row, which needs this
			// transaction out of the way first: the notice opens its own.
			_ = tx.Rollback()
			return s.acceptSignupForRacedEmail(ctx, req, tenant, email)
		}
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "user_create_failed")
		return nil, s.internalDBError(ctx, "failed to create user", err, "tenant_id", tenant.ID.String(), "user_id", userID.String())
	}

	if _, err := txq.UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{ID: user.ID, Status: "inactive"}); err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "set_inactive_failed")
		return nil, s.internalDBError(ctx, "failed to set user inactive", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if _, err := txq.CreateUserEmailVerificationToken(ctx, dbmodels.CreateUserEmailVerificationTokenParams{
		ID:        verificationID,
		TenantID:  tenant.ID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(verificationToken),
		ExpiresAt: time.Now().Add(emailVerificationTokenTTL),
	}); err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, s.internalDBError(ctx, "failed to create email verification token", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := enqueueReaderEmailVerificationEmail(ctx, txq, tenant.ID, verificationID, verificationToken); err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "verification_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue reader email verification email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit signup transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	auth.AuditEvent(req.Header(), "signup", "success", tenant.PublicID, user.PublicID, "verification_email_enqueued")
	return connect.NewResponse(&publirav1.CreateUserResponse{Accepted: true}), nil
}

// acceptSignupForRegisteredEmail answers a sign-up whose address already has an
// account exactly as a sign-up for a free address is answered: nothing is
// created, nothing on the account changes, and the caller is told no more than
// that the request was taken. The account's owner is the one who learns of it,
// by mail, because the alternative is a silent dead end for a reader who forgot
// they had signed up.
func (s *apiServer) acceptSignupForRegisteredEmail(
	ctx context.Context,
	req *connect.Request[publirav1.CreateUserRequest],
	tenant dbmodels.Tenant,
	user dbmodels.User,
) (*connect.Response[publirav1.CreateUserResponse], error) {
	attemptID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "attempt_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin signup notice transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	if err := enqueueReaderSignupAttemptNoticeEmail(ctx, dbmodels.New(tx), tenant.ID, user.ID, attemptID); err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "signup_attempt_notice_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue reader signup attempt notice email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit signup notice transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	// The audit trail is the one place the two outcomes are still told apart.
	auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, user.PublicID, "email_already_exists")
	return connect.NewResponse(&publirav1.CreateUserResponse{Accepted: true}), nil
}

// acceptSignupForRacedEmail is the same answer for the sign-up that lost a race
// on the address, which learns of the account from the unique violation rather
// than from a read.
func (s *apiServer) acceptSignupForRacedEmail(
	ctx context.Context,
	req *connect.Request[publirav1.CreateUserRequest],
	tenant dbmodels.Tenant,
	email string,
) (*connect.Response[publirav1.CreateUserResponse], error) {
	user, err := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    email,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// The winning row is gone again. There is no owner left to notify,
			// and the answer still says nothing about that.
			auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "email_already_exists")
			return connect.NewResponse(&publirav1.CreateUserResponse{Accepted: true}), nil
		}
		auth.AuditEvent(req.Header(), "signup", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to load the account a signup raced", err, "tenant_id", tenant.ID.String())
	}
	return s.acceptSignupForRegisteredEmail(ctx, req, tenant, user)
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
		return nil, s.internalDBError(ctx, "failed to get email verification token", err, "tenant_id", tenant.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to get user for email verification", err, "tenant_id", tenant.ID.String(), "user_id", verificationToken.UserID.String())
	}
	if err := s.queriesFor(ctx).MarkUserEmailVerificationTokenUsed(ctx, verificationToken.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to mark email verification token used", err, "tenant_id", tenant.ID.String(), "token_id", verificationToken.ID.String())
	}
	if _, err := s.queriesFor(ctx).UpdateUserEmailVerifiedAtByID(ctx, dbmodels.UpdateUserEmailVerifiedAtByIDParams{
		ID:              user.ID,
		EmailVerifiedAt: sql.NullTime{Time: time.Now(), Valid: true},
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to mark email verified", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if _, err := s.queriesFor(ctx).UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{ID: user.ID, Status: "active"}); err != nil {
		return nil, s.internalDBError(ctx, "failed to activate user", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	return connect.NewResponse(&publirav1.VerifyUserEmailResponse{Verified: true}), nil
}

// RequestEmailVerification mails a fresh activation link to an address whose
// account has never been confirmed, which is the only way back for a reader
// whose first link expired or never arrived: Login refuses an unverified
// account, and a password reset sets a password that account still cannot sign
// in with.
//
// Every address is answered the same way — an unverified account, a confirmed
// one, and one that does not exist all end in requested: true — so the form
// reports nothing about who is registered. What separates them is the mailbox:
// only the first receives anything.
func (s *apiServer) RequestEmailVerification(
	ctx context.Context,
	req *connect.Request[publirav1.RequestEmailVerificationRequest],
) (*connect.Response[publirav1.RequestEmailVerificationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", "", "", "tenant_not_found")
		return nil, err
	}

	email := strings.TrimSpace(req.Msg.Email)
	if email == "" {
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, "", "invalid_input")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("email is required"))
	}
	if _, err := mail.ParseAddress(email); err != nil {
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, "", "invalid_email")
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email address"))
	}

	user, err := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    email,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			auth.AuditEvent(req.Header(), "email_verification_request", "success", tenant.PublicID, "", "requested")
			return connect.NewResponse(&publirav1.RequestEmailVerificationResponse{Requested: true}), nil
		}
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, "", "user_lookup_failed")
		return nil, s.internalDBError(ctx, "failed to get user for email verification request", err, "tenant_id", tenant.ID.String())
	}
	if user.EmailVerifiedAt.Valid {
		// Nothing left to activate, so nothing is sent. The answer is the same
		// either way; the audit trail is where the outcomes are told apart.
		auth.AuditEvent(req.Header(), "email_verification_request", "success", tenant.PublicID, user.PublicID, "already_verified")
		return connect.NewResponse(&publirav1.RequestEmailVerificationResponse{Requested: true}), nil
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, user.PublicID, "token_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	verificationToken := hex.EncodeToString(rawToken)
	verificationID, err := uuid.NewV7()
	if err != nil {
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, user.PublicID, "token_id_generation_failed")
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, user.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin email verification request transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	// Two requests for the same address arrive as often as a reader submits the
	// form twice, and the delete below cannot serialize them on its own: it
	// locks the rows it finds, so a request whose snapshot predates the other's
	// insert deletes nothing and leaves two live links behind. The account row
	// is what both requests have in common, so locking it is what puts them in
	// order — the second one's statements then run on a snapshot that includes
	// the first one's token, and the account keeps a single live link.
	//
	// It is a lock, not a write. The account itself is never modified here — no
	// password, no name, no credentials_version — so a request made by anyone
	// but its owner leaves nothing behind but a link only its owner receives.
	locked, err := txq.GetUserByIDForUpdate(ctx, user.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// The account was deleted while this request waited. There is
			// nothing to activate, and the answer still says nothing about that.
			auth.AuditEvent(req.Header(), "email_verification_request", "success", tenant.PublicID, user.PublicID, "account_gone")
			return connect.NewResponse(&publirav1.RequestEmailVerificationResponse{Requested: true}), nil
		}
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, user.PublicID, "user_lock_failed")
		return nil, s.internalDBError(ctx, "failed to lock the account for an email verification request", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if locked.EmailVerifiedAt.Valid {
		// The link from an earlier request was opened while this one waited.
		auth.AuditEvent(req.Header(), "email_verification_request", "success", tenant.PublicID, user.PublicID, "already_verified")
		return connect.NewResponse(&publirav1.RequestEmailVerificationResponse{Requested: true}), nil
	}

	if err := txq.DeleteUserEmailVerificationTokensByUserID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, user.PublicID, "token_delete_failed")
		return nil, s.internalDBError(ctx, "failed to delete email verification tokens", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if _, err := txq.CreateUserEmailVerificationToken(ctx, dbmodels.CreateUserEmailVerificationTokenParams{
		ID:        verificationID,
		TenantID:  tenant.ID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(verificationToken),
		ExpiresAt: time.Now().Add(emailVerificationTokenTTL),
	}); err != nil {
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, s.internalDBError(ctx, "failed to create email verification token", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := enqueueReaderEmailVerificationEmail(ctx, txq, tenant.ID, verificationID, verificationToken); err != nil {
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, user.PublicID, "verification_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue reader email verification email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "email_verification_request", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit email verification request transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	auth.AuditEvent(req.Header(), "email_verification_request", "success", tenant.PublicID, user.PublicID, "requested")
	return connect.NewResponse(&publirav1.RequestEmailVerificationResponse{Requested: true}), nil
}

func (s *apiServer) RequestEmailChange(
	ctx context.Context,
	req *connect.Request[publirav1.RequestEmailChangeRequest],
) (*connect.Response[publirav1.RequestEmailChangeResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
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
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("invalid current password"), "current_password")
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
		return nil, s.internalDBError(ctx, "failed to check email uniqueness", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
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

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin email change transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	if err := txq.DeleteUserEmailChangeTokensByUserID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "token_delete_failed")
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
		ExpiresAt:             time.Now().Add(emailVerificationTokenTTL),
	}); err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, s.internalDBError(ctx, "failed to create email change token", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := enqueueReaderEmailChangeConfirmationEmail(ctx, txq, tenant.ID, tokenID, "current_email", currentEmailToken); err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "current_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue reader email change confirmation email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := enqueueReaderEmailChangeConfirmationEmail(ctx, txq, tenant.ID, tokenID, "new_email", newEmailToken); err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "new_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue reader email change confirmation email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "email_change_request", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit email change transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	auth.AuditEvent(req.Header(), "email_change_request", "success", tenant.PublicID, user.PublicID, "confirmation_emails_enqueued")
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
		return nil, s.internalDBError(ctx, "failed to get email change token", err, "tenant_id", tenant.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to get user for email change confirm", err, "tenant_id", tenant.ID.String(), "user_id", changeToken.UserID.String())
	}
	if !strings.EqualFold(user.Email, changeToken.CurrentEmail) {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "stale_request")
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("email change request is no longer valid"))
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin email change confirm transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	matchedTarget := changeToken.MatchedTarget
	if matchedTarget == "current_email" {
		if err := txq.MarkUserEmailChangeCurrentEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "current_email_confirm_failed")
			return nil, s.internalDBError(ctx, "failed to confirm current email", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
		}
	} else {
		if err := txq.MarkUserEmailChangeNewEmailConfirmed(ctx, changeToken.ID); err != nil {
			auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "new_email_confirm_failed")
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
			auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
			return nil, s.internalDBError(ctx, "failed to commit email change confirm transaction", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
		}
		auth.AuditEvent(req.Header(), "email_change_confirm", "success", tenant.PublicID, user.PublicID, "waiting_for_"+pendingTarget)
		return connect.NewResponse(&publirav1.ConfirmEmailChangeResponse{
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
			auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "email_already_exists")
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already exists"))
		}
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "email_update_failed")
		return nil, s.internalDBError(ctx, "failed to update user email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := txq.MarkUserEmailChangeCompleted(ctx, changeToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "request_complete_failed")
		return nil, s.internalDBError(ctx, "failed to complete email change token", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
	}
	// The notice rides the same transaction as the address it announces, so the
	// old address is never told about a change that did not commit — and never
	// left untold about one that did.
	if err := enqueueReaderEmailChangedNoticeEmail(ctx, txq, tenant.ID, changeToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "old_email_notice_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue reader email changed notice email", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "email_change_confirm", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit email change confirm transaction", err, "tenant_id", tenant.ID.String(), "token_id", changeToken.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to get user for password reset", err, "tenant_id", tenant.ID.String())
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

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, user.PublicID, "transaction_begin_failed")
		return nil, s.internalDBError(ctx, "failed to begin password reset transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	if err := txq.DeleteUserPasswordResetTokensByUserID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_delete_failed")
		return nil, s.internalDBError(ctx, "failed to delete password reset tokens", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if _, err := txq.CreateUserPasswordResetToken(ctx, dbmodels.CreateUserPasswordResetTokenParams{
		ID:        tokenID,
		TenantID:  tenant.ID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(resetToken),
		ExpiresAt: time.Now().Add(emailVerificationTokenTTL),
	}); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, user.PublicID, "token_create_failed")
		return nil, s.internalDBError(ctx, "failed to create password reset token", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := enqueueReaderPasswordResetEmail(ctx, txq, tenant.ID, tokenID, resetToken); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, user.PublicID, "reset_email_enqueue_failed")
		return nil, s.internalDBError(ctx, "failed to enqueue reader password reset email", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := tx.Commit(); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_request", "failure", tenant.PublicID, user.PublicID, "transaction_commit_failed")
		return nil, s.internalDBError(ctx, "failed to commit password reset transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to get password reset token", err, "tenant_id", tenant.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to get user for password reset confirm", err, "tenant_id", tenant.ID.String(), "user_id", resetToken.UserID.String())
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
		return nil, s.internalDBError(ctx, "failed to update password", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if _, err := s.queriesFor(ctx).BumpUserCredentialsVersion(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "credentials_version_bump_failed")
		return nil, s.internalDBError(ctx, "failed to bump credentials version", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := s.queriesFor(ctx).MarkUserPasswordResetTokenCompleted(ctx, resetToken.ID); err != nil {
		auth.AuditEvent(req.Header(), "password_reset_confirm", "failure", tenant.PublicID, user.PublicID, "token_complete_failed")
		return nil, s.internalDBError(ctx, "failed to complete password reset token", err, "tenant_id", tenant.ID.String(), "token_id", resetToken.ID.String())
	}

	auth.AuditEvent(req.Header(), "password_reset_confirm", "success", tenant.PublicID, user.PublicID, "confirmed")
	return connect.NewResponse(&publirav1.ConfirmPasswordResetResponse{Confirmed: true}), nil
}

func (s *apiServer) Logout(
	ctx context.Context,
	req *connect.Request[publirav1.LogoutRequest],
) (*connect.Response[publirav1.LogoutResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), "logout", "failure", "", "", "tenant_not_found")
		return nil, err
	}
	// Stateless JWT: client clears cookie. Logout is for audit only.
	if _, ok := auth.BearerTokenFromHeader(req.Header()); ok {
		auth.AuditEvent(req.Header(), "logout", "success", tenant.PublicID, "", "client_logout")
	} else {
		auth.AuditEvent(req.Header(), "logout", "success", tenant.PublicID, "", "no_token")
	}
	return connect.NewResponse(&publirav1.LogoutResponse{}), nil
}

func (s *apiServer) GetMe(
	ctx context.Context,
	req *connect.Request[publirav1.GetMeRequest],
) (*connect.Response[publirav1.GetMeResponse], error) {
	_, user, role, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publirav1.GetMeResponse{User: &publirattypesv1.User{PublicId: user.PublicID, Name: user.Name, Role: role}}), nil
}

func (s *apiServer) UpdateMe(
	ctx context.Context,
	req *connect.Request[publirav1.UpdateMeRequest],
) (*connect.Response[publirav1.UpdateMeResponse], error) {
	_, user, role, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
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
		return nil, s.internalDBError(ctx, "failed to update user name", err, "user_id", user.ID.String())
	}
	auth.AuditEvent(req.Header(), "update_me", "success", user.PublicID, user.PublicID, "name_updated")
	return connect.NewResponse(&publirav1.UpdateMeResponse{User: &publirattypesv1.User{PublicId: updated.PublicID, Name: updated.Name, Role: role}}), nil
}

func (s *apiServer) DeleteMe(
	ctx context.Context,
	req *connect.Request[publirav1.DeleteMeRequest],
) (*connect.Response[publirav1.DeleteMeResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
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
		// Not Unauthenticated: the session is fine, the confirmation field is
		// wrong. Clients treat Unauthenticated as "re-authenticate", which would
		// log the reader out for a typo.
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("invalid password"), "password")
	}
	if _, err := s.queriesFor(ctx).BumpUserCredentialsVersion(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "delete_me", "failure", tenant.PublicID, user.PublicID, "credentials_version_bump_failed")
		return nil, s.internalDBError(ctx, "failed to bump credentials version", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if err := s.queriesFor(ctx).DeleteUserByID(ctx, user.ID); err != nil {
		auth.AuditEvent(req.Header(), "delete_me", "failure", tenant.PublicID, user.PublicID, "delete_failed")
		return nil, s.internalDBError(ctx, "failed to delete user", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	auth.AuditEvent(req.Header(), "delete_me", "success", tenant.PublicID, user.PublicID, "user_deleted")
	return connect.NewResponse(&publirav1.DeleteMeResponse{}), nil
}

func (s *apiServer) GetNotificationSettings(
	ctx context.Context,
	req *connect.Request[publirav1.GetNotificationSettingsRequest],
) (*connect.Response[publirav1.GetNotificationSettingsResponse], error) {
	_, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	settings, err := s.queriesFor(ctx).GetUserNotificationSettings(ctx, user.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewResponse(&publirav1.GetNotificationSettingsResponse{EmailNotificationsEnabled: true}), nil
		}
		return nil, s.internalDBError(ctx, "failed to get notification settings", err, "user_id", user.ID.String())
	}
	return connect.NewResponse(&publirav1.GetNotificationSettingsResponse{EmailNotificationsEnabled: settings.EmailNotificationsEnabled}), nil
}

func (s *apiServer) UpdateNotificationSettings(
	ctx context.Context,
	req *connect.Request[publirav1.UpdateNotificationSettingsRequest],
) (*connect.Response[publirav1.UpdateNotificationSettingsResponse], error) {
	_, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	updated, err := s.queriesFor(ctx).UpsertUserNotificationSettings(ctx, dbmodels.UpsertUserNotificationSettingsParams{
		UserID:                    user.ID,
		EmailNotificationsEnabled: req.Msg.EmailNotificationsEnabled,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update notification settings", err, "user_id", user.ID.String())
	}
	return connect.NewResponse(&publirav1.UpdateNotificationSettingsResponse{EmailNotificationsEnabled: updated.EmailNotificationsEnabled}), nil
}

type announcementPageRow struct {
	id               uuid.UUID
	announcementType string
	title            string
	body             string
	linkURL          sql.NullString
	isRead           bool
	readAt           sql.NullTime
	createdAt        time.Time
}

// is_read comes back as an untyped SQL boolean expression, so it lands in an
// interface{} column that has to be asserted before it can be sent.
func announcementIsRead(value any) bool {
	read, ok := value.(bool)
	return ok && read
}

func mapAnnouncementDescRows(rows []dbmodels.ListAnnouncementsForUserDescRow) []announcementPageRow {
	mapped := make([]announcementPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, announcementPageRow{
			id:               row.ID,
			announcementType: row.AnnouncementType,
			title:            row.Title,
			body:             row.Body,
			linkURL:          row.LinkUrl,
			isRead:           announcementIsRead(row.IsRead),
			readAt:           row.ReadAt,
			createdAt:        row.CreatedAt,
		})
	}
	return mapped
}

func mapAnnouncementAscRows(rows []dbmodels.ListAnnouncementsForUserAscRow) []announcementPageRow {
	mapped := make([]announcementPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, announcementPageRow{
			id:               row.ID,
			announcementType: row.AnnouncementType,
			title:            row.Title,
			body:             row.Body,
			linkURL:          row.LinkUrl,
			isRead:           announcementIsRead(row.IsRead),
			readAt:           row.ReadAt,
			createdAt:        row.CreatedAt,
		})
	}
	return mapped
}

func toAnnouncementItem(row announcementPageRow) *publirav1.AnnouncementItem {
	readAt := ""
	if row.readAt.Valid {
		readAt = row.readAt.Time.UTC().Format(time.RFC3339)
	}
	return &publirav1.AnnouncementItem{
		Id:               row.id.String(),
		AnnouncementType: row.announcementType,
		Title:            row.title,
		Body:             row.body,
		LinkUrl:          row.linkURL.String,
		IsRead:           row.isRead,
		ReadAt:           readAt,
		CreatedAt:        row.createdAt.UTC().Format(time.RFC3339),
	}
}

func (s *apiServer) announcementPage(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]announcementPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListAnnouncementsForUserAsc(ctx, dbmodels.ListAnnouncementsForUserAscParams{
			TenantID:        tenantID,
			UserID:          userID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapAnnouncementAscRows(rows), nil
	}

	rows, err := queries.ListAnnouncementsForUserDesc(ctx, dbmodels.ListAnnouncementsForUserDescParams{
		TenantID:        tenantID,
		UserID:          userID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapAnnouncementDescRows(rows), nil
}

func (s *apiServer) ListAnnouncements(
	ctx context.Context,
	req *connect.Request[publirav1.ListAnnouncementsRequest],
) (*connect.Response[publirav1.ListAnnouncementsResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultAnnouncementPageSize, maxAnnouncementPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	rows, err := s.announcementPage(ctx, tenant.ID, user.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list announcements", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirav1.AnnouncementItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, toAnnouncementItem(row))
	}

	res := &publirav1.ListAnnouncementsResponse{Announcements: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].createdAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}

func (s *apiServer) GetAnnouncement(
	ctx context.Context,
	req *connect.Request[publirav1.GetAnnouncementRequest],
) (*connect.Response[publirav1.GetAnnouncementResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}

	announcementID, parseErr := uuid.Parse(strings.TrimSpace(req.Msg.AnnouncementId))
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("announcement_id is invalid"))
	}

	row, err := s.queriesFor(ctx).GetAnnouncementForUser(ctx, dbmodels.GetAnnouncementForUserParams{
		ID:       announcementID,
		TenantID: tenant.ID,
		UserID:   user.ID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("announcement not found"))
		}
		return nil, s.internalDBError(ctx,
			"failed to get announcement",
			err,
			"tenant_id", tenant.ID.String(),
			"user_id", user.ID.String(),
			"announcement_id", announcementID.String(),
		)
	}

	return connect.NewResponse(&publirav1.GetAnnouncementResponse{
		Announcement: toAnnouncementItem(announcementPageRow{
			id:               row.ID,
			announcementType: row.AnnouncementType,
			title:            row.Title,
			body:             row.Body,
			linkURL:          row.LinkUrl,
			isRead:           announcementIsRead(row.IsRead),
			readAt:           row.ReadAt,
			createdAt:        row.CreatedAt,
		}),
	}), nil
}

func (s *apiServer) MarkAnnouncementAsRead(
	ctx context.Context,
	req *connect.Request[publirav1.MarkAnnouncementAsReadRequest],
) (*connect.Response[publirav1.MarkAnnouncementAsReadResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}

	announcementID, parseErr := uuid.Parse(strings.TrimSpace(req.Msg.AnnouncementId))
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("announcement_id is invalid"))
	}

	_, err = s.queriesFor(ctx).MarkAnnouncementAsRead(ctx, dbmodels.MarkAnnouncementAsReadParams{
		ID:       announcementID,
		TenantID: tenant.ID,
		UserID:   user.ID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("announcement not found"))
		}
		return nil, s.internalDBError(ctx, "failed to mark announcement as read", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String(), "announcement_id", announcementID.String())
	}

	return connect.NewResponse(&publirav1.MarkAnnouncementAsReadResponse{Marked: true}), nil
}

func (s *apiServer) MarkAllAnnouncementsAsRead(
	ctx context.Context,
	req *connect.Request[publirav1.MarkAllAnnouncementsAsReadRequest],
) (*connect.Response[publirav1.MarkAllAnnouncementsAsReadResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}

	marked, err := s.queriesFor(ctx).MarkAllAnnouncementsAsRead(ctx, dbmodels.MarkAllAnnouncementsAsReadParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to mark all announcements as read", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	return connect.NewResponse(&publirav1.MarkAllAnnouncementsAsReadResponse{MarkedCount: int32(marked)}), nil
}
