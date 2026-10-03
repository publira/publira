package outbox

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/publicid"
)

// The reader forms that answer a registered address exactly as they answer a
// free one. The API records the request and returns, so the time it takes to
// answer is the same whichever case the address is in; which case that is gets
// decided here, where no caller is waiting on it.
const (
	EventTypeReaderSignupRequest            = "reader_signup_request"
	EventTypeReaderPasswordResetRequest     = "reader_password_reset_request"
	EventTypeReaderEmailVerificationRequest = "reader_email_verification_request"
)

// authLinkTTL is how long a link issued for one of these requests, or for one of
// the console password resets, stays valid.
const authLinkTTL = 24 * time.Hour

// ReaderSignupRequestPayload is a sign-up the form accepted, with everything the
// account needs if the address turns out to be free. The password arrives as its
// hash, and the terminal updates drop it as they drop an auth mail's token.
type ReaderSignupRequestPayload struct {
	TenantID string `json:"tenant_id"`
	// UserID is the id the account takes if the address is free, which is also
	// how a retry recognises an account its own earlier attempt created.
	UserID               string   `json:"user_id"`
	Email                string   `json:"email"`
	Name                 string   `json:"name"`
	PasswordHash         string   `json:"password_hash"`
	BirthDate            string   `json:"birth_date,omitempty"`
	AgreedPageVersionIDs []string `json:"agreed_page_version_ids,omitempty"`
}

// ReaderPasswordResetRequestPayload is the address a reset was asked for.
type ReaderPasswordResetRequestPayload struct {
	TenantID string `json:"tenant_id"`
	Email    string `json:"email"`
}

// ReaderEmailVerificationRequestPayload is the address a fresh activation link
// was asked for.
type ReaderEmailVerificationRequestPayload struct {
	TenantID string `json:"tenant_id"`
	Email    string `json:"email"`
}

type readerSignup struct {
	tenantID         uuid.UUID
	userID           uuid.UUID
	email            string
	name             string
	passwordHash     string
	birthDate        sql.NullTime
	agreedVersionIDs []uuid.UUID
}

// NewReaderSignupRequestHandler opens the account a sign-up asked for, or, when
// the address already has one, tells that account's owner about the attempt.
func NewReaderSignupRequestHandler(cfg EmailHandlerConfig) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil {
			return errors.New("reader signup request handler database is not configured")
		}
		var payload ReaderSignupRequestPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode reader signup request payload: %w", err))
		}
		signup, err := parseReaderSignup(event, payload)
		if err != nil {
			return Permanent(err)
		}

		outcome, err := processReaderSignup(ctx, cfg.DB, event, signup)
		if dberr.IsUniqueViolation(err) {
			// Another sign-up for the address committed between the lookup and
			// the insert, and a second pass finds its account.
			outcome, err = processReaderSignup(ctx, cfg.DB, event, signup)
		}
		if err != nil {
			return err
		}
		cfg.logAuthRequest(ctx, event, outcome)
		return nil
	}
}

func parseReaderSignup(event dbmodels.OutboxEvent, payload ReaderSignupRequestPayload) (readerSignup, error) {
	tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
	if err != nil {
		return readerSignup{}, err
	}
	userID, err := uuid.Parse(payload.UserID)
	if err != nil {
		return readerSignup{}, fmt.Errorf("%s payload has an invalid user_id", event.EventType)
	}
	if strings.TrimSpace(payload.Email) == "" || strings.TrimSpace(payload.Name) == "" || payload.PasswordHash == "" {
		return readerSignup{}, fmt.Errorf("%s payload is missing the email, the name, or the password hash", event.EventType)
	}
	signup := readerSignup{
		tenantID:     tenantID,
		userID:       userID,
		email:        payload.Email,
		name:         payload.Name,
		passwordHash: payload.PasswordHash,
	}
	if payload.BirthDate != "" {
		birthDate, err := time.Parse(time.DateOnly, payload.BirthDate)
		if err != nil {
			return readerSignup{}, fmt.Errorf("%s payload has an invalid birth_date", event.EventType)
		}
		signup.birthDate = sql.NullTime{Time: birthDate, Valid: true}
	}
	for _, raw := range payload.AgreedPageVersionIDs {
		versionID, err := uuid.Parse(raw)
		if err != nil {
			return readerSignup{}, fmt.Errorf("%s payload has an invalid agreed page version id", event.EventType)
		}
		signup.agreedVersionIDs = append(signup.agreedVersionIDs, versionID)
	}
	return signup, nil
}

func processReaderSignup(ctx context.Context, db *sql.DB, event dbmodels.OutboxEvent, signup readerSignup) (string, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin reader signup transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)

	// An address that differs from an account's only by its sub-address tag
	// reaches the same inbox, so it is that account's address too: a receiver
	// collecting one account per tag would otherwise collect every per-account
	// allowance once per tag. The lock keeps a concurrent sign-up for another
	// tag of the same inbox from finding it free as well.
	if err := queries.LockCanonicalEmailForTenant(ctx, dbmodels.LockCanonicalEmailForTenantParams{
		TenantID: signup.tenantID,
		Email:    signup.email,
	}); err != nil {
		return "", fmt.Errorf("lock the inbox of a reader signup: %w", err)
	}
	existing, err := queries.GetUserByCanonicalEmailForTenant(ctx, dbmodels.GetUserByCanonicalEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: signup.tenantID, Valid: true},
		Email:    signup.email,
	})
	if err == nil {
		if existing.ID == signup.userID {
			return "already_processed", nil
		}
		// One notice per attempt, keyed by the request: a reader targeted again
		// months later has to hear about it too. It goes to the address the
		// sign-up typed, which reaches the inbox the account already holds, so
		// the answer to the sign-up stays the one a free address gets.
		if _, err := queueTenantEvent(ctx, queries, signup.tenantID, EventTypeReaderSignupAttemptNoticeEmail,
			ReaderSignupAttemptNoticeEmailPayload{TenantID: signup.tenantID.String(), UserID: existing.ID.String(), Email: signup.email},
			EventTypeReaderSignupAttemptNoticeEmail+":"+event.ID.String(),
		); err != nil {
			return "", err
		}
		if err := tx.Commit(); err != nil {
			return "", fmt.Errorf("commit reader signup attempt notice: %w", err)
		}
		return "email_already_exists", nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("look up the address of a reader signup: %w", err)
	}

	// The account, its verification token, and the mail that carries the link
	// commit together, so no account is left inactive with no way to activate it.
	user, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.User, error) {
		return queries.CreateUser(ctx, dbmodels.CreateUserParams{
			ID:           signup.userID,
			TenantID:     uuid.NullUUID{UUID: signup.tenantID, Valid: true},
			PublicID:     publicID,
			Email:        signup.email,
			PasswordHash: sql.NullString{String: signup.passwordHash, Valid: true},
			Name:         signup.name,
			BirthDate:    signup.birthDate,
		})
	})
	if err != nil {
		return "", fmt.Errorf("create reader: %w", err)
	}
	if _, err := queries.UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{ID: user.ID, Status: "inactive"}); err != nil {
		return "", fmt.Errorf("set the new reader inactive: %w", err)
	}
	for _, versionID := range signup.agreedVersionIDs {
		if err := queries.CreateUserPageConsent(ctx, dbmodels.CreateUserPageConsentParams{
			TenantID:      signup.tenantID,
			UserID:        user.ID,
			PageVersionID: versionID,
		}); err != nil {
			return "", fmt.Errorf("record page consent: %w", err)
		}
	}
	tokenID, err := uuid.NewV7()
	if err != nil {
		return "", fmt.Errorf("generate email verification token id: %w", err)
	}
	if _, err := issueReaderEmailVerification(ctx, queries, signup.tenantID, user.ID, tokenID); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit reader signup: %w", err)
	}
	return "account_created", nil
}

// NewReaderPasswordResetRequestHandler issues the reset link an address asked
// for, when an account holds it.
func NewReaderPasswordResetRequestHandler(cfg EmailHandlerConfig) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil {
			return errors.New("reader password reset request handler database is not configured")
		}
		var payload ReaderPasswordResetRequestPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode reader password reset request payload: %w", err))
		}
		tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
		if err != nil {
			return Permanent(err)
		}

		outcome, err := processUserPasswordReset(ctx, cfg.DB, event, tenantID, payload.Email,
			EventTypeReaderPasswordResetEmail, func(token string) any {
				return ReaderPasswordResetEmailPayload{TenantID: tenantID.String(), TokenID: event.ID.String(), Token: token}
			},
		)
		if err != nil {
			return err
		}
		cfg.logAuthRequest(ctx, event, outcome)
		return nil
	}
}

// processUserPasswordReset issues a reset link to the account in users that an
// address belongs to. A reader and a tenant administrator share that table and
// its reset tokens, and differ only in the mail that carries the link.
func processUserPasswordReset(
	ctx context.Context,
	db *sql.DB,
	event dbmodels.OutboxEvent,
	tenantID uuid.UUID,
	email string,
	mailEventType string,
	mailPayload func(token string) any,
) (string, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin password reset transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)

	user, err := lockUserByEmail(ctx, queries, tenantID, email)
	if errors.Is(err, sql.ErrNoRows) {
		return "no_account", nil
	}
	if err != nil {
		return "", err
	}

	if err := queries.DeleteUserPasswordResetTokensByUserID(ctx, user.ID); err != nil {
		return "", fmt.Errorf("delete password reset tokens: %w", err)
	}
	token, err := newAuthToken()
	if err != nil {
		return "", err
	}
	// The token takes the request's id, so the mail is keyed by the request and
	// a retry of one that already committed finds its mail queued.
	if _, err := queries.CreateUserPasswordResetToken(ctx, dbmodels.CreateUserPasswordResetTokenParams{
		ID:        event.ID,
		TenantID:  tenantID,
		UserID:    user.ID,
		TokenHash: auth.HashToken(token),
		ExpiresAt: time.Now().Add(authLinkTTL),
	}); err != nil {
		return "", fmt.Errorf("create password reset token: %w", err)
	}
	queued, err := queueTenantEvent(ctx, queries, tenantID, mailEventType, mailPayload(token), mailEventType+":"+event.ID.String())
	if err != nil {
		return "", err
	}
	if !queued {
		return "already_processed", nil
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit password reset: %w", err)
	}
	return "reset_link_issued", nil
}

// NewReaderEmailVerificationRequestHandler issues a fresh activation link to an
// address whose account has never been confirmed. A confirmed account and an
// address with no account are sent nothing.
func NewReaderEmailVerificationRequestHandler(cfg EmailHandlerConfig) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil {
			return errors.New("reader email verification request handler database is not configured")
		}
		var payload ReaderEmailVerificationRequestPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode reader email verification request payload: %w", err))
		}
		tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
		if err != nil {
			return Permanent(err)
		}

		outcome, err := processReaderEmailVerification(ctx, cfg.DB, event, tenantID, payload.Email)
		if err != nil {
			return err
		}
		cfg.logAuthRequest(ctx, event, outcome)
		return nil
	}
}

func processReaderEmailVerification(
	ctx context.Context,
	db *sql.DB,
	event dbmodels.OutboxEvent,
	tenantID uuid.UUID,
	email string,
) (string, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin reader email verification transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)

	user, err := lockUserByEmail(ctx, queries, tenantID, email)
	if errors.Is(err, sql.ErrNoRows) {
		return "no_account", nil
	}
	if err != nil {
		return "", err
	}
	if user.EmailVerifiedAt.Valid {
		return "already_verified", nil
	}

	if err := queries.DeleteUserEmailVerificationTokensByUserID(ctx, user.ID); err != nil {
		return "", fmt.Errorf("delete email verification tokens: %w", err)
	}
	// Keyed by the request for the same reason as the password reset above.
	queued, err := issueReaderEmailVerification(ctx, queries, tenantID, user.ID, event.ID)
	if err != nil {
		return "", err
	}
	if !queued {
		return "already_processed", nil
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit reader email verification: %w", err)
	}
	return "verification_link_issued", nil
}

// lockUserByEmail finds the account an address belongs to and locks its row.
// The token deletes that follow lock only the rows they find, so two requests
// for one address would each leave a live link behind; the account row is what
// they have in common, and locking it puts them in order.
func lockUserByEmail(ctx context.Context, queries *dbmodels.Queries, tenantID uuid.UUID, email string) (dbmodels.User, error) {
	found, err := queries.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenantID, Valid: true},
		Email:    email,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.User{}, err
		}
		return dbmodels.User{}, fmt.Errorf("look up the reader: %w", err)
	}
	locked, err := queries.GetUserByIDForUpdate(ctx, found.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.User{}, err
		}
		return dbmodels.User{}, fmt.Errorf("lock the reader: %w", err)
	}
	return locked, nil
}

// issueReaderEmailVerification writes an activation link for the account and
// queues the mail that carries it. It reports false when that mail is already
// queued, which only a retry of the same request can cause.
func issueReaderEmailVerification(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, userID, tokenID uuid.UUID,
) (bool, error) {
	token, err := newAuthToken()
	if err != nil {
		return false, err
	}
	if _, err := queries.CreateUserEmailVerificationToken(ctx, dbmodels.CreateUserEmailVerificationTokenParams{
		ID:        tokenID,
		TenantID:  tenantID,
		UserID:    userID,
		TokenHash: auth.HashToken(token),
		ExpiresAt: time.Now().Add(authLinkTTL),
	}); err != nil {
		return false, fmt.Errorf("create email verification token: %w", err)
	}
	return queueTenantEvent(ctx, queries, tenantID, EventTypeReaderEmailVerificationEmail,
		ReaderEmailVerificationEmailPayload{TenantID: tenantID.String(), TokenID: tokenID.String(), Token: token},
		EventTypeReaderEmailVerificationEmail+":"+tokenID.String(),
	)
}

func newAuthToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate reader auth token: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

// queueTenantEvent inserts an outbox event for a tenant and reports whether it
// was queued; an event with the same key already queued leaves it false.
func queueTenantEvent(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	eventType string,
	payload any,
	idempotencyKey string,
) (bool, error) {
	return queueEvent(ctx, queries, uuid.NullUUID{UUID: tenantID, Valid: true}, eventType, payload, idempotencyKey)
}

// queueEvent is queueTenantEvent for an event that may belong to no tenant, as
// the platform console's own mail does.
func queueEvent(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.NullUUID,
	eventType string,
	payload any,
	idempotencyKey string,
) (bool, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return false, fmt.Errorf("marshal %s event: %w", eventType, err)
	}
	eventID, err := uuid.NewV7()
	if err != nil {
		return false, fmt.Errorf("generate outbox event id: %w", err)
	}
	_, err = queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             eventID,
		TenantID:       tenantID,
		EventType:      eventType,
		Payload:        body,
		IdempotencyKey: idempotencyKey,
		AvailableAt:    time.Now().UTC(),
	})
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("queue %s event: %w", eventType, err)
	}
	return true, nil
}

// logAuthRequest records which case a request turned out to be. The form
// answered every case alike, so this log is the one place they are told apart.
func (cfg EmailHandlerConfig) logAuthRequest(ctx context.Context, event dbmodels.OutboxEvent, outcome string) {
	if cfg.Logger == nil {
		return
	}
	attrs := []any{"event_id", event.ID, "event_type", event.EventType, "outcome", outcome}
	if event.TenantID.Valid {
		attrs = append(attrs, "tenant_id", event.TenantID.UUID)
	}
	cfg.Logger.InfoContext(ctx, "processed auth request", attrs...)
}
