package main

import (
	"context"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/publicapi"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/storage"
)

const (
	getTenantByPublicIDQuery           = "-- name: GetTenantByPublicID :one\nSELECT id, public_id, domain, name, default_reading_period_hours, created_at, status, admin_domain\nFROM tenants\nWHERE public_id = $1\nLIMIT 1\n"
	listActiveSeriesQuery              = "-- name: ListActiveSeries :many\nSELECT s.id,\n    s.public_id,\n    s.title,\n    sl.synopsis,\n    s.published_at\nFROM series s\n    LEFT JOIN series_listings sl ON sl.series_id = s.id\nWHERE s.tenant_id = $1\n    AND s.is_published = true\n    AND s.published_at IS NOT NULL\n    AND s.published_at <= NOW()\nORDER BY s.published_at DESC\nLIMIT $2 OFFSET $3\n"
	getSeriesDetailQuery               = "-- name: GetSeriesDetail :one\nSELECT s.id,\n    s.public_id,\n    s.title,\n    l.name AS label_name,\n    sl.synopsis,\n    s.is_published,\n    s.published_at,\n    -- 複数の著者情報をJSON配列として1カラムにまとめる\n    COALESCE(\n        json_agg(\n            json_build_object(\n                'name',\n                c.name,\n                'role',\n                sc.role\n            )\n            ORDER BY sc.display_order ASC\n        ) FILTER (\n            WHERE c.id IS NOT NULL\n        ),\n        '[]'\n    )::jsonb AS creators,\n    COALESCE(\n        (\n            SELECT json_agg(\n                    json_build_object(\n                        'public_id',\n                        e.public_id,\n                        'title',\n                        e.title,\n                        'order_index',\n                        e.order_index,\n                        'price',\n                        el.price,\n                        'reading_period_hours',\n                        el.reading_period_hours,\n                        'status',\n                        el.status,\n                        'scheduled_at',\n                        el.scheduled_at,\n                        'published_at',\n                        el.published_at\n                    )\n                    ORDER BY e.order_index ASC\n                )\n            FROM episodes e\n                JOIN episode_listings el ON el.episode_id = e.id\n            WHERE e.series_id = s.id\n                AND el.status = 'published'\n                AND el.published_at IS NOT NULL\n                AND el.published_at <= NOW()\n        ),\n        '[]'\n    )::jsonb AS episodes\nFROM series s\n    LEFT JOIN series_listings sl ON sl.series_id = s.id\n    LEFT JOIN labels l ON s.label_id = l.id\n    LEFT JOIN series_creators sc ON s.id = sc.series_id\n    LEFT JOIN creators c ON sc.creator_id = c.id\nWHERE s.public_id = $1\n    AND s.tenant_id = $2\nGROUP BY s.id,\n    l.id,\n    sl.series_id,\n    sl.synopsis\n"
	getPublishedEpisodeByPublicIDQuery = "-- name: GetPublishedEpisodeByPublicIDForTenant :one\nSELECT e.id,\n    e.public_id,\n    e.title,\n    e.order_index,\n    el.price,\n    el.reading_period_hours,\n    el.status,\n    el.scheduled_at,\n    el.published_at,\n    s.public_id AS series_public_id,\n    s.title AS series_title\nFROM episodes e\n    JOIN series s ON s.id = e.series_id\n    JOIN episode_listings el ON el.episode_id = e.id\nWHERE s.tenant_id = $1\n    AND e.public_id = $2\n    AND s.is_published = true\n    AND s.published_at IS NOT NULL\n    AND s.published_at <= NOW()\n    AND el.status = 'published'\n    AND el.published_at IS NOT NULL\n    AND el.published_at <= NOW()\nLIMIT 1\n"
	listEpisodeImagesByEpisodeIDQuery  = "-- name: ListEpisodeImagesByEpisodeID :many\nSELECT id, tenant_id, episode_id, storage_provider, object_key, image_url, content_type, file_size_bytes, display_order, width, height, created_at\nFROM episode_images\nWHERE episode_id = $1\nORDER BY display_order ASC,\n    created_at ASC\n"
)

func TestCatalogRemainsPublic(t *testing.T) {
	testServer, mock := newTestAPIServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at"}).
			AddRow(seriesID, "SERIESPUB", "Public Series", "Public Synopsis", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
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

func TestCatalogListPublishedSeriesPaginationUsesRequestValues(t *testing.T) {
	testServer, mock := newTestAPIServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantID, int32(1), int32(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		Limit:  1,
		Offset: 2,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	assertExpectations(t, mock)
}

func TestCatalogListPublishedSeriesPaginationInvalidValuesUseDefault(t *testing.T) {
	testServer, mock := newTestAPIServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		Limit:  101,
		Offset: -1,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	assertExpectations(t, mock)
}

func TestCatalogListPublishedSeriesTenantIsolation(t *testing.T) {
	testServer, mock := newTestAPIServer(t)

	tenantAID := uuid.Must(uuid.NewV7())
	tenantBID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantAID, "TENANT_A", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantAID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at"}).
			AddRow(uuid.Must(uuid.NewV7()), "SERIES_A", "Series A", "Synopsis A", now))
	expectTenantLookup(mock, tenantBID, "TENANT_B", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantBID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at"}).
			AddRow(uuid.Must(uuid.NewV7()), "SERIES_B", "Series B", "Synopsis B", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	respA, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT_A"},
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries for TENANT_A: %v", err)
	}
	respB, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT_B"},
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries for TENANT_B: %v", err)
	}

	if len(respA.Msg.Series) != 1 || respA.Msg.Series[0].PublicId != "SERIES_A" {
		t.Fatalf("TENANT_A response = %+v, want SERIES_A only", respA.Msg.Series)
	}
	if len(respB.Msg.Series) != 1 || respB.Msg.Series[0].PublicId != "SERIES_B" {
		t.Fatalf("TENANT_B response = %+v, want SERIES_B only", respB.Msg.Series)
	}

	assertExpectations(t, mock)
}

func TestListActiveSeriesQueryHasPublicationGuards(t *testing.T) {
	requiredSnippets := []string{
		"s.is_published = true",
		"s.published_at IS NOT NULL",
		"s.published_at <= NOW()",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(listActiveSeriesQuery, snippet) {
			t.Fatalf("listActiveSeriesQuery does not contain %q", snippet)
		}
	}
}

func TestCatalogGetSeriesDetailContract(t *testing.T) {
	testServer, mock := newTestAPIServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIESPUB", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_name", "synopsis", "is_published", "published_at", "creators", "episodes"}).
			AddRow(
				seriesID,
				"SERIESPUB",
				"Public Series",
				"Weekly Jump",
				"Public Synopsis",
				true,
				now,
				[]byte(`[{"name":"Author A","role":"writer"}]`),
				[]byte(`[{"public_id":"EP001","title":"Episode 1","order_index":1,"price":100,"reading_period_hours":24,"status":"published","scheduled_at":null,"published_at":"2026-03-18T00:00:00Z"}]`),
			))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId: "SERIESPUB",
	}))
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}

	if resp.Msg.Series == nil {
		t.Fatalf("series is nil")
	}
	if resp.Msg.Series.PublicId != "SERIESPUB" {
		t.Fatalf("series public_id = %q, want SERIESPUB", resp.Msg.Series.PublicId)
	}
	if resp.Msg.Series.Label == nil || resp.Msg.Series.Label.Name != "Weekly Jump" {
		t.Fatalf("series label = %+v, want Weekly Jump", resp.Msg.Series.Label)
	}
	if len(resp.Msg.Series.Creators) != 1 || resp.Msg.Series.Creators[0].Name != "Author A" {
		t.Fatalf("series creators = %+v, want one creator Author A", resp.Msg.Series.Creators)
	}
	if len(resp.Msg.Episodes) != 1 || resp.Msg.Episodes[0].PublicId != "EP001" {
		t.Fatalf("episodes = %+v, want one published episode EP001", resp.Msg.Episodes)
	}

	assertExpectations(t, mock)
}

func TestCatalogGetSeriesDetailReturnsPermissionDeniedForUnpublishedSeries(t *testing.T) {
	testServer, mock := newTestAPIServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIES_DRAFT", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_name", "synopsis", "is_published", "published_at", "creators", "episodes"}).
			AddRow(uuid.Must(uuid.NewV7()), "SERIES_DRAFT", "Draft Series", nil, nil, false, nil, []byte(`[]`), []byte(`[]`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId: "SERIES_DRAFT",
	}))

	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("GetSeriesDetail code = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}

	assertExpectations(t, mock)
}

func TestCatalogGetSeriesDetailReturnsNotFoundForMissingSeries(t *testing.T) {
	testServer, mock := newTestAPIServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIES_MISSING", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_name", "synopsis", "is_published", "published_at", "creators", "episodes"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId: "SERIES_MISSING",
	}))

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetSeriesDetail code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}

	assertExpectations(t, mock)
}

func TestCatalogGetEpisodeDetailTenantBoundary(t *testing.T) {
	normalEpisodeID := uuid.Must(uuid.NewV7())

	tests := []struct {
		episodeID uuid.UUID
		name     string
		publicID string
		rows     *sqlmock.Rows
		wantCode connect.Code
	}{
		{
			episodeID: normalEpisodeID,
			name:     "normal",
			publicID: "EPISODE001",
			rows: sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}).
				AddRow(normalEpisodeID, "EPISODE001", "Episode Title", int32(1), int32(100), int32(24), "published", nil, time.Now().UTC(), "SERIES001", "Series Title"),
		},
		{
			name:     "unpublished",
			publicID: "EPISODE_DRAFT",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "scheduled-boundary-not-reached",
			publicID: "EPISODE_SCHEDULED",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "cross-tenant",
			publicID: "EPISODE_OTHER_TENANT",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "not-found",
			publicID: "EPISODE_MISSING",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}),
			wantCode: connect.CodeNotFound,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAPIServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now()

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(getPublishedEpisodeByPublicIDQuery)).
				WithArgs(tenantID, tc.publicID).
				WillReturnRows(tc.rows)
			if tc.wantCode == 0 {
				rows := sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "storage_provider", "object_key", "image_url", "content_type", "file_size_bytes", "display_order", "width", "height", "created_at"}).
					AddRow(uuid.Must(uuid.NewV7()), tenantID, tc.episodeID, "local", "episodes/001.png", "https://cdn.example/episodes/001.png", "image/png", int64(1024), int32(1), int32(1200), int32(1800), now)
				mock.ExpectQuery(regexp.QuoteMeta(listEpisodeImagesByEpisodeIDQuery)).
					WithArgs(tc.episodeID).
					WillReturnRows(rows)
			}

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			resp, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
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
				if resp.Msg.Series == nil || resp.Msg.Series.PublicId != "SERIES001" {
					t.Fatalf("series public_id = %q, want SERIES001", resp.Msg.Series.GetPublicId())
				}
				if len(resp.Msg.Images) != 1 {
					t.Fatalf("images count = %d, want 1", len(resp.Msg.Images))
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

func TestGetPublishedEpisodeQueryHasPublicationGuards(t *testing.T) {
	requiredSnippets := []string{
		"s.is_published = true",
		"s.published_at IS NOT NULL",
		"s.published_at <= NOW()",
		"el.status = 'published'",
		"el.published_at IS NOT NULL",
		"el.published_at <= NOW()",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(getPublishedEpisodeByPublicIDQuery, snippet) {
			t.Fatalf("getPublishedEpisodeByPublicIDQuery does not contain %q", snippet)
		}
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
	server := httptest.NewServer(publicapi.NewHandler(dbmodels.New(db), &testStorageProvider{}))
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

func expectTenantLookup(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs(publicID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "domain", "name", "default_reading_period_hours", "created_at", "status", "admin_domain"}).
			AddRow(tenantID, publicID, "tenant.example", "Tenant", nil, now, "active", nil))
}

func assertExpectations(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
