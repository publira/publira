package platformapi

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
)

const testCountPlatformUsersQuery = "-- name: CountPlatformUsers :one\n"

func TestCheckSetupStatusNotCompleted(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(testCountPlatformUsersQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(0)))

	resp, err := server.CheckSetupStatus(context.Background(), connect.NewRequest(&publirasplatformv1.CheckSetupStatusRequest{}))
	if err != nil {
		t.Fatalf("CheckSetupStatus: %v", err)
	}
	if resp.Msg.SetupCompleted {
		t.Fatalf("setup_completed = true, want false")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestCheckSetupStatusCompleted(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(testCountPlatformUsersQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(1)))

	resp, err := server.CheckSetupStatus(context.Background(), connect.NewRequest(&publirasplatformv1.CheckSetupStatusRequest{}))
	if err != nil {
		t.Fatalf("CheckSetupStatus: %v", err)
	}
	if !resp.Msg.SetupCompleted {
		t.Fatalf("setup_completed = false, want true")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestCheckSetupStatusDatabaseErrorIsHidden(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(testCountPlatformUsersQuery)).
		WillReturnError(errors.New(`pq: relation "platform_users" does not exist`))

	_, err := server.CheckSetupStatus(context.Background(), connect.NewRequest(&publirasplatformv1.CheckSetupStatusRequest{}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("CheckSetupStatus code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestCheckSetupStatusPreservesContextCanceled(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(testCountPlatformUsersQuery)).
		WillReturnError(context.Canceled)

	_, err := server.CheckSetupStatus(context.Background(), connect.NewRequest(&publirasplatformv1.CheckSetupStatusRequest{}))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("CheckSetupStatus error = %v, want context.Canceled", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestCreateInitialUserSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testCountPlatformUsersQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(0)))
	mock.ExpectBegin()
	expectPublicIDAttempt(mock)
	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformUserQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "admin@example.com", sqlmock.AnyArg(), "Admin User").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "ADMINUSER01", "admin@example.com", "hash", "Admin User", "active", now, int32(1)))
	expectPublicIDAttemptReleased(mock)
	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "platform_super_admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "role", "created_at", "platform_user_id"}).
			AddRow(uuid.Must(uuid.NewV7()), "platform_super_admin", now, userID))
	mock.ExpectQuery(regexp.QuoteMeta(testUpsertPlatformDefaultLocaleQuery)).
		WithArgs("en").
		WillReturnRows(sqlmock.NewRows(platformConfigColumns()).AddRow(true, "Asia/Tokyo", "en", now, now))
	mock.ExpectCommit()

	_, err := server.CreateInitialUser(context.Background(), connect.NewRequest(&publirasplatformv1.CreateInitialUserRequest{
		Name:          "Admin User",
		Email:         "admin@example.com",
		Password:      "secure-password-123",
		DefaultLocale: "en",
	}))
	if err != nil {
		t.Fatalf("CreateInitialUser: %v", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestCreateInitialUserAlreadySetup(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(testCountPlatformUsersQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(1)))

	_, err := server.CreateInitialUser(context.Background(), connect.NewRequest(&publirasplatformv1.CreateInitialUserRequest{
		Name:          "Admin User",
		Email:         "admin@example.com",
		Password:      "secure-password-123",
		DefaultLocale: "ja",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateInitialUser code = %v, want already_exists", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestCreateInitialUserInvalidInput(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	cases := []struct {
		name string
		req  func() *publirasplatformv1.CreateInitialUserRequest
	}{
		{"empty_name", func() *publirasplatformv1.CreateInitialUserRequest {
			return &publirasplatformv1.CreateInitialUserRequest{Name: "", Email: "a@b.com", Password: "pass", DefaultLocale: "ja"}
		}},
		{"empty_email", func() *publirasplatformv1.CreateInitialUserRequest {
			return &publirasplatformv1.CreateInitialUserRequest{Name: "Name", Email: "", Password: "pass", DefaultLocale: "ja"}
		}},
		{"empty_password", func() *publirasplatformv1.CreateInitialUserRequest {
			return &publirasplatformv1.CreateInitialUserRequest{Name: "Name", Email: "a@b.com", Password: "", DefaultLocale: "ja"}
		}},
		{"invalid_email", func() *publirasplatformv1.CreateInitialUserRequest {
			return &publirasplatformv1.CreateInitialUserRequest{Name: "Name", Email: "not-an-email", Password: "pass", DefaultLocale: "ja"}
		}},
		{"empty_locale", func() *publirasplatformv1.CreateInitialUserRequest {
			return &publirasplatformv1.CreateInitialUserRequest{Name: "Name", Email: "a@b.com", Password: "pass"}
		}},
		{"blank_locale", func() *publirasplatformv1.CreateInitialUserRequest {
			return &publirasplatformv1.CreateInitialUserRequest{Name: "Name", Email: "a@b.com", Password: "pass", DefaultLocale: "   "}
		}},
		{"unsupported_locale", func() *publirasplatformv1.CreateInitialUserRequest {
			return &publirasplatformv1.CreateInitialUserRequest{Name: "Name", Email: "a@b.com", Password: "pass", DefaultLocale: "fr"}
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := server.CreateInitialUser(context.Background(), connect.NewRequest(tc.req()))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("CreateInitialUser code = %v, want invalid_argument", connect.CodeOf(err))
			}
		})
	}
	assertOperatorHandlerExpectations(t, mock)
}
