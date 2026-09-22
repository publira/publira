package adminapi

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func royaltyConfigColumns() []string {
	return []string{"tenant_id", "close_mode", "auto_close_day", "automatic_since", "updated_at"}
}

func addRoyaltyConfigRow(rows *sqlmock.Rows, tenantID uuid.UUID, mode string, day sql.NullInt32, automaticSince sql.NullTime, now time.Time) *sqlmock.Rows {
	return rows.AddRow(tenantID, mode, day, automaticSince, now)
}

func newRoyaltyConfigClient(t *testing.T) (publiraadminv1connect.AdminRoyaltyServiceClient, sqlmock.Sqlmock, string, uuid.UUID) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	handler, err := newTestHandler(db, dbmodels.New(db), &testStorageProvider{}, nil, newAdminTestEncryptor(t), nil)
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	tenantID := uuid.Must(uuid.NewV7())
	return publiraadminv1connect.NewAdminRoyaltyServiceClient(server.Client(), server.URL), mock, issueTestAdminToken(tenantID.String(), testUserPublicID, "editor"), tenantID
}

func royaltyConfigRequest(tenantID uuid.UUID, token string, message *publiraadminv1.GetRoyaltyConfigRequest) *connect.Request[publiraadminv1.GetRoyaltyConfigRequest] {
	request := connect.NewRequest(message)
	request.Header().Set("Authorization", "Bearer "+token)
	return request
}

func expectRoyaltyConfigAdmin(mock sqlmock.Sqlmock, tenantID uuid.UUID, token string, now time.Time) uuid.UUID {
	userID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, token, now, "tenant_admin")
	return userID
}

func TestGetRoyaltyConfigDefaultsToManualWhenMissing(t *testing.T) {
	client, mock, token, tenantID := newRoyaltyConfigClient(t)
	now := time.Now()
	expectRoyaltyConfigAdmin(mock, tenantID, token, now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantRoyaltyConfigByTenantID)).WithArgs(tenantID).WillReturnError(sql.ErrNoRows)

	response, err := client.GetRoyaltyConfig(context.Background(), royaltyConfigRequest(tenantID, token, &publiraadminv1.GetRoyaltyConfigRequest{Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()}}))
	if err != nil {
		t.Fatalf("GetRoyaltyConfig: %v", err)
	}
	if response.Msg.Config.CloseMode != publiraadminv1.RoyaltyCloseMode_ROYALTY_CLOSE_MODE_MANUAL || response.Msg.Config.AutoCloseDay != nil {
		t.Fatalf("config = %+v, want manual without a day", response.Msg.Config)
	}
	assertExpectations(t, mock)
}

func TestUpdateRoyaltyConfigRejectsAutomaticWithoutDay(t *testing.T) {
	client, mock, token, tenantID := newRoyaltyConfigClient(t)
	now := time.Now()
	expectRoyaltyConfigAdmin(mock, tenantID, token, now)
	request := connect.NewRequest(&publiraadminv1.UpdateRoyaltyConfigRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		CloseMode: publiraadminv1.RoyaltyCloseMode_ROYALTY_CLOSE_MODE_AUTOMATIC,
	})
	request.Header().Set("Authorization", "Bearer "+token)
	_, err := client.UpdateRoyaltyConfig(context.Background(), request)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateRoyaltyConfig code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestUpdateRoyaltyConfigRejectsManualWithDay(t *testing.T) {
	client, mock, token, tenantID := newRoyaltyConfigClient(t)
	now := time.Now()
	expectRoyaltyConfigAdmin(mock, tenantID, token, now)
	day := int32(5)
	request := connect.NewRequest(&publiraadminv1.UpdateRoyaltyConfigRequest{
		Tenant:       &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		CloseMode:    publiraadminv1.RoyaltyCloseMode_ROYALTY_CLOSE_MODE_MANUAL,
		AutoCloseDay: &day,
	})
	request.Header().Set("Authorization", "Bearer "+token)
	_, err := client.UpdateRoyaltyConfig(context.Background(), request)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateRoyaltyConfig code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestUpdateRoyaltyConfigRejectsOutOfRangeDay(t *testing.T) {
	client, mock, token, tenantID := newRoyaltyConfigClient(t)
	now := time.Now()
	expectRoyaltyConfigAdmin(mock, tenantID, token, now)
	day := int32(31)
	request := connect.NewRequest(&publiraadminv1.UpdateRoyaltyConfigRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()}, CloseMode: publiraadminv1.RoyaltyCloseMode_ROYALTY_CLOSE_MODE_AUTOMATIC, AutoCloseDay: &day,
	})
	request.Header().Set("Authorization", "Bearer "+token)
	_, err := client.UpdateRoyaltyConfig(context.Background(), request)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateRoyaltyConfig code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestUpdateRoyaltyConfigReturnsAutomaticSince(t *testing.T) {
	client, mock, token, tenantID := newRoyaltyConfigClient(t)
	now := time.Now().UTC().Truncate(time.Second)
	expectRoyaltyConfigAdmin(mock, tenantID, token, now)
	day := int32(5)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertTenantRoyaltyConfig)).WithArgs(tenantID, royaltyCloseModeAuto, sql.NullInt32{Int32: day, Valid: true}).WillReturnRows(addRoyaltyConfigRow(
		sqlmock.NewRows(royaltyConfigColumns()), tenantID, royaltyCloseModeAuto, sql.NullInt32{Int32: day, Valid: true}, sql.NullTime{Time: now, Valid: true}, now,
	))
	expectAdminAuditLogInsert(mock)
	request := connect.NewRequest(&publiraadminv1.UpdateRoyaltyConfigRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()}, CloseMode: publiraadminv1.RoyaltyCloseMode_ROYALTY_CLOSE_MODE_AUTOMATIC, AutoCloseDay: &day,
	})
	request.Header().Set("Authorization", "Bearer "+token)
	response, err := client.UpdateRoyaltyConfig(context.Background(), request)
	if err != nil {
		t.Fatalf("UpdateRoyaltyConfig: %v", err)
	}
	if response.Msg.Config.AutomaticSince != now.Format(time.RFC3339) || response.Msg.Config.GetAutoCloseDay() != day {
		t.Fatalf("config = %+v, want automatic since %s and day %d", response.Msg.Config, now.Format(time.RFC3339), day)
	}
	assertExpectations(t, mock)
}
