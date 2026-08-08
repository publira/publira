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
	seriesImageID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "creators", "label_info"}).
			AddRow(seriesID, "SERIESPUB", "Public Series", "Public Synopsis", now, seriesImageID, now, []byte(`[{"public_id":"CREATOR001","name":"Author A","role":"writer","profile_text":"","icon_image_url":"/images/creators/6f4bba7c-5d8a-4bb3-8e0f-3e94985f14e8","icon_image_file_size_bytes":0,"icon_image_updated_at":""}]`), []byte(`{"public_id":"LABEL001","name":"Weekly Jump"}`)))
	mock.ExpectQuery(regexp.QuoteMeta(listSeriesImageVariantsByImageIDsQuery)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"series_image_id", "variant_type", "label", "content_type", "file_size_bytes", "width", "height"}).
			AddRow(seriesImageID, "square", "md", "image/webp", int64(2048), int32(512), int32(512)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
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
	if len(resp.Msg.Series[0].Creators) != 1 || resp.Msg.Series[0].Creators[0].IconImageUrl == "" {
		t.Fatalf("series creators = %+v, want creator icon_image_url", resp.Msg.Series[0].Creators)
	}
	if got := len(resp.Msg.Series[0].EyeCatchImageVariants); got != 1 {
		t.Fatalf("eye_catch_image_variants count = %d, want 1", got)
	}
	if resp.Msg.Series[0].EyeCatchImageVariants[0].Url == "" {
		t.Fatalf("eye_catch_image_variants url is empty")
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
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
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
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
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
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "creators", "label_info"}).
			AddRow(uuid.Must(uuid.NewV7()), "SERIES_A", "Series A", "Synopsis A", now, nil, nil, []byte(`[]`), []byte(`{}`)))
	expectTenantLookup(mock, tenantBID, "TENANT_B", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesQuery)).
		WithArgs(tenantBID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "creators", "label_info"}).
			AddRow(uuid.Must(uuid.NewV7()), "SERIES_B", "Series B", "Synopsis B", now, nil, nil, []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	respA, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantAID.String()},
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries for TENANT_A: %v", err)
	}
	respB, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantBID.String()},
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
	seriesImageID := uuid.Must(uuid.NewV7())
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
				seriesImageID,
				nil,
				"Public Synopsis",
				true,
				now,
				[]byte(`[{"name":"Author A","role":"writer","icon_image_url":"/images/creators/6f4bba7c-5d8a-4bb3-8e0f-3e94985f14e8","icon_image_file_size_bytes":0,"icon_image_updated_at":""}]`),
				[]byte(`[{"public_id":"EP001","title":"Episode 1","order_index":1,"price":100,"reading_period_hours":24,"status":"published","scheduled_at":null,"published_at":"2026-03-18T00:00:00Z"}]`),
			))
	mock.ExpectQuery(regexp.QuoteMeta(listSeriesImageVariantsByImageIDsQuery)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"series_image_id", "variant_type", "label", "content_type", "file_size_bytes", "width", "height"}).
			AddRow(seriesImageID, "portrait", "md", "image/webp", int64(3072), int32(768), int32(1024)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
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
	if got := len(resp.Msg.Series.EyeCatchImageVariants); got != 1 {
		t.Fatalf("eye_catch_image_variants count = %d, want 1", got)
	}
	if resp.Msg.Series.Creators[0].IconImageUrl == "" {
		t.Fatalf("creator icon_image_url is empty")
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
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
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
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
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
			// Paid episode without session: metadata OK, body locked (no images).
			episodeID: normalEpisodeID,
			name:      "normal-paid-locked",
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

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			resp, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
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
				if resp.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
					t.Fatalf("access = %v, want %v", resp.Msg.Access, publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED)
				}
				if len(resp.Msg.Images) != 0 {
					t.Fatalf("images count = %d, want 0 for locked paid episode", len(resp.Msg.Images))
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

func TestCatalogGetEpisodeDetailAccessEvaluation(t *testing.T) {
	tests := []struct {
		name   string
		price  int32
		authed bool
		// invalidBearer sends Authorization with a non-verifiable token (no auth SQL expected).
		invalidBearer    bool
		hasContentAccess bool
		wantAccess       publirav1.EpisodeAccess
		wantImageCount   int
	}{
		{
			name:           "free-unauthenticated",
			price:          0,
			wantAccess:     publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
			wantImageCount: 1,
		},
		{
			name:           "paid-unauthenticated-locked",
			price:          500,
			wantAccess:     publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			wantImageCount: 0,
		},
		{
			name:             "paid-authed-with-ticket-entitled",
			price:            500,
			authed:           true,
			hasContentAccess: true,
			wantAccess:       publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED,
			wantImageCount:   1,
		},
		{
			name:             "paid-authed-without-grant-locked",
			price:            500,
			authed:           true,
			hasContentAccess: false,
			wantAccess:       publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			wantImageCount:   0,
		},
		{
			name:           "paid-invalid-bearer-locked",
			price:          500,
			invalidBearer:  true,
			wantAccess:     publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			wantImageCount: 0,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			episodeID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now()

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(getPublishedEpisodeByPublicIDQuery)).
				WithArgs(tenantID, "EPISODE001").
				WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}).
					AddRow(episodeID, "EPISODE001", "Episode Title", int32(1), tc.price, int32(24), "published", nil, now.UTC(), "SERIES001", "Series Title"))

			if tc.authed {
				// authenticateAccessToken looks up tenant again via tenantByContext
				expectTenantLookup(mock, tenantID, "TENANT", now)
				expectAuthSession(mock, tenantID, userID, now)
				mock.ExpectQuery(regexp.QuoteMeta(userHasEpisodeContentAccessQuery)).
					WithArgs(tenantID, userID, episodeID).
					WillReturnRows(sqlmock.NewRows([]string{"has_access"}).AddRow(tc.hasContentAccess))
			} else if tc.invalidBearer {
				// Token verify fails after tenant re-lookup; no content-access or images queries.
				expectTenantLookup(mock, tenantID, "TENANT", now)
			}

			if tc.wantImageCount > 0 {
				mock.ExpectQuery(regexp.QuoteMeta(listEpisodeImagesByEpisodeIDQuery)).
					WithArgs(episodeID).
					WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at", "content_type", "file_size_bytes", "width", "height"}).
						AddRow(uuid.Must(uuid.NewV7()), tenantID, episodeID, int32(1), now, "image/png", int64(1024), int32(1200), int32(1800)))
			}

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			var req *connect.Request[publirav1.GetEpisodeDetailRequest]
			switch {
			case tc.authed:
				req = newAuthedPublicRequest(&publirav1.GetEpisodeDetailRequest{
					Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
					PublicId: "EPISODE001",
				}, tenantID.String())
			case tc.invalidBearer:
				req = connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
					Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
					PublicId: "EPISODE001",
				})
				req.Header().Set("Authorization", "Bearer not-a-valid-jwt")
			default:
				req = connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
					Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
					PublicId: "EPISODE001",
				})
			}

			resp, err := client.GetEpisodeDetail(context.Background(), req)
			if err != nil {
				t.Fatalf("GetEpisodeDetail: %v", err)
			}
			if resp.Msg.Access != tc.wantAccess {
				t.Fatalf("access = %v, want %v", resp.Msg.Access, tc.wantAccess)
			}
			if len(resp.Msg.Images) != tc.wantImageCount {
				t.Fatalf("images count = %d, want %d", len(resp.Msg.Images), tc.wantImageCount)
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

func TestUserHasEpisodeContentAccessQueryCoversPurchasesAndTickets(t *testing.T) {
	requiredSnippets := []string{
		"FROM purchases p",
		"FROM access_tickets at",
		"at.revoked_at IS NULL",
		"at.expires_at > NOW()",
		"p.expires_at > NOW()",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(userHasEpisodeContentAccessQuery, snippet) {
			t.Fatalf("userHasEpisodeContentAccessQuery does not contain %q", snippet)
		}
	}
}
