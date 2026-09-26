package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// The forms that answer a registered address exactly as they answer a free one
// make a single write before answering, the request the worker resolves, and
// never ask whether the address has an account. sqlmock refuses any statement
// it was not told to expect, so these cases fail the moment a handler looks the
// address up again — which is what would let the time it takes tell the two
// apart.

func newRequestFormClient(t *testing.T) (publirav1connect.AuthServiceClient, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	server := httptest.NewServer(handlerFromServer(
		newAPIServer(db, dbmodels.New(db), nil, testutil.TokenManager(), nil, slog.Default(), openReaderGuards(), openMailGuard()),
	))
	t.Cleanup(server.Close)
	return publirav1connect.NewAuthServiceClient(server.Client(), server.URL), mock
}

func expectReaderAuthRequest(mock sqlmock.Sqlmock, tenantID uuid.UUID, eventType string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), eventType, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "event_type", "payload", "idempotency_key", "status", "attempts", "available_at", "last_error", "created_at", "updated_at", "progress_cursor",
		}).AddRow(
			uuid.Must(uuid.NewV7()), uuid.NullUUID{UUID: tenantID, Valid: true}, eventType, []byte("{}"),
			eventType+":request", outbox.StatusPending, int32(0), time.Now(), sql.NullString{}, time.Now(), time.Now(), sql.NullString{},
		))
}

func TestCreateUserRecordsTheRequestWithoutLookingUpTheAddress(t *testing.T) {
	client, mock := newRequestFormClient(t)
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantLegalPages)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectReaderAuthRequest(mock, tenantID, outbox.EventTypeReaderSignupRequest)

	resp, err := client.CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Name:     "Newcomer",
		Email:    "newcomer@tenant.example",
		Password: "newcomer-password",
	}))
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if !resp.Msg.Accepted {
		t.Fatal("accepted = false, want true")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequestPasswordResetRecordsTheRequestWithoutLookingUpTheAddress(t *testing.T) {
	client, mock := newRequestFormClient(t)
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	expectReaderAuthRequest(mock, tenantID, outbox.EventTypeReaderPasswordResetRequest)

	resp, err := client.RequestPasswordReset(context.Background(), connect.NewRequest(&publirav1.RequestPasswordResetRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Email:  "member@tenant.example",
	}))
	if err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("requested = false, want true")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequestEmailVerificationRecordsTheRequestWithoutLookingUpTheAddress(t *testing.T) {
	client, mock := newRequestFormClient(t)
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	expectReaderAuthRequest(mock, tenantID, outbox.EventTypeReaderEmailVerificationRequest)

	resp, err := client.RequestEmailVerification(context.Background(), connect.NewRequest(&publirav1.RequestEmailVerificationRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Email:  "pending@tenant.example",
	}))
	if err != nil {
		t.Fatalf("RequestEmailVerification: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("requested = false, want true")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
