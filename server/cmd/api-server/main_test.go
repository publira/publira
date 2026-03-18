package main

import (
	"context"
	"fmt"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/apiserver"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	getTenantByPublicIDQuery = "-- name: GetTenantByPublicID :one\nSELECT id, public_id, domain, subdomain, name, default_reading_period_hours, created_at\nFROM tenants\nWHERE public_id = $1\nLIMIT 1\n"
	getSessionByTokenHashForTenantQuery = "-- name: GetSessionByTokenHashForTenant :one\nSELECT id, tenant_id, user_id, token_hash, expires_at, revoked_at, created_at\nFROM sessions\nWHERE tenant_id = $1\n    AND token_hash = $2\nLIMIT 1\n"
	listSeriesByTenantQuery = "-- name: ListSeriesByTenant :many\nSELECT s.id,\n    s.public_id,\n    s.title,\n    s.synopsis,\n    s.is_published,\n    s.published_at\nFROM series s\nWHERE s.tenant_id = $1\nORDER BY s.created_at DESC\nLIMIT $2 OFFSET $3\n"
	listActiveSeriesQuery = "-- name: ListActiveSeries :many\nSELECT s.id,\n    s.public_id,\n    s.title,\n    s.synopsis,\n    s.published_at\nFROM series s\nWHERE s.tenant_id = $1\n    AND s.is_published = true\nORDER BY s.published_at DESC\n"
	getSeriesByPublicIDForTenantQuery = "-- name: GetSeriesByPublicIDForTenant :one\nSELECT s.id,\n    s.public_id,\n    s.title,\n    s.synopsis,\n    s.is_published,\n    s.published_at\nFROM series s\nWHERE s.tenant_id = $1\n    AND s.public_id = $2\nLIMIT 1\n"
	getEpisodeByPublicIDForTenantQuery = "-- name: GetEpisodeByPublicIDForTenant :one\nSELECT e.id,\n    e.public_id,\n    e.title,\n    e.order_index,\n    el.price,\n    el.reading_period_hours,\n    el.status,\n    el.scheduled_at,\n    el.published_at\nFROM episodes e\n    JOIN series s ON s.id = e.series_id\n    JOIN episode_listings el ON el.episode_id = e.id\nWHERE s.tenant_id = $1\n    AND e.public_id = $2\nLIMIT 1\n"
)

func TestAdminSeriesRequiresSession(t *testing.T) {
	testServer, mock := newTestAPIServer(t)

	tenantID := uuid.New()
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListSeries(context.Background(), connect.NewRequest(&publirav1.ListSeriesRequest{
		Tenant: &publirav1.TenantContext{TenantPublicId: "TENANT"},
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
	testServer, mock := newTestAPIServer(t)

	tenantID := uuid.New()
	userID := uuid.New()
	seriesID := uuid.New()
	now := time.Now()
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(listSeriesByTenantQuery)).
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "is_published", "published_at"}).
			AddRow(seriesID, "SERIES001", "Series Title", "Synopsis", true, now))

	client := publirav1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publirav1.ListSeriesRequest{
		Tenant: &publirav1.TenantContext{TenantPublicId: "TENANT"},
	})
	req.Header().Set("Cookie", fmt.Sprintf("%s=%s", auth.SessionCookieName, sessionToken))
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

func TestCatalogRemainsPublic(t *testing.T) {
	testServer, mock := newTestAPIServer(t)

	tenantID := uuid.New()
	seriesID := uuid.New()
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at"}).
			AddRow(seriesID, "SERIESPUB", "Public Series", "Public Synopsis", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirav1.TenantContext{TenantPublicId: "TENANT"},
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}
	if len(resp.Msg.Series) != 1 {
		t.Fatalf("series count = %d, want 1", len(resp.Msg.Series))
	}
	if resp.Msg.Series[0].PublicId != "SERIESPUB" {
		t.Fatalf("series public_id = %q, want SERIESPUB", resp.Msg.Series[0].PublicId)
	}
	assertExpectations(t, mock)
}

func TestAdminGetSeriesTenantBoundary(t *testing.T) {
	tests := []struct {
		name          string
		publicID      string
		rows          *sqlmock.Rows
		wantCode      connect.Code
		wantSeriesID  string
		wantSeriesLen int
	}{
		{
			name:     "normal",
			publicID: "SERIES001",
			rows: sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "is_published", "published_at"}).
				AddRow(uuid.New(), "SERIES001", "Series Title", "Synopsis", true, time.Now()),
			wantSeriesID:  "SERIES001",
			wantSeriesLen: 1,
		},
		{
			name:          "cross-tenant",
			publicID:      "SERIES_OTHER_TENANT",
			rows:          sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "is_published", "published_at"}),
			wantCode:      connect.CodeNotFound,
			wantSeriesLen: 0,
		},
		{
			name:          "not-found",
			publicID:      "SERIES_MISSING",
			rows:          sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "is_published", "published_at"}),
			wantCode:      connect.CodeNotFound,
			wantSeriesLen: 0,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAPIServer(t)

			tenantID := uuid.New()
			userID := uuid.New()
			now := time.Now()
			sessionToken := "session-token"

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
				WithArgs(tenantID, tc.publicID).
				WillReturnRows(tc.rows)

			client := publirav1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(&publirav1.GetSeriesRequest{
				Tenant:   &publirav1.TenantContext{TenantPublicId: "TENANT"},
				PublicId: tc.publicID,
			})
			req.Header().Set("Cookie", fmt.Sprintf("%s=%s", auth.SessionCookieName, sessionToken))

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

func TestCatalogGetEpisodeDetailTenantBoundary(t *testing.T) {
	tests := []struct {
		name     string
		publicID string
		rows     *sqlmock.Rows
		wantCode connect.Code
	}{
		{
			name:     "normal",
			publicID: "EPISODE001",
			rows: sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
				AddRow(uuid.New(), "EPISODE001", "Episode Title", int32(1), int32(100), int32(24), "published", nil, time.Now()),
		},
		{
			name:     "cross-tenant",
			publicID: "EPISODE_OTHER_TENANT",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "not-found",
			publicID: "EPISODE_MISSING",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}),
			wantCode: connect.CodeNotFound,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAPIServer(t)
			tenantID := uuid.New()
			now := time.Now()

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
				WithArgs(tenantID, tc.publicID).
				WillReturnRows(tc.rows)

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			resp, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
				Tenant:   &publirav1.TenantContext{TenantPublicId: "TENANT"},
				PublicId: tc.publicID,
			}))

			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("GetEpisodeDetail: %v", err)
				}
				if resp.Msg.Episode == nil {
					t.Fatalf("episode is nil")
				}
				if resp.Msg.Episode.PublicId != tc.publicID {
					t.Fatalf("episode public_id = %q, want %q", resp.Msg.Episode.PublicId, tc.publicID)
				}
			} else {
				if connect.CodeOf(err) != tc.wantCode {
					t.Fatalf("GetEpisodeDetail code = %v, want %v", connect.CodeOf(err), tc.wantCode)
				}
			}
			assertExpectations(t, mock)
		})
	}
}

func newTestAPIServer(t *testing.T) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	server := httptest.NewServer(apiserver.NewHandler(dbmodels.New(db)))
	t.Cleanup(server.Close)
	return server, mock
}

func expectTenantLookup(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs(publicID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "domain", "subdomain", "name", "default_reading_period_hours", "created_at"}).
			AddRow(tenantID, publicID, nil, nil, "Tenant", nil, now))
}

func expectActiveSessionLookup(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, sessionToken string, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(getSessionByTokenHashForTenantQuery)).
		WithArgs(tenantID, auth.HashToken(sessionToken)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
			AddRow(uuid.New(), tenantID, userID, auth.HashToken(sessionToken), now.Add(time.Hour), nil, now))
}

func assertExpectations(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}