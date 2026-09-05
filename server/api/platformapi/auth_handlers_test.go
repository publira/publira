package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/outbox"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
)

func platformPasswordResetTokenColumns() []string {
	return []string{"id", "platform_user_id", "token_hash", "expires_at", "completed_at", "created_at"}
}

func outboxEventColumns() []string {
	return []string{"id", "tenant_id", "event_type", "payload", "idempotency_key", "status", "attempts", "available_at", "last_error", "created_at", "updated_at"}
}

func newOutboxEventRow(eventType string) *sqlmock.Rows {
	return sqlmock.NewRows(outboxEventColumns()).
		AddRow(uuid.Must(uuid.NewV7()), nil, eventType, []byte("{}"), "key", "pending", int32(0), time.Now(), nil, time.Now(), time.Now())
}

func platformEmailChangeTokenColumns() []string {
	return []string{"id", "platform_user_id", "current_email", "new_email", "current_email_token_hash", "new_email_token_hash", "current_email_confirmed_at", "new_email_confirmed_at", "expires_at", "completed_at", "created_at", "matched_target"}
}

func TestPlatformAuthLoginSuccess(t *testing.T) {
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
			AddRow(userID, "PLATUSER001", "platform@example.com", string(passwordHashBytes), "Platform User", "active", now, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testListPlatformUserRolesQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(rolePlatformOperator))

	resp, err := server.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    "platform@example.com",
		Password: password,
	}))
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if resp.Msg.User == nil || resp.Msg.User.Role != rolePlatformOperator {
		t.Fatalf("user.role = %v, want %s", resp.Msg.User, rolePlatformOperator)
	}
	if resp.Msg.AccessToken == nil || resp.Msg.AccessToken.Token == "" {
		t.Fatalf("session is missing token")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthLoginDatabaseErrorIsHidden(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByEmailQuery)).
		WithArgs("platform@example.com").
		WillReturnError(errors.New(`pq: relation "platform_users" does not exist`))

	_, err := server.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    "platform@example.com",
		Password: "secret-password",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("Login code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthRequestPasswordResetSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByEmailQuery)).
		WithArgs("platform@example.com").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now, int32(1)))
	// The token and the mail that carries it are written together, so a request
	// that cannot be announced leaves no usable token behind.
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(testDeletePlatformUserPasswordResetTokens)).
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformUserPasswordResetToken)).
		WithArgs(sqlmock.AnyArg(), userID, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(platformPasswordResetTokenColumns()).
			AddRow(uuid.Must(uuid.NewV7()), userID, "token-hash", now.Add(time.Hour), nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(testInsertOutboxEventQuery)).
		WithArgs(sqlmock.AnyArg(), nil, outbox.EventTypePlatformPasswordResetEmail, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(newOutboxEventRow(outbox.EventTypePlatformPasswordResetEmail))
	mock.ExpectCommit()

	resp, err := server.RequestPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
		Email: "platform@example.com",
	}))
	if err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("requested = false, want true")
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
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now, int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(testUpdatePlatformUserPasswordHashByID)).
		WithArgs(userID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "updated-hash", "Platform User", "active", now, int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(testBumpPlatformUserCredentialsVersionQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "updated-hash", "Platform User", "active", now, int32(2)))
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
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	passwordHashBytes, err := bcrypt.GenerateFromPassword([]byte("current-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("GenerateFromPassword: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByPublicIDQuery)).
		WithArgs("PLATUSER001").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", string(passwordHashBytes), "Platform User", "active", now, int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(testListPlatformUserRolesQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(rolePlatformOperator))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByEmailQuery)).
		WithArgs("next@example.com").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(testDeletePlatformEmailChangeTokens)).
		WithArgs(userID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformEmailChangeToken)).
		WithArgs(sqlmock.AnyArg(), userID, "platform@example.com", "next@example.com", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "platform_user_id", "current_email", "new_email", "current_email_token_hash", "new_email_token_hash", "current_email_confirmed_at", "new_email_confirmed_at", "expires_at", "completed_at", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), userID, "platform@example.com", "next@example.com", "h1", "h2", nil, nil, now.Add(time.Hour), nil, now))
	// One event per address to confirm, so a delivery failure to one side is
	// retried without resending the other.
	for range 2 {
		mock.ExpectQuery(regexp.QuoteMeta(testInsertOutboxEventQuery)).
			WithArgs(sqlmock.AnyArg(), nil, outbox.EventTypePlatformEmailChangeConfirmationEmail, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
			WillReturnRows(newOutboxEventRow(outbox.EventTypePlatformEmailChangeConfirmationEmail))
	}
	mock.ExpectCommit()

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
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	tokenID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformEmailChangeTokenByHash)).
		WithArgs(auth.HashToken("confirm-token")).
		WillReturnRows(sqlmock.NewRows(platformEmailChangeTokenColumns()).
			AddRow(tokenID, userID, "platform@example.com", "next@example.com", "h1", auth.HashToken("confirm-token"), now.Add(-10*time.Minute), nil, now.Add(time.Hour), nil, now, "new_email"))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now, int32(1)))
	mock.ExpectExec(regexp.QuoteMeta(testMarkPlatformEmailChangeNewConfirmed)).
		WithArgs(tokenID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// The stored address, the completion, and the notice announcing both go in
	// together: the previous address is never told about a change that failed.
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testUpdatePlatformUserEmailByID)).
		WithArgs(userID, "next@example.com").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "next@example.com", "hashed", "Platform User", "active", now, int32(1)))
	mock.ExpectExec(regexp.QuoteMeta(testMarkPlatformEmailChangeCompleted)).
		WithArgs(tokenID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testInsertOutboxEventQuery)).
		WithArgs(sqlmock.AnyArg(), nil, outbox.EventTypePlatformEmailChangedNoticeEmail, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(newOutboxEventRow(outbox.EventTypePlatformEmailChangedNoticeEmail))
	mock.ExpectCommit()

	resp, err := server.ConfirmEmailChange(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmEmailChangeRequest{Token: "confirm-token"}))
	if err != nil {
		t.Fatalf("ConfirmEmailChange: %v", err)
	}
	if !resp.Msg.Confirmed || !resp.Msg.Changed {
		t.Fatalf("response = %+v, want confirmed=true changed=true", resp.Msg)
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
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now, int32(1)))
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

func TestPlatformAuthLogoutRevokes(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	_, err := server.Logout(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.PlatformAuthServiceLogoutRequest{}))
	if err != nil {
		t.Fatalf("Logout: %v", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestPlatformAuthLogoutMissingTokenClearsCookie(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	_, err := server.Logout(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLogoutRequest{}))
	if err != nil {
		t.Fatalf("Logout: %v", err)
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

func TestPlatformAuthLoginInvalidCredentials(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByEmailQuery)).
		WithArgs("platform@example.com").
		WillReturnError(sql.ErrNoRows)

	_, err := server.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    "platform@example.com",
		Password: "wrong-password",
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login code = %v, want unauthenticated", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}
