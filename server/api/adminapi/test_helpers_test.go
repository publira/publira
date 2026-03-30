package adminapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/storage"
)

const (
	getTenantByPublicIDQuery                             = "-- name: GetTenantByPublicID :one\n"
	getSessionByTokenHashForTenantQuery                  = "-- name: GetSessionByTokenHashForTenant :one\n"
	getLabelByPublicIDForTenantQuery                     = "-- name: GetLabelByPublicIDForTenant :one\n"
	listAuditLogsByTenantQuery                           = "-- name: ListAuditLogsByTenant :many\n"
	getUserByIDQuery                                     = "-- name: GetUserByID :one\n"
	listTenantRolesByUserAndTenantQuery                  = "-- name: ListTenantUserRoles :many\n"
	getPlatformSMTPConfigQuery                           = "-- name: GetPlatformSMTPConfig :one\n"
	getTenantSMTPConfigByTenantIDQuery                   = "-- name: GetTenantSMTPConfigByTenantID :one\n"
	upsertTenantSMTPConfigQuery                          = "-- name: UpsertTenantSMTPConfig :one\n"
	listSeriesByTenantQuery                              = "-- name: ListSeriesByTenant :many\n"
	getSeriesByPublicIDForTenantQuery                    = "-- name: GetSeriesByPublicIDForTenant :one\n"
	updateSeriesBaseQuery                                = "-- name: UpdateSeriesBase :exec\n"
	updateSeriesPublicationQuery                         = "-- name: UpdateSeriesPublication :exec\n"
	getEpisodeByPublicIDForTenantQuery                   = "-- name: GetEpisodeByPublicIDForTenant :one\n"
	getEpisodeByPublicIDForTenantAndSeriesQuery          = "-- name: GetEpisodeByPublicIDForTenantAndSeries :one\n"
	getMaxEpisodeImageDisplayOrderByEpisodeIDQuery       = "-- name: GetMaxEpisodeImageDisplayOrderByEpisodeID :one\n"
	updateEpisodePublishScheduleByPublicIDForTenantQuery = "-- name: UpdateEpisodePublishScheduleByPublicIDForTenant :exec\n"
)

func newTestAdminServer(t *testing.T) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	server := httptest.NewServer(NewHandler(dbmodels.New(db), &testStorageProvider{}, slog.Default(), nil, nil))
	t.Cleanup(server.Close)
	return server, mock
}

type testStorageProvider struct{}

func (p *testStorageProvider) Upload(_ context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	return storage.UploadResult{
		Provider:  "local",
		ObjectKey: req.ObjectKey,
		URL:       "local://" + req.ObjectKey,
		SizeBytes: int64(len(req.Data)),
	}, nil
}

var oneByOnePNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
}

var oneByOneJPEG = []byte{
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
	0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
	0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
	0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
	0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c,
	0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
	0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d,
	0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
	0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
	0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
	0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34,
	0x32, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01,
	0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11,
	0x01, 0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x14,
	0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08,
	0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08,
	0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf,
	0x20, 0xff, 0xd9,
}

func expectTenantLookup(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs(publicID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "domain", "name", "default_reading_period_hours", "created_at", "status", "admin_domain"}).
			AddRow(tenantID, publicID, "tenant.example", "Tenant", nil, now, "active", nil))
}

func expectActiveSessionLookup(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, sessionToken string, now time.Time) {
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")
}

func expectActiveSessionLookupWithRole(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, sessionToken string, now time.Time, role string) {
	mock.ExpectQuery(regexp.QuoteMeta(getSessionByTokenHashForTenantQuery)).
		WithArgs(tenantID, auth.HashToken(sessionToken)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, userID, auth.HashToken(sessionToken), now.Add(time.Hour), nil, now))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at"}).
			AddRow(userID, "USER001", "user@example.com", "hashed", "User", now, "active", tenantID, nil))

	mock.ExpectQuery(regexp.QuoteMeta(listTenantRolesByUserAndTenantQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(role))
}

func assertExpectations(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func expectAdminAuditLogInsert(mock sqlmock.Sqlmock) {
	mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(0, 1))
}
