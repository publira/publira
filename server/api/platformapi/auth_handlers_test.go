package platformapi

import (
	"bytes"
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
)

const (
	testCreatePlatformSessionQuery = "-- name: CreatePlatformSession :one\n"
	testRevokePlatformSessionQuery = "-- name: RevokePlatformSession :exec\n"
)

type passwordResetMailerStub struct {
	recipient string
	subject   string
	body      string
	settings  emailsettings.SMTPSettings
	err       error
	sentTo    []string
}

func (s *passwordResetMailerStub) SendEmail(
	_ context.Context,
	settings emailsettings.SMTPSettings,
	recipient string,
	subject string,
	body string,
) error {
	s.settings = settings
	s.recipient = recipient
	s.subject = subject
	s.body = body
	s.sentTo = append(s.sentTo, recipient)
	return s.err
}

func newPasswordResetEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{1}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

func platformPasswordResetTokenColumns() []string {
	return []string{"id", "platform_user_id", "token_hash", "expires_at", "completed_at", "created_at"}
}

func platformEmailChangeTokenColumns() []string {
	return []string{"id", "platform_user_id", "current_email", "new_email", "current_email_token_hash", "new_email_token_hash", "current_email_confirmed_at", "new_email_confirmed_at", "expires_at", "completed_at", "created_at", "matched_target"}
}

func platformSMTPColumnsForAuth() []string {
	return []string{"singleton", "host", "port", "username", "password_encrypted", "encryption", "from_address", "reply_to", "created_at", "updated_at"}
}

func TestPlatformAuthCreateSessionSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	password := "secret-password"
	passwordHashBytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("GenerateFromPassword: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByEmailQuery)).
		WithArgs("platform@example.com").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", string(passwordHashBytes), "Platform User", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(testListPlatformUserRolesQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(rolePlatformOperator))

	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformSessionQuery)).
		WithArgs(sqlmock.AnyArg(), userID, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "platform_user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), userID, "token-hash", now.Add(time.Hour), nil, now))

	resp, err := server.CreateSession(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceCreateSessionRequest{
		Email:    "platform@example.com",
		Password: password,
	}))
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if resp.Msg.User == nil || resp.Msg.User.Role != rolePlatformOperator {
		t.Fatalf("user.role = %v, want %s", resp.Msg.User, rolePlatformOperator)
	}
	if resp.Msg.Session == nil || resp.Msg.Session.SessionId == "" {
		t.Fatalf("session is missing token")
	}
	if got := resp.Header().Get("Set-Cookie"); got == "" {
		t.Fatalf("Set-Cookie is empty")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthRequestPasswordResetSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.encryptor = newPasswordResetEncryptor(t)
	mailer := &passwordResetMailerStub{}
	server.mailer = mailer
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	encryptedPassword, err := server.encryptor.EncryptString("smtp-secret")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByEmailQuery)).
		WithArgs("platform@example.com").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now))
	mock.ExpectExec(regexp.QuoteMeta(testDeletePlatformUserPasswordResetTokens)).
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformUserPasswordResetToken)).
		WithArgs(sqlmock.AnyArg(), userID, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(platformPasswordResetTokenColumns()).
			AddRow(uuid.Must(uuid.NewV7()), userID, "token-hash", now.Add(time.Hour), nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformSMTPConfigQuery)).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumnsForAuth()).
			AddRow(true, "smtp.example.com", 587, "mailer", encryptedPassword, "starttls", "no-reply@example.com", nil, now, now))

	resp, err := server.RequestPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
		Email: "platform@example.com",
	}))
	if err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("requested = false, want true")
	}
	if mailer.recipient != "platform@example.com" {
		t.Fatalf("mailer.recipient = %q, want platform@example.com", mailer.recipient)
	}
	if mailer.subject == "" || mailer.body == "" {
		t.Fatal("password reset email was not populated")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthRequestPasswordResetUnknownUserReturnsRequested(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByEmailQuery)).
		WithArgs("missing@example.com").
		WillReturnError(sql.ErrNoRows)

	resp, err := server.RequestPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
		Email: "missing@example.com",
	}))
	if err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("requested = false, want true")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthVerifyPasswordResetTokenValid(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformPasswordResetTokenByHash)).
		WithArgs(auth.HashToken("valid-token")).
		WillReturnRows(sqlmock.NewRows(platformPasswordResetTokenColumns()).
			AddRow(uuid.Must(uuid.NewV7()), userID, auth.HashToken("valid-token"), now.Add(time.Hour), nil, now))

	resp, err := server.VerifyPasswordResetToken(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceVerifyPasswordResetTokenRequest{
		Token: "valid-token",
	}))
	if err != nil {
		t.Fatalf("VerifyPasswordResetToken: %v", err)
	}
	if !resp.Msg.Valid {
		t.Fatal("valid = false, want true")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthConfirmPasswordResetSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	tokenID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformPasswordResetTokenByHash)).
		WithArgs(auth.HashToken("valid-token")).
		WillReturnRows(sqlmock.NewRows(platformPasswordResetTokenColumns()).
			AddRow(tokenID, userID, auth.HashToken("valid-token"), now.Add(time.Hour), nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now))
	mock.ExpectQuery(regexp.QuoteMeta(testUpdatePlatformUserPasswordHashByID)).
		WithArgs(userID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "updated-hash", "Platform User", "active", now))
	mock.ExpectExec(regexp.QuoteMeta(testTerminatePlatformUserSessionsQuery)).
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(testMarkPlatformPasswordResetTokenCompleted)).
		WithArgs(tokenID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	resp, err := server.ConfirmPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmPasswordResetRequest{
		Token:       "valid-token",
		NewPassword: "new-password",
	}))
	if err != nil {
		t.Fatalf("ConfirmPasswordReset: %v", err)
	}
	if !resp.Msg.Confirmed {
		t.Fatal("confirmed = false, want true")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthConfirmPasswordResetInvalidToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformPasswordResetTokenByHash)).
		WithArgs(auth.HashToken("invalid-token")).
		WillReturnError(sql.ErrNoRows)

	_, err := server.ConfirmPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmPasswordResetRequest{
		Token:       "invalid-token",
		NewPassword: "new-password",
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ConfirmPasswordReset code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthRequestEmailChangeSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.encryptor = newPasswordResetEncryptor(t)
	mailer := &passwordResetMailerStub{}
	server.mailer = mailer
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	sessionID := uuid.Must(uuid.NewV7())
	passwordHashBytes, err := bcrypt.GenerateFromPassword([]byte("current-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("GenerateFromPassword: %v", err)
	}
	encryptedPassword, err := server.encryptor.EncryptString("smtp-secret")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformSessionByTokenHashQuery)).
		WithArgs(auth.HashToken(testPlatformSessionToken)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "platform_user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
			AddRow(sessionID, userID, auth.HashToken(testPlatformSessionToken), now.Add(time.Hour), nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", string(passwordHashBytes), "Platform User", "active", now))
	mock.ExpectQuery(regexp.QuoteMeta(testListPlatformUserRolesQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(rolePlatformOperator))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByEmailQuery)).
		WithArgs("next@example.com").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta(testDeletePlatformEmailChangeTokens)).
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformEmailChangeToken)).
		WithArgs(sqlmock.AnyArg(), userID, "platform@example.com", "next@example.com", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "platform_user_id", "current_email", "new_email", "current_email_token_hash", "new_email_token_hash", "current_email_confirmed_at", "new_email_confirmed_at", "expires_at", "completed_at", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), userID, "platform@example.com", "next@example.com", "h1", "h2", nil, nil, now.Add(time.Hour), nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformSMTPConfigQuery)).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumnsForAuth()).
			AddRow(true, "smtp.example.com", 587, "mailer", encryptedPassword, "starttls", "no-reply@example.com", nil, now, now))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformSMTPConfigQuery)).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumnsForAuth()).
			AddRow(true, "smtp.example.com", 587, "mailer", encryptedPassword, "starttls", "no-reply@example.com", nil, now, now))

	resp, err := server.RequestEmailChange(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.PlatformAuthServiceRequestEmailChangeRequest{
		CurrentEmail:    "platform@example.com",
		NewEmail:        "next@example.com",
		CurrentPassword: "current-password",
	}))
	if err != nil {
		t.Fatalf("RequestEmailChange: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("requested = false, want true")
	}
	if len(mailer.sentTo) != 2 {
		t.Fatalf("sent email count = %d, want 2", len(mailer.sentTo))
	}
	if mailer.sentTo[0] != "platform@example.com" || mailer.sentTo[1] != "next@example.com" {
		t.Fatalf("recipients = %v, want [platform@example.com next@example.com]", mailer.sentTo)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthVerifyEmailChangeTokenValid(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	tokenID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformEmailChangeTokenByHash)).
		WithArgs(auth.HashToken("valid-email-token")).
		WillReturnRows(sqlmock.NewRows(platformEmailChangeTokenColumns()).
			AddRow(tokenID, userID, "platform@example.com", "next@example.com", "h1", auth.HashToken("valid-email-token"), nil, nil, now.Add(time.Hour), nil, now, "new_email"))

	resp, err := server.VerifyEmailChangeToken(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceVerifyEmailChangeTokenRequest{Token: "valid-email-token"}))
	if err != nil {
		t.Fatalf("VerifyEmailChangeToken: %v", err)
	}
	if !resp.Msg.Valid {
		t.Fatal("valid = false, want true")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthConfirmEmailChangeSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.encryptor = newPasswordResetEncryptor(t)
	mailer := &passwordResetMailerStub{}
	server.mailer = mailer
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	tokenID := uuid.Must(uuid.NewV7())
	encryptedPassword, err := server.encryptor.EncryptString("smtp-secret")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformEmailChangeTokenByHash)).
		WithArgs(auth.HashToken("confirm-token")).
		WillReturnRows(sqlmock.NewRows(platformEmailChangeTokenColumns()).
			AddRow(tokenID, userID, "platform@example.com", "next@example.com", "h1", auth.HashToken("confirm-token"), now.Add(-10*time.Minute), nil, now.Add(time.Hour), nil, now, "new_email"))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now))
	mock.ExpectExec(regexp.QuoteMeta(testMarkPlatformEmailChangeNewConfirmed)).
		WithArgs(tokenID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testUpdatePlatformUserEmailByID)).
		WithArgs(userID, "next@example.com").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "next@example.com", "hashed", "Platform User", "active", now))
	mock.ExpectExec(regexp.QuoteMeta(testMarkPlatformEmailChangeCompleted)).
		WithArgs(tokenID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformSMTPConfigQuery)).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumnsForAuth()).
			AddRow(true, "smtp.example.com", 587, "mailer", encryptedPassword, "starttls", "no-reply@example.com", nil, now, now))

	resp, err := server.ConfirmEmailChange(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmEmailChangeRequest{Token: "confirm-token"}))
	if err != nil {
		t.Fatalf("ConfirmEmailChange: %v", err)
	}
	if !resp.Msg.Confirmed || !resp.Msg.Changed {
		t.Fatalf("response = %+v, want confirmed=true changed=true", resp.Msg)
	}
	if mailer.recipient != "platform@example.com" {
		t.Fatalf("notice recipient = %q, want platform@example.com", mailer.recipient)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthConfirmEmailChangePendingAfterFirstConfirmation(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	tokenID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformEmailChangeTokenByHash)).
		WithArgs(auth.HashToken("first-token")).
		WillReturnRows(sqlmock.NewRows(platformEmailChangeTokenColumns()).
			AddRow(tokenID, userID, "platform@example.com", "next@example.com", auth.HashToken("first-token"), "h2", nil, nil, now.Add(time.Hour), nil, now, "current_email"))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now))
	mock.ExpectExec(regexp.QuoteMeta(testMarkPlatformEmailChangeCurrentConfirmed)).
		WithArgs(tokenID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	resp, err := server.ConfirmEmailChange(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmEmailChangeRequest{Token: "first-token"}))
	if err != nil {
		t.Fatalf("ConfirmEmailChange: %v", err)
	}
	if !resp.Msg.Confirmed || resp.Msg.Changed {
		t.Fatalf("response = %+v, want confirmed=true changed=false", resp.Msg)
	}
	if resp.Msg.PendingConfirmationFor != "new_email" {
		t.Fatalf("pending_confirmation_for = %q, want new_email", resp.Msg.PendingConfirmationFor)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthGetMeSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, userID, rolePlatformOperator, now)

	resp, err := server.GetMe(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.PlatformAuthServiceGetMeRequest{}))
	if err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	if resp.Msg.User == nil || resp.Msg.User.Role != rolePlatformOperator {
		t.Fatalf("user.role = %v, want %s", resp.Msg.User, rolePlatformOperator)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthDeleteSessionRevokes(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	sessionID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformSessionByTokenHashQuery)).
		WithArgs(auth.HashToken(testPlatformSessionToken)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "platform_user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
			AddRow(sessionID, userID, auth.HashToken(testPlatformSessionToken), now.Add(time.Hour), nil, now))

	mock.ExpectExec(regexp.QuoteMeta(testRevokePlatformSessionQuery)).
		WithArgs(sessionID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	resp, err := server.DeleteSession(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.PlatformAuthServiceDeleteSessionRequest{}))
	if err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	if got := resp.Header().Get("Set-Cookie"); got == "" {
		t.Fatalf("Set-Cookie is empty")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthDeleteSessionMissingTokenClearsCookie(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	resp, err := server.DeleteSession(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceDeleteSessionRequest{}))
	if err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	if got := resp.Header().Get("Set-Cookie"); got == "" {
		t.Fatalf("Set-Cookie is empty")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthGetMeUnauthenticated(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	_, err := server.GetMe(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceGetMeRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe code = %v, want unauthenticated", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthCreateSessionInvalidCredentials(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByEmailQuery)).
		WithArgs("platform@example.com").
		WillReturnError(sql.ErrNoRows)

	_, err := server.CreateSession(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceCreateSessionRequest{
		Email:    "platform@example.com",
		Password: "wrong-password",
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("CreateSession code = %v, want unauthenticated", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}
