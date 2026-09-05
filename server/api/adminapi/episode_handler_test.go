package adminapi

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"regexp"
	"slices"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectBegin()
	expectLockSeriesByPublicID(mock, tenantID, "SERIES001", seriesID)
	expectCreateEpisodeBaseInsert(mock, seriesID, episodeID, tenantID, "Episode 1", int32(1), now, "EP001")
	mock.ExpectQuery("INSERT INTO episode_listings").
		WithArgs(episodeID, int32(100), sql.NullInt32{Int32: 24, Valid: true}, "scheduled", sql.NullTime{Time: scheduledAtUTC, Valid: true}, sql.NullTime{}, tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "tenant_id"}).
			AddRow(episodeID, int32(100), int32(24), "scheduled", scheduledAtUTC, nil, tenantID))
	mock.ExpectCommit()
	mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateEpisodeRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId:     "SERIES001",
		Title:              "Episode 1",
		OrderIndex:         1,
		Price:              100,
		ReadingPeriodHours: 24,
		ScheduledAt:        scheduledAtJST.Format(time.RFC3339),
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

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

// An unset order_index appends after the current last episode, so the client
// does not have to read every page of ListEpisodes to find the end.
func TestCreateEpisodeAppendsWhenOrderIndexUnset(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectBegin()
	expectLockSeriesByPublicID(mock, tenantID, "SERIES001", seriesID)
	mock.ExpectQuery(regexp.QuoteMeta(getMaxEpisodeOrderIndexBySeriesForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"max_order_index"}).AddRow(int32(30)))
	expectCreateEpisodeBaseInsert(mock, seriesID, episodeID, tenantID, "Episode 31", int32(31), now, "EP031")
	mock.ExpectQuery("INSERT INTO episode_listings").
		WithArgs(episodeID, int32(0), sql.NullInt32{}, "draft", sql.NullTime{}, sql.NullTime{}, tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "tenant_id"}).
			AddRow(episodeID, int32(0), nil, "draft", nil, nil, tenantID))
	mock.ExpectCommit()
	mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateEpisodeRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId: "SERIES001",
		Title:          "Episode 31",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.CreateEpisode(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	if resp.Msg.Episode.OrderIndex != 31 {
		t.Fatalf("order_index = %d, want max_order_index + 1", resp.Msg.Episode.OrderIndex)
	}
	assertExpectations(t, mock)
}

func TestCreateEpisodeRollsBackWhenListingInsertFails(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectBegin()
	expectLockSeriesByPublicID(mock, tenantID, "SERIES001", seriesID)
	expectCreateEpisodeBaseInsert(mock, seriesID, episodeID, tenantID, "Episode 1", int32(1), now, "EP001")
	mock.ExpectQuery("INSERT INTO episode_listings").
		WithArgs(episodeID, int32(0), sql.NullInt32{}, "draft", sql.NullTime{}, sql.NullTime{}, tenantID).
		WillReturnError(errors.New("listing insert failed"))
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateEpisodeRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId: "SERIES001",
		Title:          "Episode 1",
		OrderIndex:     1,
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.CreateEpisode(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("CreateEpisode code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeInternal, err)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
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
				Tenant:         &publirattypesv1.TenantContext{TenantId: ""},
				SeriesPublicId: "SERIES001",
				Title:          "  ",
				OrderIndex:     1,
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "invalid-scheduled-at",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantId: ""},
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
				Tenant:         &publirattypesv1.TenantContext{TenantId: ""},
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
				Tenant:         &publirattypesv1.TenantContext{TenantId: ""},
				SeriesPublicId: "SERIES001",
				Title:          "Episode",
				OrderIndex:     1,
				ScheduledAt:    time.Now().UTC().Format(time.RFC3339),
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "negative-order-index",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantId: ""},
				SeriesPublicId: "SERIES001",
				Title:          "Episode",
				OrderIndex:     -1,
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "series-cross-tenant-or-not-found",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantId: ""},
				SeriesPublicId: "SERIES_OTHER_TENANT",
				Title:          "Episode",
				OrderIndex:     1,
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				mock.ExpectBegin()
				mock.ExpectQuery(regexp.QuoteMeta(lockSeriesByPublicIDForTenantQuery)).
					WithArgs(tenantID, "SERIES_OTHER_TENANT").
					WillReturnRows(sqlmock.NewRows([]string{"id"}))
				mock.ExpectRollback()
			},
			wantCode: connect.CodeNotFound,
		},
		{
			name: "order-index-limit",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantId: ""},
				SeriesPublicId: "SERIES001",
				Title:          "Episode",
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				mock.ExpectBegin()
				expectLockSeriesByPublicID(mock, tenantID, "SERIES001", uuid.Must(uuid.NewV7()))
				mock.ExpectQuery(regexp.QuoteMeta(getMaxEpisodeOrderIndexBySeriesForTenantQuery)).
					WithArgs(tenantID, "SERIES001").
					WillReturnRows(sqlmock.NewRows([]string{"max_order_index"}).AddRow(int32(math.MaxInt32)))
				mock.ExpectRollback()
			},
			wantCode: connect.CodeFailedPrecondition,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

			expectTenantLookup(mock, tenantID, "TENANT", now)
			if tc.request != nil && tc.request.Tenant != nil {
				tc.request.Tenant.TenantId = tenantID.String()
			}
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(tc.request)
			req.Header().Set("Authorization", "Bearer "+sessionToken)

			_, err := client.CreateEpisode(context.Background(), req)
			if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("CreateEpisode code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestReorderEpisodesSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	expectLockSeriesByPublicID(mock, tenantID, "SERIES001", seriesID)
	expectListEpisodesBySeries(mock, tenantID, "SERIES001", addEpisodeRow(
		addEpisodeRow(
			addEpisodeRow(episodeColumns(), ids[0], "EP001", 1),
			ids[1], "EP002", 2,
		),
		ids[2], "EP003", 3,
	))
	expectUpdateEpisodeOrderIndex(mock, tenantID, "SERIES001", "EP003", 1)
	expectUpdateEpisodeOrderIndex(mock, tenantID, "SERIES001", "EP002", 2)
	expectUpdateEpisodeOrderIndex(mock, tenantID, "SERIES001", "EP001", 3)
	expectListEpisodesBySeries(mock, tenantID, "SERIES001", addEpisodeRow(
		addEpisodeRow(
			addEpisodeRow(episodeColumns(), ids[2], "EP003", 1),
			ids[1], "EP002", 2,
		),
		ids[0], "EP001", 3,
	))
	mock.ExpectCommit()

	req := connect.NewRequest(&publiraadminv1.ReorderEpisodesRequest{
		Tenant:                   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId:           "SERIES001",
		EpisodePublicIds:         []string{"EP003", "EP002", "EP001"},
		ExpectedEpisodePublicIds: []string{"EP001", "EP002", "EP003"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.ReorderEpisodes(context.Background(), req)
	if err != nil {
		t.Fatalf("ReorderEpisodes: %v", err)
	}
	if !slices.Equal(episodePublicIDs(resp.Msg.Episodes), []string{"EP003", "EP002", "EP001"}) {
		t.Fatalf("episodes = %v, want reversed order", episodePublicIDs(resp.Msg.Episodes))
	}
	assertExpectations(t, mock)
}

func TestReorderEpisodesRejectsStaleExpectedOrder(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	expectLockSeriesByPublicID(mock, tenantID, "SERIES001", seriesID)
	// The client still thinks the series is EP001, EP002, EP003, but another
	// write has already swapped the first two.
	expectListEpisodesBySeries(mock, tenantID, "SERIES001", addEpisodeRow(
		addEpisodeRow(
			addEpisodeRow(episodeColumns(), ids[1], "EP002", 1),
			ids[0], "EP001", 2,
		),
		ids[2], "EP003", 3,
	))
	mock.ExpectRollback()

	req := connect.NewRequest(&publiraadminv1.ReorderEpisodesRequest{
		Tenant:                   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId:           "SERIES001",
		EpisodePublicIds:         []string{"EP003", "EP002", "EP001"},
		ExpectedEpisodePublicIds: []string{"EP001", "EP002", "EP003"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.ReorderEpisodes(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ReorderEpisodes code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeFailedPrecondition, err)
	}
	assertExpectations(t, mock)
}

func TestReorderEpisodesRollsBackWhenUpdateFails(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	expectLockSeriesByPublicID(mock, tenantID, "SERIES001", seriesID)
	expectListEpisodesBySeries(mock, tenantID, "SERIES001", addEpisodeRow(
		addEpisodeRow(episodeColumns(), ids[0], "EP001", 1),
		ids[1], "EP002", 2,
	))
	mock.ExpectExec(regexp.QuoteMeta(updateEpisodeOrderIndexByPublicIDForTenantAndSeriesQuery)).
		WithArgs(tenantID, "SERIES001", "EP002", int32(1)).
		WillReturnError(errors.New("order update failed"))
	mock.ExpectRollback()

	req := connect.NewRequest(&publiraadminv1.ReorderEpisodesRequest{
		Tenant:                   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId:           "SERIES001",
		EpisodePublicIds:         []string{"EP002", "EP001"},
		ExpectedEpisodePublicIds: []string{"EP001", "EP002"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.ReorderEpisodes(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ReorderEpisodes code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeInternal, err)
	}
	assertExpectations(t, mock)
}

func TestReorderEpisodesValidationAndBoundary(t *testing.T) {
	tests := []struct {
		name     string
		request  *publiraadminv1.ReorderEpisodesRequest
		setup    func(mock sqlmock.Sqlmock, tenantID uuid.UUID)
		wantCode connect.Code
	}{
		{
			name: "expected-required",
			request: &publiraadminv1.ReorderEpisodesRequest{
				Tenant:           &publirattypesv1.TenantContext{TenantId: ""},
				SeriesPublicId:   "SERIES001",
				EpisodePublicIds: []string{"EP001"},
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "not-a-permutation",
			request: &publiraadminv1.ReorderEpisodesRequest{
				Tenant:                   &publirattypesv1.TenantContext{TenantId: ""},
				SeriesPublicId:           "SERIES001",
				EpisodePublicIds:         []string{"EP001", "EP002"},
				ExpectedEpisodePublicIds: []string{"EP001", "EP003"},
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "duplicate-desired",
			request: &publiraadminv1.ReorderEpisodesRequest{
				Tenant:                   &publirattypesv1.TenantContext{TenantId: ""},
				SeriesPublicId:           "SERIES001",
				EpisodePublicIds:         []string{"EP001", "EP001"},
				ExpectedEpisodePublicIds: []string{"EP001", "EP002"},
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "series-not-found",
			request: &publiraadminv1.ReorderEpisodesRequest{
				Tenant:                   &publirattypesv1.TenantContext{TenantId: ""},
				SeriesPublicId:           "SERIES_MISSING",
				EpisodePublicIds:         []string{"EP001"},
				ExpectedEpisodePublicIds: []string{"EP001"},
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
				mock.ExpectBegin()
				mock.ExpectQuery(regexp.QuoteMeta(lockSeriesByPublicIDForTenantQuery)).
					WithArgs(tenantID, "SERIES_MISSING").
					WillReturnRows(sqlmock.NewRows([]string{"id"}))
				mock.ExpectRollback()
			},
			wantCode: connect.CodeNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)
			if tc.request != nil && tc.request.Tenant != nil {
				tc.request.Tenant.TenantId = tenantID.String()
			}
			if tc.setup != nil {
				tc.setup(mock, tenantID)
			}

			req := connect.NewRequest(tc.request)
			req.Header().Set("Authorization", "Bearer "+sessionToken)
			_, err := client.ReorderEpisodes(context.Background(), req)
			if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("ReorderEpisodes code = %v, want %v (err=%v)", connect.CodeOf(err), tc.wantCode, err)
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
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

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
		WithArgs(sqlmock.AnyArg(), image1ID, "w1", "s3", sqlmock.AnyArg(), "image/png", int64(67), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), image1ID, "w1", "s3", "obj-1", "image/png", int64(67), int32(1), int32(1), now))
	expectAdminAuditLogInsert(mock)

	// Second image (1x1 JPEG)
	image2ID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery("INSERT INTO episode_images").
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(image2ID, tenantID, episodeID, int32(2), now))
	mock.ExpectQuery("INSERT INTO episode_image_variants").
		WithArgs(sqlmock.AnyArg(), image2ID, "w1", "s3", sqlmock.AnyArg(), "image/jpeg", int64(163), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), image2ID, "w1", "s3", "obj-2", "image/jpeg", int64(163), int32(1), int32(1), now))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodePublicId: "EPISODE001",
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "001.png", ContentType: "image/png", Data: oneByOnePNG, DisplayOrder: 0},
			{Filename: "002.jpg", ContentType: "image/jpeg", Data: oneByOneJPEG, DisplayOrder: 1},
		},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

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
	assertAdminMediaToken(t, resp.Msg.Images[0].ImageUrl, tenantID, episodeID, 1)
	assertAdminMediaToken(t, resp.Msg.Images[1].ImageUrl, tenantID, episodeID, 1)
	assertExpectations(t, mock)
}

func TestListEpisodeImagesAttachesAdminMediaToken(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	imageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
		WithArgs(tenantID, "EPISODE001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
			AddRow(episodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "draft", nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodeImagesByEpisodeIDQuery)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at", "content_type", "file_size_bytes", "width", "height"}).
			AddRow(imageID, tenantID, episodeID, int32(1), now, "image/jpeg", int64(2048), int32(1600), int32(900)))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ListEpisodeImagesRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodePublicId: "EPISODE001",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.ListEpisodeImages(context.Background(), req)
	if err != nil {
		t.Fatalf("ListEpisodeImages: %v", err)
	}
	if len(resp.Msg.Images) != 1 {
		t.Fatalf("images count = %d, want 1", len(resp.Msg.Images))
	}
	assertAdminMediaToken(t, resp.Msg.Images[0].ImageUrl, tenantID, episodeID, 1)
	assertExpectations(t, mock)
}

func TestReorderEpisodeImagesAttachesAdminMediaToken(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	image1ID := uuid.Must(uuid.NewV7())
	image2ID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	imageColumns := []string{"id", "tenant_id", "episode_id", "display_order", "created_at", "content_type", "file_size_bytes", "width", "height"}
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
		WithArgs(tenantID, "EPISODE001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
			AddRow(episodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "draft", nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodeImagesByEpisodeIDQuery)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows(imageColumns).
			AddRow(image1ID, tenantID, episodeID, int32(1), now, "image/jpeg", int64(2048), int32(1600), int32(900)).
			AddRow(image2ID, tenantID, episodeID, int32(2), now, "image/jpeg", int64(2048), int32(1600), int32(900)))
	mock.ExpectExec(regexp.QuoteMeta(updateEpisodeImageDisplayOrderByIDForEpisodeQuery)).
		WithArgs(image2ID, episodeID, int32(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(updateEpisodeImageDisplayOrderByIDForEpisodeQuery)).
		WithArgs(image1ID, episodeID, int32(2)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodeImagesByEpisodeIDQuery)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows(imageColumns).
			AddRow(image2ID, tenantID, episodeID, int32(1), now, "image/jpeg", int64(2048), int32(1600), int32(900)).
			AddRow(image1ID, tenantID, episodeID, int32(2), now, "image/jpeg", int64(2048), int32(1600), int32(900)))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ReorderEpisodeImagesRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodePublicId: "EPISODE001",
		ImageIds:        []string{image2ID.String(), image1ID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.ReorderEpisodeImages(context.Background(), req)
	if err != nil {
		t.Fatalf("ReorderEpisodeImages: %v", err)
	}
	if len(resp.Msg.Images) != 2 {
		t.Fatalf("images count = %d, want 2", len(resp.Msg.Images))
	}
	if resp.Msg.Images[0].Id != image2ID.String() || resp.Msg.Images[1].Id != image1ID.String() {
		t.Fatalf("image ids = [%s %s], want [%s %s]", resp.Msg.Images[0].Id, resp.Msg.Images[1].Id, image2ID, image1ID)
	}
	assertAdminMediaToken(t, resp.Msg.Images[0].ImageUrl, tenantID, episodeID, 1)
	assertAdminMediaToken(t, resp.Msg.Images[1].ImageUrl, tenantID, episodeID, 1)
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
				Tenant:          &publirattypesv1.TenantContext{TenantId: ""},
				EpisodePublicId: "EPISODE001",
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "episode-not-found",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:          &publirattypesv1.TenantContext{TenantId: ""},
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
				Tenant:          &publirattypesv1.TenantContext{TenantId: ""},
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
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

			expectTenantLookup(mock, tenantID, "TENANT", now)
			if tc.request != nil && tc.request.Tenant != nil {
				tc.request.Tenant.TenantId = tenantID.String()
			}
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(tc.request)
			req.Header().Set("Authorization", "Bearer "+sessionToken)

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
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

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
			WithArgs(sqlmock.AnyArg(), createdImageID, variant.label, "s3", sqlmock.AnyArg(), "image/jpeg", sqlmock.AnyArg(), variant.width, variant.height).
			WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at"}).
				AddRow(uuid.Must(uuid.NewV7()), createdImageID, variant.label, "s3", "obj", "image/jpeg", int64(2048), variant.width, variant.height, now))
	}
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodePublicId: "EPISODE001",
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "landscape.jpg", ContentType: "image/jpeg", Data: generateJPEG(t, 1600, 900), DisplayOrder: 0},
		},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

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
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

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
		WithArgs(sqlmock.AnyArg(), image1ID, "w1", "s3", sqlmock.AnyArg(), "image/png", int64(67), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), image1ID, "w1", "s3", "obj-1", "image/png", int64(67), int32(1), int32(1), now))
	expectAdminAuditLogInsert(mock)

	image2ID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery("INSERT INTO episode_images").
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(image2ID, tenantID, episodeID, int32(2), now))
	mock.ExpectQuery("INSERT INTO episode_image_variants").
		WithArgs(sqlmock.AnyArg(), image2ID, "w1", "s3", sqlmock.AnyArg(), "image/jpeg", int64(163), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), image2ID, "w1", "s3", "obj-2", "image/jpeg", int64(163), int32(1), int32(1), now))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId:  "SERIES001",
		EpisodePublicId: "EPISODE001",
		ArchiveData: makeZipArchive(t,
			archiveEntry{name: "010.jpg", data: oneByOneJPEG},
			archiveEntry{name: "002.png", data: oneByOnePNG},
		),
		ArchiveFilename:    "episode-images.zip",
		ArchiveContentType: "application/zip",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

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
				Tenant:          &publirattypesv1.TenantContext{TenantId: ""},
				SeriesPublicId:  "SERIES001",
				EpisodePublicId: "EPISODE001",
				ArchiveData:     []byte("not-a-zip"),
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "invalid-path",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:          &publirattypesv1.TenantContext{TenantId: ""},
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
				Tenant:          &publirattypesv1.TenantContext{TenantId: ""},
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
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

			expectTenantLookup(mock, tenantID, "TENANT", now)
			if tc.request != nil && tc.request.Tenant != nil {
				tc.request.Tenant.TenantId = tenantID.String()
			}
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(tc.request)
			req.Header().Set("Authorization", "Bearer "+sessionToken)

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
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(&publiraadminv1.UpdateEpisodePublishScheduleRequest{
				Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				EpisodePublicId: "EPISODE001",
				ScheduledAt:     tc.scheduled,
			})
			req.Header().Set("Authorization", "Bearer "+sessionToken)

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

func episodeColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"public_id",
		"title",
		"order_index",
		"price",
		"reading_period_hours",
		"status",
		"scheduled_at",
		"published_at",
	})
}

func addEpisodeRow(rows *sqlmock.Rows, id uuid.UUID, publicID string, orderIndex int32) *sqlmock.Rows {
	return rows.AddRow(id, publicID, "Episode "+publicID, orderIndex, int32(100), nil, "draft", nil, nil)
}

func newEpisodeClient(
	t *testing.T,
	tenantID, userID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminSeriesServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	return publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newListEpisodesRequest(tenantID uuid.UUID, sessionToken string) *connect.Request[publiraadminv1.ListEpisodesRequest] {
	req := connect.NewRequest(&publiraadminv1.ListEpisodesRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId: "SERIES001",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func episodePublicIDs(items []*publirattypesv1.Episode) []string {
	publicIDs := make([]string, 0, len(items))
	for _, item := range items {
		publicIDs = append(publicIDs, item.PublicId)
	}
	return publicIDs
}

func encodeEpisodeTestToken(direction pagination.Direction, orderIndex int32, id uuid.UUID) string {
	return pagination.Encode(direction, strconv.FormatInt(int64(orderIndex), 10), id.String())
}

func encodeEpisodeTestRecoveryToken(direction pagination.Direction, orderIndex int32, id uuid.UUID) string {
	return pagination.Encode(direction, strconv.FormatInt(int64(orderIndex), 10), id.String(), "inclusive")
}

func TestListEpisodesFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(listEpisodesBySeriesForTenantAscQuery)).
		WithArgs(tenantID, "SERIES001", uuid.NullUUID{}, false, sql.NullInt32{}, int32(3)).
		WillReturnRows(addEpisodeRow(
			addEpisodeRow(
				addEpisodeRow(episodeColumns(), ids[0], "EP001", 1),
				ids[1], "EP002", 2,
			),
			ids[2], "EP003", 3,
		))

	req := newListEpisodesRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	resp, err := client.ListEpisodes(context.Background(), req)
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if !slices.Equal(episodePublicIDs(resp.Msg.Episodes), []string{"EP001", "EP002"}) {
		t.Fatalf("public_ids = %v, want the over-fetched row dropped", episodePublicIDs(resp.Msg.Episodes))
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantKeys := []string{"2", ids[1].String()}
	if cursor.Direction != pagination.Forward || !slices.Equal(cursor.Keys, wantKeys) {
		t.Fatalf("next_token = %+v, want forward keys %v", cursor, wantKeys)
	}
	assertExpectations(t, mock)
}

// A request without a limit takes the default page size, and a page that fits
// in one query reports no tokens at all.
func TestListEpisodesDefaultsToOnePageWithoutTokens(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listEpisodesBySeriesForTenantAscQuery)).
		WithArgs(tenantID, "SERIES001", uuid.NullUUID{}, false, sql.NullInt32{}, int32(21)).
		WillReturnRows(addEpisodeRow(episodeColumns(), uuid.Must(uuid.NewV7()), "EP001", 1))

	resp, err := client.ListEpisodes(context.Background(), newListEpisodesRequest(tenantID, sessionToken))
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if len(resp.Msg.Episodes) != 1 {
		t.Fatalf("episodes = %d rows, want 1", len(resp.Msg.Episodes))
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

// The last page is reachable by following next_token, without an offset.
func TestListEpisodesFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listEpisodesBySeriesForTenantAscQuery)).
		WithArgs(tenantID, "SERIES001", boundaryID, false, int32(2), int32(3)).
		WillReturnRows(addEpisodeRow(episodeColumns(), uuid.Must(uuid.NewV7()), "EP003", 3))

	req := newListEpisodesRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = encodeEpisodeTestToken(pagination.Forward, 2, boundaryID)
	resp, err := client.ListEpisodes(context.Background(), req)
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if !slices.Equal(episodePublicIDs(resp.Msg.Episodes), []string{"EP003"}) {
		t.Fatalf("public_ids = %v, want the page after the boundary row", episodePublicIDs(resp.Msg.Episodes))
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListEpisodesFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listEpisodesBySeriesForTenantDescQuery)).
		WithArgs(tenantID, "SERIES001", boundaryID, false, int32(3), int32(3)).
		WillReturnRows(addEpisodeRow(
			addEpisodeRow(episodeColumns(), uuid.Must(uuid.NewV7()), "EP002", 2),
			uuid.Must(uuid.NewV7()), "EP001", 1,
		))

	req := newListEpisodesRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = encodeEpisodeTestToken(pagination.Backward, 3, boundaryID)
	resp, err := client.ListEpisodes(context.Background(), req)
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if !slices.Equal(episodePublicIDs(resp.Msg.Episodes), []string{"EP001", "EP002"}) {
		t.Fatalf("public_ids = %v, want backward page restored to ascending order", episodePublicIDs(resp.Msg.Episodes))
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertExpectations(t, mock)
}

func TestListEpisodesEmptyPageKeepsAWayBack(t *testing.T) {
	tests := []struct {
		name                  string
		direction             pagination.Direction
		wantQuery             string
		wantRecoveryQuery     string
		wantRecoveredEpisodes []string
	}{
		{
			name:                  "forward",
			direction:             pagination.Forward,
			wantQuery:             listEpisodesBySeriesForTenantAscQuery,
			wantRecoveryQuery:     listEpisodesBySeriesForTenantDescQuery,
			wantRecoveredEpisodes: []string{"EP001", "EP002"},
		},
		{
			name:                  "backward",
			direction:             pagination.Backward,
			wantQuery:             listEpisodesBySeriesForTenantDescQuery,
			wantRecoveryQuery:     listEpisodesBySeriesForTenantAscQuery,
			wantRecoveredEpisodes: []string{"EP002", "EP003"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, "SERIES001", boundaryID, false, int32(2), int32(21)).
				WillReturnRows(episodeColumns())

			req := newListEpisodesRequest(tenantID, sessionToken)
			req.Msg.Token = encodeEpisodeTestToken(test.direction, 2, boundaryID)
			resp, err := client.ListEpisodes(context.Background(), req)
			if err != nil {
				t.Fatalf("ListEpisodes: %v", err)
			}
			recoveryToken := resp.Msg.PreviousToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.Msg.NextToken
				recoveryDirection = pagination.Forward
			}
			wantRecoveryToken := encodeEpisodeTestRecoveryToken(recoveryDirection, 2, boundaryID)
			if recoveryToken != wantRecoveryToken {
				t.Fatalf("recovery token = %q, want %q", recoveryToken, wantRecoveryToken)
			}

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			recoveryRows := addEpisodeRow(episodeColumns(), boundaryID, "EP002", 2)
			if test.direction == pagination.Forward {
				recoveryRows = addEpisodeRow(recoveryRows, uuid.Must(uuid.NewV7()), "EP001", 1)
			} else {
				recoveryRows = addEpisodeRow(recoveryRows, uuid.Must(uuid.NewV7()), "EP003", 3)
			}
			mock.ExpectQuery(regexp.QuoteMeta(test.wantRecoveryQuery)).
				WithArgs(tenantID, "SERIES001", boundaryID, true, int32(2), int32(21)).
				WillReturnRows(recoveryRows)

			recoveryReq := newListEpisodesRequest(tenantID, sessionToken)
			recoveryReq.Msg.Token = recoveryToken
			recovered, err := client.ListEpisodes(context.Background(), recoveryReq)
			if err != nil {
				t.Fatalf("ListEpisodes recovery: %v", err)
			}
			if !slices.Equal(episodePublicIDs(recovered.Msg.Episodes), test.wantRecoveredEpisodes) {
				t.Fatalf("recovered public_ids = %v, want %v", episodePublicIDs(recovered.Msg.Episodes), test.wantRecoveredEpisodes)
			}
			assertExpectations(t, mock)
		})
	}
}

// Recovery happens once. When the boundary row itself is gone the recovery
// query is empty too, and both tokens stay empty so the client falls back to
// the first page instead of bouncing between empty pages.
func TestListEpisodesEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		wantQuery string
	}{
		{
			name:      "recovering backward",
			direction: pagination.Backward,
			wantQuery: listEpisodesBySeriesForTenantDescQuery,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: listEpisodesBySeriesForTenantAscQuery,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, "SERIES001", boundaryID, true, int32(2), int32(21)).
				WillReturnRows(episodeColumns())

			req := newListEpisodesRequest(tenantID, sessionToken)
			req.Msg.Token = encodeEpisodeTestRecoveryToken(test.direction, 2, boundaryID)
			resp, err := client.ListEpisodes(context.Background(), req)
			if err != nil {
				t.Fatalf("ListEpisodes: %v", err)
			}
			if len(resp.Msg.Episodes) != 0 {
				t.Fatalf("episodes = %d rows, want an empty page", len(resp.Msg.Episodes))
			}
			if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
				t.Fatalf(
					"previous_token = %q / next_token = %q, want both empty once recovery also came back empty",
					resp.Msg.PreviousToken, resp.Msg.NextToken,
				)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestListEpisodesInvalidToken(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "not base64", token: "not-a-valid-token"},
		{
			name:  "order index is not a number",
			token: pagination.Encode(pagination.Forward, "second", uuid.Must(uuid.NewV7()).String()),
		},
		{
			name:  "trailing key is not the inclusive marker",
			token: pagination.Encode(pagination.Forward, "2", uuid.Must(uuid.NewV7()).String(), "exclusive"),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

			req := newListEpisodesRequest(tenantID, sessionToken)
			req.Msg.Token = test.token
			_, err := client.ListEpisodes(context.Background(), req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("ListEpisodes code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
			}
			if err.Error() != "invalid_argument: token is invalid" {
				t.Fatalf("ListEpisodes error = %v, want invalid_argument token is invalid", err)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestListEpisodesDatabaseErrorIsHidden(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listEpisodesBySeriesForTenantAscQuery)).
		WithArgs(tenantID, "SERIES001", uuid.NullUUID{}, false, sql.NullInt32{}, int32(21)).
		WillReturnError(errors.New(`pq: relation "episodes" does not exist`))

	_, err := client.ListEpisodes(context.Background(), newListEpisodesRequest(tenantID, sessionToken))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListEpisodes code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}

func TestAdminGetEpisode(t *testing.T) {
	scheduledAt := time.Date(2030, 1, 1, 1, 0, 0, 0, time.UTC)

	tests := []struct {
		name            string
		seriesPublicID  string
		publicID        string
		rows            *sqlmock.Rows
		wantCode        connect.Code
		wantPublicID    string
		wantStatus      string
		wantScheduledAt string
	}{
		{
			name:           "draft",
			seriesPublicID: "SERIES001",
			publicID:       "EPISODE001",
			rows: episodeColumns().AddRow(
				uuid.Must(uuid.NewV7()), "EPISODE001", "Draft Episode", int32(1), int32(0), nil, "draft", nil, nil,
			),
			wantPublicID: "EPISODE001",
			wantStatus:   "draft",
		},
		{
			name:           "scheduled",
			seriesPublicID: "SERIES001",
			publicID:       "EPISODE002",
			rows: episodeColumns().AddRow(
				uuid.Must(uuid.NewV7()), "EPISODE002", "Scheduled Episode", int32(2), int32(100), int32(24), "scheduled", scheduledAt, nil,
			),
			wantPublicID:    "EPISODE002",
			wantStatus:      "scheduled",
			wantScheduledAt: "2030-01-01T01:00:00Z",
		},
		{
			name:           "cross-tenant",
			seriesPublicID: "SERIES_OTHER",
			publicID:       "EPISODE_OTHER",
			rows:           episodeColumns(),
			wantCode:       connect.CodeNotFound,
		},
		{
			name:           "not-found",
			seriesPublicID: "SERIES001",
			publicID:       "EPISODE_MISSING",
			rows:           episodeColumns(),
			wantCode:       connect.CodeNotFound,
		},
		{
			name:           "wrong-series",
			seriesPublicID: "SERIES_OTHER",
			publicID:       "EPISODE001",
			rows:           episodeColumns(),
			wantCode:       connect.CodeNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantAndSeriesQuery)).
				WithArgs(tenantID, tc.seriesPublicID, tc.publicID).
				WillReturnRows(tc.rows)

			req := connect.NewRequest(&publiraadminv1.GetEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				SeriesPublicId: tc.seriesPublicID,
				PublicId:       tc.publicID,
			})
			req.Header().Set("Authorization", "Bearer "+sessionToken)

			resp, err := client.GetEpisode(context.Background(), req)
			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("GetEpisode: %v", err)
				}
				if resp.Msg.Episode == nil {
					t.Fatal("episode is nil")
				}
				if resp.Msg.Episode.PublicId != tc.wantPublicID {
					t.Fatalf("public_id = %q, want %q", resp.Msg.Episode.PublicId, tc.wantPublicID)
				}
				if resp.Msg.Episode.Status != tc.wantStatus {
					t.Fatalf("status = %q, want %q", resp.Msg.Episode.Status, tc.wantStatus)
				}
				if resp.Msg.Episode.ScheduledAt != tc.wantScheduledAt {
					t.Fatalf("scheduled_at = %q, want %q", resp.Msg.Episode.ScheduledAt, tc.wantScheduledAt)
				}
			} else if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("GetEpisode code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestAdminGetEpisodeValidation(t *testing.T) {
	tests := []struct {
		name           string
		seriesPublicID string
		publicID       string
	}{
		{name: "missing-series-public-id", publicID: "EPISODE001"},
		{name: "missing-public-id", seriesPublicID: "SERIES001"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

			req := connect.NewRequest(&publiraadminv1.GetEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				SeriesPublicId: tc.seriesPublicID,
				PublicId:       tc.publicID,
			})
			req.Header().Set("Authorization", "Bearer "+sessionToken)

			_, err := client.GetEpisode(context.Background(), req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("GetEpisode code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestAdminGetEpisodeDatabaseErrorIsHidden(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantAndSeriesQuery)).
		WithArgs(tenantID, "SERIES001", "EPISODE001").
		WillReturnError(errors.New(`pq: relation "episodes" does not exist`))

	req := connect.NewRequest(&publiraadminv1.GetEpisodeRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId: "SERIES001",
		PublicId:       "EPISODE001",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.GetEpisode(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetEpisode code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}

func TestAdminGetEpisodePreservesContextCanceled(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantAndSeriesQuery)).
		WithArgs(tenantID, "SERIES001", "EPISODE001").
		WillReturnError(context.Canceled)

	req := connect.NewRequest(&publiraadminv1.GetEpisodeRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId: "SERIES001",
		PublicId:       "EPISODE001",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.GetEpisode(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeCanceled {
		t.Fatalf("GetEpisode code = %v, want %v", connect.CodeOf(err), connect.CodeCanceled)
	}
	assertExpectations(t, mock)
}
