package publicapi

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
)

func TestCatalogListPublishedSeriesSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at", "creators", "label_info"}).
			AddRow(seriesID, "SERIESPUB", "Public Series", "Public Synopsis", now, []byte(`[]`), []byte(`{"public_id":"LABEL001","name":"Weekly Jump"}`)))

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
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesPaginationUsesRequestValues(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantID, int32(1), int32(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at", "creators", "label_info"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		Limit:  1,
		Offset: 2,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesPaginationInvalidValuesUseDefault(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at", "creators", "label_info"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		Limit:  101,
		Offset: -1,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesTenantIsolation(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantAID := uuid.Must(uuid.NewV7())
	tenantBID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantAID, "TENANT_A", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantAID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at", "creators", "label_info"}).
			AddRow(uuid.Must(uuid.NewV7()), "SERIES_A", "Series A", "Synopsis A", now, []byte(`[]`), []byte(`{}`)))
	expectTenantLookup(mock, tenantBID, "TENANT_B", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantBID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at", "creators", "label_info"}).
			AddRow(uuid.Must(uuid.NewV7()), "SERIES_B", "Series B", "Synopsis B", now, []byte(`[]`), []byte(`{}`)))

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

	assertPublicExpectations(t, mock)
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
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIESPUB", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "eye_catch_image_id", "eye_catch_image_updated_at", "synopsis", "is_published", "published_at", "creators", "episodes"}).
			AddRow(
				seriesID,
				"SERIESPUB",
				"Public Series",
				"LABEL001",
				"Weekly Jump",
				nil,
				nil,
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

	assertPublicExpectations(t, mock)
}

func TestCatalogGetSeriesDetailReturnsPermissionDeniedForUnpublishedSeries(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIES_DRAFT", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "eye_catch_image_id", "eye_catch_image_updated_at", "synopsis", "is_published", "published_at", "creators", "episodes"}).
			AddRow(uuid.Must(uuid.NewV7()), "SERIES_DRAFT", "Draft Series", nil, nil, nil, nil, nil, false, nil, []byte(`[]`), []byte(`[]`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId: "SERIES_DRAFT",
	}))

	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("GetSeriesDetail code = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogGetSeriesDetailReturnsNotFoundForMissingSeries(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIES_MISSING", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "eye_catch_image_id", "eye_catch_image_updated_at", "synopsis", "is_published", "published_at", "creators", "episodes"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId: "SERIES_MISSING",
	}))

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetSeriesDetail code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogGetEpisodeDetailTenantBoundary(t *testing.T) {
	normalEpisodeID := uuid.Must(uuid.NewV7())

	tests := []struct {
		episodeID uuid.UUID
		name      string
		publicID  string
		rows      *sqlmock.Rows
		wantCode  connect.Code
	}{
		{
			episodeID: normalEpisodeID,
			name:      "normal",
			publicID:  "EPISODE001",
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
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now()

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(getPublishedEpisodeByPublicIDQuery)).
				WithArgs(tenantID, tc.publicID).
				WillReturnRows(tc.rows)
			if tc.wantCode == 0 {
				rows := sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at", "content_type", "file_size_bytes", "width", "height"}).
					AddRow(uuid.Must(uuid.NewV7()), tenantID, tc.episodeID, int32(1), now, "image/png", int64(1024), int32(1200), int32(1800))
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
			assertPublicExpectations(t, mock)
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
