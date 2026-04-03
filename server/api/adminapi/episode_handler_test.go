package adminapi

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"image"
	"image/color"
	"image/jpeg"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
)

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
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}).
			AddRow(seriesID, "SERIES001", "Series Title", nil, nil, "Synopsis", nil, true, now, nil, nil, int64(0)))

	mock.ExpectQuery("INSERT INTO episodes").
		WithArgs(sqlmock.AnyArg(), seriesID, sqlmock.AnyArg(), "Episode 1", int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "series_id", "public_id", "title", "order_index", "created_at", "tenant_id"}).
			AddRow(episodeID, seriesID, "EP001", "Episode 1", int32(1), now, tenantID))

	mock.ExpectQuery("INSERT INTO episode_listings").
		WithArgs(episodeID, int32(100), sql.NullInt32{Int32: 24, Valid: true}, "scheduled", sql.NullTime{Time: scheduledAtUTC, Valid: true}, sql.NullTime{}).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "tenant_id"}).
			AddRow(episodeID, int32(100), int32(24), "scheduled", scheduledAtUTC, nil, tenantID))
	mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(0, 1))

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
					WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at"}))
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
	mock.ExpectQuery(regexp.QuoteMeta(getMaxEpisodeImageDisplayOrderByEpisodeIDQuery)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"max_display_order"}).AddRow(int32(0)))

	// First image (1x1 PNG)
	image1ID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery("INSERT INTO episode_images").
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(image1ID, tenantID, episodeID, int32(1), now))
	mock.ExpectQuery("INSERT INTO episode_image_variants").
		WithArgs(sqlmock.AnyArg(), image1ID, "w1", "local", sqlmock.AnyArg(), "image/png", int64(67), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), image1ID, "w1", "local", "obj-1", "image/png", int64(67), int32(1), int32(1), now))
	expectAdminAuditLogInsert(mock)

	// Second image (1x1 JPEG)
	image2ID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery("INSERT INTO episode_images").
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(image2ID, tenantID, episodeID, int32(2), now))
	mock.ExpectQuery("INSERT INTO episode_image_variants").
		WithArgs(sqlmock.AnyArg(), image2ID, "w1", "local", sqlmock.AnyArg(), "image/jpeg", int64(163), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), image2ID, "w1", "local", "obj-2", "image/jpeg", int64(163), int32(1), int32(1), now))
	expectAdminAuditLogInsert(mock)

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
				mock.ExpectQuery(regexp.QuoteMeta(getMaxEpisodeImageDisplayOrderByEpisodeIDQuery)).
					WithArgs(sqlmock.AnyArg()).
					WillReturnRows(sqlmock.NewRows([]string{"max_display_order"}).AddRow(int32(0)))
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

func TestUploadEpisodeImagesGeneratesDerivatives(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta(getMaxEpisodeImageDisplayOrderByEpisodeIDQuery)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"max_display_order"}).AddRow(int32(0)))

	variantSizes := []struct {
		label  string
		width  int32
		height int32
	}{
		{label: "w480", width: 480, height: 270},
		{label: "w960", width: 960, height: 540},
		{label: "w1440", width: 1440, height: 810},
		{label: "w1600", width: 1600, height: 900},
	}

	createdImageID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery("INSERT INTO episode_images").
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(createdImageID, tenantID, episodeID, int32(1), now))

	for _, variant := range variantSizes {
		mock.ExpectQuery("INSERT INTO episode_image_variants").
			WithArgs(sqlmock.AnyArg(), createdImageID, variant.label, "local", sqlmock.AnyArg(), "image/jpeg", sqlmock.AnyArg(), variant.width, variant.height).
			WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at"}).
				AddRow(uuid.Must(uuid.NewV7()), createdImageID, variant.label, "local", "obj", "image/jpeg", int64(2048), variant.width, variant.height, now))
	}
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		EpisodePublicId: "EPISODE001",
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "landscape.jpg", ContentType: "image/jpeg", Data: generateJPEG(t, 1600, 900), DisplayOrder: 0},
		},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	resp, err := client.UploadEpisodeImages(context.Background(), req)
	if err != nil {
		t.Fatalf("UploadEpisodeImages: %v", err)
	}
	if len(resp.Msg.Images) != 1 {
		t.Fatalf("images count = %d, want 1", len(resp.Msg.Images))
	}
	if resp.Msg.Images[0].Width != 1600 || resp.Msg.Images[0].Height != 900 {
		t.Fatalf("image size = %dx%d, want 1600x900", resp.Msg.Images[0].Width, resp.Msg.Images[0].Height)
	}

	assertExpectations(t, mock)
}

func TestUploadEpisodeImagesArchiveSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := "session-token"

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantAndSeriesQuery)).
		WithArgs(tenantID, "SERIES001", "EPISODE001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
			AddRow(episodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "draft", nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta(getMaxEpisodeImageDisplayOrderByEpisodeIDQuery)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"max_display_order"}).AddRow(int32(0)))

	image1ID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery("INSERT INTO episode_images").
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(image1ID, tenantID, episodeID, int32(1), now))
	mock.ExpectQuery("INSERT INTO episode_image_variants").
		WithArgs(sqlmock.AnyArg(), image1ID, "w1", "local", sqlmock.AnyArg(), "image/png", int64(67), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), image1ID, "w1", "local", "obj-1", "image/png", int64(67), int32(1), int32(1), now))
	expectAdminAuditLogInsert(mock)

	image2ID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery("INSERT INTO episode_images").
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(image2ID, tenantID, episodeID, int32(2), now))
	mock.ExpectQuery("INSERT INTO episode_image_variants").
		WithArgs(sqlmock.AnyArg(), image2ID, "w1", "local", sqlmock.AnyArg(), "image/jpeg", int64(163), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), image2ID, "w1", "local", "obj-2", "image/jpeg", int64(163), int32(1), int32(1), now))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		SeriesPublicId:  "SERIES001",
		EpisodePublicId: "EPISODE001",
		ArchiveData: makeZipArchive(t,
			archiveEntry{name: "010.jpg", data: oneByOneJPEG},
			archiveEntry{name: "002.png", data: oneByOnePNG},
		),
		ArchiveFilename:    "episode-images.zip",
		ArchiveContentType: "application/zip",
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	resp, err := client.UploadEpisodeImages(context.Background(), req)
	if err != nil {
		t.Fatalf("UploadEpisodeImages: %v", err)
	}
	if len(resp.Msg.Images) != 2 {
		t.Fatalf("images count = %d, want 2", len(resp.Msg.Images))
	}
	assertExpectations(t, mock)
}

func TestUploadEpisodeImagesArchiveValidationAndBoundary(t *testing.T) {
	tests := []struct {
		name     string
		request  *publiraadminv1.UploadEpisodeImagesRequest
		setup    func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time)
		wantCode connect.Code
	}{
		{
			name: "invalid-zip",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:          &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				SeriesPublicId:  "SERIES001",
				EpisodePublicId: "EPISODE001",
				ArchiveData:     []byte("not-a-zip"),
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "invalid-path",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:          &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				SeriesPublicId:  "SERIES001",
				EpisodePublicId: "EPISODE001",
				ArchiveData: makeZipArchive(t,
					archiveEntry{name: "../001.png", data: oneByOnePNG},
				),
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "series-episode-mismatch",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:          &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				SeriesPublicId:  "SERIES_OTHER",
				EpisodePublicId: "EPISODE001",
				ArchiveData: makeZipArchive(t,
					archiveEntry{name: "001.png", data: oneByOnePNG},
				),
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantAndSeriesQuery)).
					WithArgs(tenantID, "SERIES_OTHER", "EPISODE001").
					WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}))
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

			_, err := client.UploadEpisodeImages(context.Background(), req)
			if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("UploadEpisodeImages code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

type archiveEntry struct {
	name string
	data []byte
}

func makeZipArchive(t *testing.T, entries ...archiveEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for _, entry := range entries {
		fileWriter, err := writer.Create(entry.name)
		if err != nil {
			t.Fatalf("writer.Create(%q): %v", entry.name, err)
		}
		if _, err := fileWriter.Write(entry.data); err != nil {
			t.Fatalf("fileWriter.Write(%q): %v", entry.name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close: %v", err)
	}
	return buf.Bytes()
}

func generateJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 180, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("jpeg.Encode: %v", err)
	}
	return buf.Bytes()
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
				mock.ExpectExec("INSERT INTO audit_logs").
					WillReturnResult(sqlmock.NewResult(0, 1))
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
