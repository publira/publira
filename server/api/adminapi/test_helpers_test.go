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
	getTenantByIDQuery                                       = "-- name: GetTenantByID :one\nSELECT id, public_id, domain, name, default_reading_period_hours, created_at, status, admin_domain, timezone\nFROM tenants\nWHERE id = $1\nLIMIT 1\n"
	getUserByPublicIDForTenantQuery                          = "-- name: GetUserByPublicIDForTenant :one\n"
	getLabelByPublicIDForTenantQuery                         = "-- name: GetLabelByPublicIDForTenant :one\n"
	listAuditLogsByTenantAscQuery                            = "-- name: ListAuditLogsByTenantAsc :many\n"
	listAuditLogsByTenantDescQuery                           = "-- name: ListAuditLogsByTenantDesc :many\n"
	getUserByIDQuery                                         = "-- name: GetUserByID :one\n"
	listTenantRolesByUserAndTenantQuery                      = "-- name: ListTenantUserRoles :many\n"
	getPlatformSMTPConfigQuery                               = "-- name: GetPlatformSMTPConfig :one\n"
	getTenantSMTPConfigByTenantIDQuery                       = "-- name: GetTenantSMTPConfigByTenantID :one\n"
	upsertTenantSMTPConfigQuery                              = "-- name: UpsertTenantSMTPConfig :one\n"
	getTenantThemeByTenantIDQuery                            = "-- name: GetTenantThemeByTenantID :one\n"
	upsertTenantThemeQuery                                   = "-- name: UpsertTenantTheme :one\n"
	updateTenantTimezoneQuery                                = "-- name: UpdateTenantTimezone :one\n"
	listAccessTicketsForTenantAscQuery                       = "-- name: ListAccessTicketsForTenantAsc :many\n"
	listAccessTicketsForTenantDescQuery                      = "-- name: ListAccessTicketsForTenantDesc :many\n"
	listSeriesByTenantAscQuery                               = "-- name: ListSeriesByTenantAsc :many\n"
	listSeriesByTenantDescQuery                              = "-- name: ListSeriesByTenantDesc :many\n"
	getSeriesByPublicIDForTenantQuery                        = "-- name: GetSeriesByPublicIDForTenant :one\n"
	lockSeriesByPublicIDForTenantQuery                       = "-- name: LockSeriesByPublicIDForTenant :one\n"
	updateSeriesBaseQuery                                    = "-- name: UpdateSeriesBase :exec\n"
	updateSeriesPublicationQuery                             = "-- name: UpdateSeriesPublication :exec\n"
	listEpisodesBySeriesForTenantQuery                       = "-- name: ListEpisodesBySeriesForTenant :many\n"
	listEpisodesBySeriesForTenantAscQuery                    = "-- name: ListEpisodesBySeriesForTenantAsc :many\n"
	listEpisodesBySeriesForTenantDescQuery                   = "-- name: ListEpisodesBySeriesForTenantDesc :many\n"
	updateEpisodeOrderIndexByPublicIDForTenantAndSeriesQuery = "-- name: UpdateEpisodeOrderIndexByPublicIDForTenantAndSeries :exec\n"
	getMaxEpisodeOrderIndexBySeriesForTenantQuery            = "-- name: GetMaxEpisodeOrderIndexBySeriesForTenant :one\n"
	getEpisodeByPublicIDForTenantQuery                       = "-- name: GetEpisodeByPublicIDForTenant :one\n"
	getEpisodeByPublicIDForTenantAndSeriesQuery              = "-- name: GetEpisodeByPublicIDForTenantAndSeries :one\n"
	getMaxEpisodeImageDisplayOrderByEpisodeIDQuery           = "-- name: GetMaxEpisodeImageDisplayOrderByEpisodeID :one\n"
	updateEpisodePublishScheduleByPublicIDForTenantQuery     = "-- name: UpdateEpisodePublishScheduleByPublicIDForTenant :exec\n"
	testUserPublicID                                         = "USER001"
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
	server := httptest.NewServer(NewHandler(db, dbmodels.New(db), &testStorageProvider{}, slog.Default(), nil, nil))
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

func tenantColumns() []string {
	return []string{"id", "public_id", "domain", "name", "default_reading_period_hours", "created_at", "status", "admin_domain", "timezone"}
}

func expectTenantLookup(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, now time.Time) {
	expectTenantLookupWithTimezone(mock, tenantID, publicID, now, "Asia/Tokyo")
}

func expectTenantLookupWithTimezone(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, now time.Time, timezone string) {
	mock.ExpectQuery(regexp.QuoteMeta(getTenantByIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, publicID, "tenant.example", "Tenant", nil, now, "active", nil, timezone))
}

// issueTestAdminToken creates a signed JWT for admin API tests.
// tenantID is the tenant primary key (UUID string).
func issueTestAdminToken(tenantID, userPublicID, role string) string {
	token, _, err := auth.MustTokenManagerFromEnv().Issue(
		userPublicID,
		auth.AudienceAdmin,
		tenantID,
		role,
		1,
		time.Now(),
	)
	if err != nil {
		panic(err)
	}
	return token
}

func expectActiveSessionLookup(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, _ string, now time.Time) {
	expectActiveSessionLookupWithRole(mock, tenantID, userID, "", now, "editor")
}

func expectActiveSessionLookupWithRole(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, _ string, now time.Time, role string) {
	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDForTenantQuery)).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, testUserPublicID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}).
			AddRow(userID, testUserPublicID, "User", "user@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at", "credentials_version"}).
			AddRow(userID, testUserPublicID, "user@example.com", "hashed", "User", now, "active", tenantID, nil, int32(1)))

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

func expectPublicIDAttempt(mock sqlmock.Sqlmock) {
	mock.ExpectExec("^SAVEPOINT publira_public_id$").WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectPublicIDAttemptReleased(mock sqlmock.Sqlmock) {
	mock.ExpectExec("^RELEASE SAVEPOINT publira_public_id$").WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectPublicIDAttemptRolledBack(mock sqlmock.Sqlmock) {
	mock.ExpectExec("^ROLLBACK TO SAVEPOINT publira_public_id$").WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectCreateSeriesBaseInsert(mock sqlmock.Sqlmock, seriesID, tenantID uuid.UUID, title, publicID string, now time.Time, labelID uuid.NullUUID) {
	expectPublicIDAttempt(mock)
	mock.ExpectQuery("INSERT INTO series").
		WithArgs(sqlmock.AnyArg(), tenantID, labelID, sqlmock.AnyArg(), title).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "label_id", "public_id", "title", "created_at", "is_published", "published_at", "updated_at", "eye_catch_image_id"}).
			AddRow(seriesID, tenantID, labelID, publicID, title, now, false, nil, now, nil))
	expectPublicIDAttemptReleased(mock)
}

func expectLockSeriesByPublicID(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, seriesID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(lockSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, publicID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(seriesID))
}

func expectListEpisodesBySeries(mock sqlmock.Sqlmock, tenantID uuid.UUID, seriesPublicID string, rows *sqlmock.Rows) {
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodesBySeriesForTenantQuery)).
		WithArgs(tenantID, seriesPublicID).
		WillReturnRows(rows)
}

func expectUpdateEpisodeOrderIndex(mock sqlmock.Sqlmock, tenantID uuid.UUID, seriesPublicID, episodePublicID string, orderIndex int32) {
	mock.ExpectExec(regexp.QuoteMeta(updateEpisodeOrderIndexByPublicIDForTenantAndSeriesQuery)).
		WithArgs(tenantID, seriesPublicID, episodePublicID, orderIndex).
		WillReturnResult(sqlmock.NewResult(0, 1))
}

func expectCreateEpisodeBaseInsert(mock sqlmock.Sqlmock, seriesID, episodeID, tenantID uuid.UUID, title string, orderIndex int32, now time.Time, publicID string) {
	expectPublicIDAttempt(mock)
	mock.ExpectQuery("INSERT INTO episodes").
		WithArgs(sqlmock.AnyArg(), seriesID, sqlmock.AnyArg(), title, orderIndex, tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "series_id", "public_id", "title", "order_index", "created_at", "tenant_id"}).
			AddRow(episodeID, seriesID, publicID, title, orderIndex, now, tenantID))
	expectPublicIDAttemptReleased(mock)
}
