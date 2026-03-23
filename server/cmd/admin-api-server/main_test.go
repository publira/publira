package main

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

	"github.com/publira/publira/server/api/adminapi"
	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/storage"
)

const (
	getTenantByPublicIDQuery                             = "-- name: GetTenantByPublicID :one\nSELECT id, public_id, domain, name, default_reading_period_hours, created_at, status, admin_domain\nFROM tenants\nWHERE public_id = $1\nLIMIT 1\n"
	getSessionByTokenHashForTenantQuery                  = "-- name: GetSessionByTokenHashForTenant :one\nSELECT id, current_tenant_id, user_id, token_hash, expires_at, revoked_at, created_at\nFROM sessions\nWHERE current_tenant_id = $1\n    AND token_hash = $2\nLIMIT 1\n"
	getLabelByPublicIDForTenantQuery                     = "-- name: GetLabelByPublicIDForTenant :one\nSELECT id, tenant_id, public_id, name, created_at\nFROM labels\nWHERE tenant_id = $1\n    AND public_id = $2\nLIMIT 1\n"
	getUserByIDQuery                                     = "-- name: GetUserByID :one\nSELECT id, public_id, email, password_hash, name, created_at, status\nFROM users\nWHERE id = $1\n"
	listTenantRolesByUserAndTenantQuery                 = "-- name: ListTenantRolesByUserAndTenant :many\nSELECT tmr.role\nFROM tenant_memberships tm\n    JOIN tenant_member_roles tmr ON tmr.membership_id = tm.id\nWHERE tm.user_id = $1\n    AND tm.tenant_id = $2\n    AND tm.status = 'active'\nORDER BY tmr.role\n"
	listSeriesByTenantQuery                              = "-- name: ListSeriesByTenant :many\nSELECT s.id,\n    s.public_id,\n    s.title,\n    sl.synopsis,\n    sl.reading_period_hours,\n    s.is_published,\n    s.published_at\nFROM series s\n    LEFT JOIN series_listings sl ON sl.series_id = s.id\nWHERE s.tenant_id = $1\nORDER BY s.created_at DESC\nLIMIT $2 OFFSET $3\n"
	getSeriesByPublicIDForTenantQuery                    = "-- name: GetSeriesByPublicIDForTenant :one\nSELECT s.id,\n    s.public_id,\n    s.title,\n    sl.synopsis,\n    sl.reading_period_hours,\n    s.is_published,\n    s.published_at\nFROM series s\n    LEFT JOIN series_listings sl ON sl.series_id = s.id\nWHERE s.tenant_id = $1\n    AND s.public_id = $2\nLIMIT 1\n"
	updateSeriesBaseQuery                                = "-- name: UpdateSeriesBase :exec\nUPDATE series\nSET title = $2,\n    label_id = $3,\n    updated_at = NOW()\nWHERE id = $1\n"
	updateSeriesPublicationQuery                         = "-- name: UpdateSeriesPublication :exec\nUPDATE series\nSET is_published = $2,\n    published_at = CASE\n        WHEN $2 THEN COALESCE(published_at, NOW())\n        ELSE NULL\n    END,\n    updated_at = NOW()\nWHERE id = $1\n"
	getEpisodeByPublicIDForTenantQuery                   = "-- name: GetEpisodeByPublicIDForTenant :one\nSELECT e.id,\n    e.public_id,\n    e.title,\n    e.order_index,\n    el.price,\n    el.reading_period_hours,\n    el.status,\n    el.scheduled_at,\n    el.published_at\nFROM episodes e\n    JOIN series s ON s.id = e.series_id\n    JOIN episode_listings el ON el.episode_id = e.id\nWHERE s.tenant_id = $1\n    AND e.public_id = $2\nLIMIT 1\n"
	updateEpisodePublishScheduleByPublicIDForTenantQuery = "-- name: UpdateEpisodePublishScheduleByPublicIDForTenant :exec\nUPDATE episode_listings el\nSET status = CASE\n        WHEN $3 IS NULL THEN 'draft'\n        ELSE 'scheduled'\n    END,\n    scheduled_at = $3,\n    published_at = CASE\n        WHEN $3 IS NULL THEN NULL\n        ELSE el.published_at\n    END\nFROM episodes e\n    JOIN series s ON s.id = e.series_id\nWHERE el.episode_id = e.id\n    AND s.tenant_id = $1\n    AND e.public_id = $2\n"
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
	server := httptest.NewServer(adminapi.NewHandler(dbmodels.New(db), &testStorageProvider{}, slog.Default()))
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
	mock.ExpectQuery(regexp.QuoteMeta(getSessionByTokenHashForTenantQuery)).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, auth.HashToken(sessionToken)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "current_tenant_id", "user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, userID, auth.HashToken(sessionToken), now.Add(time.Hour), nil, now))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status"}).
			AddRow(userID, "USER001", "user@example.com", "hashed", "User", now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(listTenantRolesByUserAndTenantQuery)).
		WithArgs(userID, tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("editor"))
}

func assertExpectations(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestAdminSeriesRequiresSession(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListSeries(context.Background(), connect.NewRequest(&publiraadminv1.ListSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListSeries error code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	if err == nil || err.Error() != "unauthenticated: invalid session" {
		t.Fatalf("ListSeries error = %v, want unauthenticated invalid session", err)
	}
	assertExpectations(t, mock)
}

func TestAdminSeriesAllowsValidSession(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now()
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(listSeriesByTenantQuery)).
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "SERIES001", "Series Title", "Synopsis", nil, true, now))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ListSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)
	resp, err := client.ListSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if len(resp.Msg.Series) != 1 {
		t.Fatalf("series count = %d, want 1", len(resp.Msg.Series))
	}
	if resp.Msg.Series[0].PublicId != "SERIES001" {
		t.Fatalf("series public_id = %q, want SERIES001", resp.Msg.Series[0].PublicId)
	}
	assertExpectations(t, mock)
}

func TestCreateSeriesRequiresTitle(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now()
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		Title:  "   ",
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	_, err := client.CreateSeries(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}

func TestCreateSeriesSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
		WithArgs(tenantID, "LABEL001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, "LABEL001", "Weekly", now))

	mock.ExpectQuery("INSERT INTO series").
		WithArgs(sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), sqlmock.AnyArg(), "New Series").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "label_id", "public_id", "title", "created_at", "is_published", "published_at", "updated_at"}).
			AddRow(seriesID, tenantID, uuid.Must(uuid.NewV7()), "SERIESNEW001", "New Series", now, false, nil, now))

	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(seriesID, sql.NullString{String: "Synopsis", Valid: true}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "Synopsis", nil, nil, nil))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, true).
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant:        &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		Title:         "New Series",
		Synopsis:      "Synopsis",
		LabelPublicId: "LABEL001",
		IsPublished:   true,
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	resp, err := client.CreateSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if resp.Msg.Series == nil {
		t.Fatalf("series is nil")
	}
	if resp.Msg.Series.Title != "New Series" {
		t.Fatalf("series title = %q, want New Series", resp.Msg.Series.Title)
	}
	assertExpectations(t, mock)
}

func TestUpdateSeriesRequiresTitle(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now()
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateSeriesRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId: "SERIES001",
		Title:    "\t",
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	_, err := client.UpdateSeries(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateSeries code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}

func TestUpdateSeriesSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "SERIES001", "Before", "Old synopsis", nil, true, now))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesBaseQuery)).
		WithArgs(seriesID, "After", uuid.NullUUID{}).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(seriesID, sql.NullString{String: "New synopsis", Valid: true}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "New synopsis", nil, nil, nil))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, true).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "SERIES001", "After", "New synopsis", nil, true, now))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateSeriesRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId:    "SERIES001",
		Title:       "After",
		Synopsis:    "New synopsis",
		IsPublished: true,
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	resp, err := client.UpdateSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if resp.Msg.Series == nil {
		t.Fatalf("series is nil")
	}
	if resp.Msg.Series.Title != "After" {
		t.Fatalf("series title = %q, want After", resp.Msg.Series.Title)
	}
	assertExpectations(t, mock)
}

func TestCreateEpisodeSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	scheduledAtJST := now.Add(2 * time.Hour).In(time.FixedZone("JST", 9*60*60)).Truncate(time.Second)
	scheduledAtUTC := scheduledAtJST.UTC()
	sessionToken := "session-token"

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "SERIES001", "Series Title", "Synopsis", nil, true, now))

	mock.ExpectQuery("INSERT INTO episodes").
		WithArgs(sqlmock.AnyArg(), seriesID, sqlmock.AnyArg(), "Episode 1", int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "series_id", "public_id", "title", "order_index", "created_at"}).
			AddRow(episodeID, seriesID, "EP001", "Episode 1", int32(1), now))

	mock.ExpectQuery("INSERT INTO episode_listings").
		WithArgs(episodeID, int32(100), sql.NullInt32{Int32: 24, Valid: true}, "scheduled", sql.NullTime{Time: scheduledAtUTC, Valid: true}, sql.NullTime{}).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
			AddRow(episodeID, int32(100), int32(24), "scheduled", scheduledAtUTC, nil))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateEpisodeRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		SeriesPublicId:     "SERIES001",
		Title:              "Episode 1",
		OrderIndex:         1,
		Price:              100,
		ReadingPeriodHours: 24,
		ScheduledAt:        scheduledAtJST.Format(time.RFC3339),
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	resp, err := client.CreateEpisode(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	if resp.Msg.Episode == nil {
		t.Fatalf("episode is nil")
	}
	if resp.Msg.Episode.Status != "scheduled" {
		t.Fatalf("episode status = %q, want scheduled", resp.Msg.Episode.Status)
	}
	if resp.Msg.Episode.ScheduledAt != scheduledAtUTC.Format(time.RFC3339) {
		t.Fatalf("episode scheduled_at = %q, want %q", resp.Msg.Episode.ScheduledAt, scheduledAtUTC.Format(time.RFC3339))
	}
	assertExpectations(t, mock)
}

func TestCreateEpisodeValidationAndBoundary(t *testing.T) {
	tests := []struct {
		name     string
		request  *publiraadminv1.CreateEpisodeRequest
		setup    func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time)
		wantCode connect.Code
	}{
		{
			name: "invalid-title",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				SeriesPublicId: "SERIES001",
				Title:          "  ",
				OrderIndex:     1,
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "invalid-scheduled-at",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				SeriesPublicId: "SERIES001",
				Title:          "Episode",
				OrderIndex:     1,
				ScheduledAt:    "invalid-date",
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "past-scheduled-at",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				SeriesPublicId: "SERIES001",
				Title:          "Episode",
				OrderIndex:     1,
				ScheduledAt:    "2000-01-01T00:00:00Z",
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "boundary-scheduled-at-now",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				SeriesPublicId: "SERIES001",
				Title:          "Episode",
				OrderIndex:     1,
				ScheduledAt:    time.Now().UTC().Format(time.RFC3339),
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "series-cross-tenant-or-not-found",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				SeriesPublicId: "SERIES_OTHER_TENANT",
				Title:          "Episode",
				OrderIndex:     1,
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
					WithArgs(tenantID, "SERIES_OTHER_TENANT").
					WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "reading_period_hours", "is_published", "published_at"}))
			},
			wantCode: connect.CodeNotFound,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			sessionToken := "session-token"

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(tc.request)
			req.Header().Set("X-Publira-Session-Id", sessionToken)

			_, err := client.CreateEpisode(context.Background(), req)
			if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("CreateEpisode code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestUploadEpisodeImagesSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := "session-token"

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
		WithArgs(tenantID, "EPISODE001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
			AddRow(episodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "draft", nil, nil))

	mock.ExpectQuery("INSERT INTO episode_images").
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, "local", sqlmock.AnyArg(), sqlmock.AnyArg(), "image/png", int64(67), int32(0), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "storage_provider", "object_key", "image_url", "content_type", "file_size_bytes", "display_order", "width", "height", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, episodeID, "local", "obj-1", "local://obj-1", "image/png", int64(67), int32(0), int32(1), int32(1), now))

	mock.ExpectQuery("INSERT INTO episode_images").
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, "local", sqlmock.AnyArg(), sqlmock.AnyArg(), "image/jpeg", int64(163), int32(1), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "storage_provider", "object_key", "image_url", "content_type", "file_size_bytes", "display_order", "width", "height", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, episodeID, "local", "obj-2", "local://obj-2", "image/jpeg", int64(163), int32(1), int32(1), int32(1), now))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		EpisodePublicId: "EPISODE001",
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "001.png", ContentType: "image/png", Data: oneByOnePNG, DisplayOrder: 0},
			{Filename: "002.jpg", ContentType: "image/jpeg", Data: oneByOneJPEG, DisplayOrder: 1},
		},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	resp, err := client.UploadEpisodeImages(context.Background(), req)
	if err != nil {
		t.Fatalf("UploadEpisodeImages: %v", err)
	}
	if len(resp.Msg.Images) != 2 {
		t.Fatalf("images count = %d, want 2", len(resp.Msg.Images))
	}
	if resp.Msg.Images[0].Width != 1 || resp.Msg.Images[0].Height != 1 {
		t.Fatalf("first image size = %dx%d, want 1x1", resp.Msg.Images[0].Width, resp.Msg.Images[0].Height)
	}
	if resp.Msg.Images[1].Width != 1 || resp.Msg.Images[1].Height != 1 {
		t.Fatalf("second image size = %dx%d, want 1x1", resp.Msg.Images[1].Width, resp.Msg.Images[1].Height)
	}
	assertExpectations(t, mock)
}

func TestUploadEpisodeImagesValidationAndBoundary(t *testing.T) {
	tests := []struct {
		name     string
		request  *publiraadminv1.UploadEpisodeImagesRequest
		setup    func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time)
		wantCode connect.Code
	}{
		{
			name: "images-required",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:          &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				EpisodePublicId: "EPISODE001",
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "episode-not-found",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:          &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				EpisodePublicId: "EPISODE_NOT_FOUND",
				Images:          []*publiraadminv1.EpisodeImageUpload{{Filename: "001.png", ContentType: "image/png", Data: []byte{0x89, 0x50, 0x4e, 0x47}, DisplayOrder: 0}},
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
					WithArgs(tenantID, "EPISODE_NOT_FOUND").
					WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}))
			},
			wantCode: connect.CodeNotFound,
		},
		{
			name: "invalid-content-type",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:          &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				EpisodePublicId: "EPISODE001",
				Images:          []*publiraadminv1.EpisodeImageUpload{{Filename: "bad.txt", ContentType: "text/plain", Data: oneByOnePNG, DisplayOrder: 0}},
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
					WithArgs(tenantID, "EPISODE001").
					WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
						AddRow(uuid.Must(uuid.NewV7()), "EPISODE001", "Episode", int32(1), int32(100), int32(24), "draft", nil, nil))
			},
			wantCode: connect.CodeInvalidArgument,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			sessionToken := "session-token"

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(tc.request)
			req.Header().Set("X-Publira-Session-Id", sessionToken)

			_, err := client.UploadEpisodeImages(context.Background(), req)
			if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("UploadEpisodeImages code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestUpdateEpisodePublishScheduleValidationAndTimezone(t *testing.T) {
	tests := []struct {
		name        string
		scheduled   string
		setup       func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time)
		wantCode    connect.Code
		wantSuccess bool
	}{
		{
			name:      "invalid-format",
			scheduled: "invalid-date",
			wantCode:  connect.CodeInvalidArgument,
		},
		{
			name:      "past",
			scheduled: "2000-01-01T00:00:00Z",
			wantCode:  connect.CodeInvalidArgument,
		},
		{
			name:      "boundary-now",
			scheduled: time.Now().UTC().Format(time.RFC3339),
			wantCode:  connect.CodeInvalidArgument,
		},
		{
			name:      "future-timezone",
			scheduled: "2030-01-01T10:00:00+09:00",
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				scheduledAt, _ := time.Parse(time.RFC3339, "2030-01-01T10:00:00+09:00")
				normalized := scheduledAt.UTC()
				mock.ExpectExec(regexp.QuoteMeta(updateEpisodePublishScheduleByPublicIDForTenantQuery)).
					WithArgs(tenantID, "EPISODE001", sql.NullTime{Time: normalized, Valid: true}).
					WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
					WithArgs(tenantID, "EPISODE001").
					WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
						AddRow(uuid.Must(uuid.NewV7()), "EPISODE001", "Episode", int32(1), int32(100), int32(24), "scheduled", normalized, nil))
			},
			wantSuccess: true,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			sessionToken := "session-token"

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(&publiraadminv1.UpdateEpisodePublishScheduleRequest{
				Tenant:          &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				EpisodePublicId: "EPISODE001",
				ScheduledAt:     tc.scheduled,
			})
			req.Header().Set("X-Publira-Session-Id", sessionToken)

			resp, err := client.UpdateEpisodePublishSchedule(context.Background(), req)
			if tc.wantSuccess {
				if err != nil {
					t.Fatalf("UpdateEpisodePublishSchedule: %v", err)
				}
				if resp.Msg.Episode == nil {
					t.Fatalf("episode is nil")
				}
				if resp.Msg.Episode.ScheduledAt != "2030-01-01T01:00:00Z" {
					t.Fatalf("scheduled_at = %q, want 2030-01-01T01:00:00Z", resp.Msg.Episode.ScheduledAt)
				}
			} else if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("UpdateEpisodePublishSchedule code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestAdminGetSeriesTenantBoundary(t *testing.T) {
	tests := []struct {
		name         string
		publicID     string
		rows         *sqlmock.Rows
		wantCode     connect.Code
		wantSeriesID string
	}{
		{
			name:     "normal",
			publicID: "SERIES001",
			rows: sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "reading_period_hours", "is_published", "published_at"}).
				AddRow(uuid.Must(uuid.NewV7()), "SERIES001", "Series Title", "Synopsis", nil, true, time.Now()),
			wantSeriesID: "SERIES001",
		},
		{
			name:     "cross-tenant",
			publicID: "SERIES_OTHER_TENANT",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "reading_period_hours", "is_published", "published_at"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "not-found",
			publicID: "SERIES_MISSING",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "reading_period_hours", "is_published", "published_at"}),
			wantCode: connect.CodeNotFound,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now()
			sessionToken := "session-token"

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
				WithArgs(tenantID, tc.publicID).
				WillReturnRows(tc.rows)

			client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(&publiraadminv1.GetSeriesRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				PublicId: tc.publicID,
			})
			req.Header().Set("X-Publira-Session-Id", sessionToken)

			resp, err := client.GetSeries(context.Background(), req)
			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("GetSeries: %v", err)
				}
				if resp.Msg.Series == nil {
					t.Fatalf("series is nil")
				}
				if resp.Msg.Series.PublicId != tc.wantSeriesID {
					t.Fatalf("series public_id = %q, want %q", resp.Msg.Series.PublicId, tc.wantSeriesID)
				}
			} else {
				if connect.CodeOf(err) != tc.wantCode {
					t.Fatalf("GetSeries code = %v, want %v", connect.CodeOf(err), tc.wantCode)
				}
			}
			assertExpectations(t, mock)
		})
	}
}
