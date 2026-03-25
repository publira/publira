package platformapi

import (
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
)

const (
	testCreatePlatformSessionQuery = "-- name: CreatePlatformSession :one\n"
	testRevokePlatformSessionQuery = "-- name: RevokePlatformSession :exec\n"
)

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
