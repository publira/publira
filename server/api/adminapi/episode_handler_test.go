package adminapi

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"regexp"
	"slices"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/testutil"
)

func TestCreateEpisodeSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := testSeriesID
	episodeID := testEpisodeID
	now := time.Now().UTC().Truncate(time.Microsecond)
	scheduledAtJST := now.Add(2 * time.Hour).In(time.FixedZone("JST", 9*60*60)).Truncate(time.Second)
	scheduledAtUTC := scheduledAtJST.UTC()
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectBegin()
	expectLockSeriesByID(mock, tenantID, testSeriesID)
	expectCreateEpisodeBaseInsert(mock, seriesID, episodeID, tenantID, "Episode 1", int32(1), now, "EP001")
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertEpisodeListing)).
		WithArgs(episodeID, int32(100), sql.NullInt32{Int32: 24, Valid: true}, "scheduled", sql.NullTime{Time: scheduledAtUTC, Valid: true}, sql.NullTime{}, tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "tenant_id", "announced_at"}).
			AddRow(episodeID, int32(100), int32(24), "scheduled", scheduledAtUTC, nil, tenantID, nil))
	expectBakeSeriesCreatorsOntoEpisode(mock, tenantID, seriesID, episodeID)
	expectResolvedEpisodePurchaseAvailability(mock, tenantID, episodeID, "app")
	mock.ExpectCommit()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.InsertAuditLog)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.CreateEpisodeRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:           testSeriesID.String(),
		Title:              "Episode 1",
		OrderIndex:         1,
		Price:              100,
		ReadingPeriodHours: 24,
		ScheduledAt:        scheduledAtJST.Format(time.RFC3339),
	}

	resp, err := client.CreateEpisode(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	if resp.Episode == nil {
		t.Fatalf("episode is nil")
	}
	// The created episode states nothing of its own and carries what it
	// inherits, so a form shows the purchase action without reading it again.
	if resp.PurchaseAvailability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED ||
		resp.Episode.PurchaseAvailability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP {
		t.Fatalf("purchase availability override, resolved = %s, %s, want UNSPECIFIED, APP", resp.PurchaseAvailability, resp.Episode.PurchaseAvailability)
	}
	if resp.Episode.Status != "scheduled" {
		t.Fatalf("episode status = %q, want scheduled", resp.Episode.Status)
	}
	if resp.Episode.ScheduledAt != scheduledAtUTC.Format(time.RFC3339) {
		t.Fatalf("episode scheduled_at = %q, want %q", resp.Episode.ScheduledAt, scheduledAtUTC.Format(time.RFC3339))
	}
	assertExpectations(t, mock)
}

// A scheduled_at that has already passed publishes the episode as it is
// created, and the same transaction owes the storefront's cache drop and the
// followers' notice the scheduled publication job would otherwise write.
func TestCreateEpisodePublishesAtOnceWhenScheduledAtHasPassed(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := testSeriesID
	episodeID := testEpisodeID
	now := time.Now().UTC().Truncate(time.Microsecond)
	scheduledAt := now.Add(-time.Hour).Truncate(time.Second)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectBegin()
	expectLockSeriesByID(mock, tenantID, testSeriesID)
	expectCreateEpisodeBaseInsert(mock, seriesID, episodeID, tenantID, "Episode 1", int32(1), now, "EP001")
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertEpisodeListing)).
		WithArgs(episodeID, int32(0), sql.NullInt32{}, "published", sql.NullTime{Time: scheduledAt, Valid: true}, sqlmock.AnyArg(), tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "tenant_id", "announced_at"}).
			AddRow(episodeID, int32(0), nil, "published", scheduledAt, now, tenantID, nil))
	expectBakeSeriesCreatorsOntoEpisode(mock, tenantID, seriesID, episodeID)
	expectResolvedEpisodePurchaseAvailability(mock, tenantID, episodeID, "all")
	expectEpisodePublishedNotification(mock, tenantID, episodeID, now)
	expectCatalogIndexSync(mock, tenantID, "series", seriesID)
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.InsertAuditLog)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.CreateEpisodeRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:    testSeriesID.String(),
		Title:       "Episode 1",
		OrderIndex:  1,
		ScheduledAt: scheduledAt.Format(time.RFC3339),
	}

	resp, err := client.CreateEpisode(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	if resp.Episode.Status != "published" {
		t.Fatalf("episode status = %q, want published", resp.Episode.Status)
	}
	if resp.Episode.PublishedAt == "" {
		t.Fatal("episode published_at is empty")
	}
	if resp.Episode.ScheduledAt != scheduledAt.Format(time.RFC3339) {
		t.Fatalf("episode scheduled_at = %q, want %q", resp.Episode.ScheduledAt, scheduledAt.Format(time.RFC3339))
	}
	// Publishing the episode changes the series lists as well as its series'
	// page: their order by latest update, and their free-episode counts.
	revalidations.waitForTags(t, wantEpisodePublicationRevalidateTags(tenantID))
	assertExpectations(t, mock)
}

// expectEpisodePublishedNotification expects the outbox event that tells the
// followers of an episode the console published at once.
func expectEpisodePublishedNotification(mock sqlmock.Sqlmock, tenantID, episodeID uuid.UUID, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
		WithArgs(
			sqlmock.AnyArg(),
			uuid.NullUUID{UUID: tenantID, Valid: true},
			outbox.EventTypeEpisodePublishedNotification,
			sqlmock.AnyArg(),
			outbox.EpisodePublishedIdempotencyKey(episodeID),
			sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "event_type", "payload", "idempotency_key",
			"status", "attempts", "available_at", "last_error", "created_at", "updated_at", "progress_cursor",
		}).AddRow(
			uuid.Must(uuid.NewV7()),
			uuid.NullUUID{UUID: tenantID, Valid: true},
			outbox.EventTypeEpisodePublishedNotification,
			json.RawMessage("{}"),
			outbox.EpisodePublishedIdempotencyKey(episodeID),
			"pending", int32(0), now, nil, now, now, nil,
		))
}

// An unset order_index appends after the current last episode, so the client
// does not have to read every page of ListEpisodes to find the end.
func TestCreateEpisodeAppendsWhenOrderIndexUnset(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := testSeriesID
	episodeID := testEpisodeID
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectBegin()
	expectLockSeriesByID(mock, tenantID, testSeriesID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetMaxEpisodeOrderIndexBySeriesForTenant)).
		WithArgs(tenantID, testSeriesID).
		WillReturnRows(sqlmock.NewRows([]string{"max_order_index"}).AddRow(int32(30)))
	expectCreateEpisodeBaseInsert(mock, seriesID, episodeID, tenantID, "Episode 31", int32(31), now, "EP031")
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertEpisodeListing)).
		WithArgs(episodeID, int32(0), sql.NullInt32{}, "draft", sql.NullTime{}, sql.NullTime{}, tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "tenant_id", "announced_at"}).
			AddRow(episodeID, int32(0), nil, "draft", nil, nil, tenantID, nil))
	expectBakeSeriesCreatorsOntoEpisode(mock, tenantID, seriesID, episodeID)
	expectResolvedEpisodePurchaseAvailability(mock, tenantID, episodeID, "all")
	mock.ExpectCommit()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.InsertAuditLog)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.CreateEpisodeRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId: testSeriesID.String(),
		Title:    "Episode 31",
	}

	resp, err := client.CreateEpisode(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	if resp.Episode.OrderIndex != 31 {
		t.Fatalf("order_index = %d, want max_order_index + 1", resp.Episode.OrderIndex)
	}
	assertExpectations(t, mock)
}

func TestCreateEpisodeRollsBackWhenListingInsertFails(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := testSeriesID
	episodeID := testEpisodeID
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectBegin()
	expectLockSeriesByID(mock, tenantID, testSeriesID)
	expectCreateEpisodeBaseInsert(mock, seriesID, episodeID, tenantID, "Episode 1", int32(1), now, "EP001")
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertEpisodeListing)).
		WithArgs(episodeID, int32(0), sql.NullInt32{}, "draft", sql.NullTime{}, sql.NullTime{}, tenantID).
		WillReturnError(errors.New("listing insert failed"))
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.CreateEpisodeRequest{
		Tenant:     &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:   testSeriesID.String(),
		Title:      "Episode 1",
		OrderIndex: 1,
	}

	_, err := client.CreateEpisode(testutil.WithBearer(context.Background(), sessionToken), req)
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
				Tenant:     &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:   testSeriesID.String(),
				Title:      "  ",
				OrderIndex: 1,
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "invalid-scheduled-at",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:      &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:    testSeriesID.String(),
				Title:       "Episode",
				OrderIndex:  1,
				ScheduledAt: "invalid-date",
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "negative-order-index",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:     &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:   testSeriesID.String(),
				Title:      "Episode",
				OrderIndex: -1,
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "series-cross-tenant-or-not-found",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:     &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:   testOtherSeriesID.String(),
				Title:      "Episode",
				OrderIndex: 1,
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				mock.ExpectBegin()
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockSeriesByIDForTenant)).
					WithArgs(tenantID, testOtherSeriesID).
					WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}))
				mock.ExpectRollback()
			},
			wantCode: connect.CodeNotFound,
		},
		{
			name: "order-index-limit",
			request: &publiraadminv1.CreateEpisodeRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId: testSeriesID.String(),
				Title:    "Episode",
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				mock.ExpectBegin()
				expectLockSeriesByID(mock, tenantID, testSeriesID)
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetMaxEpisodeOrderIndexBySeriesForTenant)).
					WithArgs(tenantID, testSeriesID).
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

			client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			req := tc.request

			_, err := client.CreateEpisode(testutil.WithBearer(context.Background(), sessionToken), req)
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
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := []uuid.UUID{episodeTestID(1), episodeTestID(2), episodeTestID(3)}
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	expectLockSeriesByID(mock, tenantID, testSeriesID)
	expectListEpisodesBySeries(mock, tenantID, testSeriesID, addEpisodeRow(
		addEpisodeRow(
			addEpisodeRow(episodeColumns(), ids[0], "EP001", 1),
			ids[1], "EP002", 2,
		),
		ids[2], "EP003", 3,
	))
	expectUpdateEpisodeOrderIndex(mock, tenantID, testSeriesID, episodeTestID(3), 1)
	expectUpdateEpisodeOrderIndex(mock, tenantID, testSeriesID, episodeTestID(2), 2)
	expectUpdateEpisodeOrderIndex(mock, tenantID, testSeriesID, episodeTestID(1), 3)
	expectListEpisodesBySeries(mock, tenantID, testSeriesID, addEpisodeRow(
		addEpisodeRow(
			addEpisodeRow(episodeColumns(), ids[2], "EP003", 1),
			ids[1], "EP002", 2,
		),
		ids[0], "EP001", 3,
	))
	mock.ExpectCommit()

	req := &publiraadminv1.ReorderEpisodesRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:           testSeriesID.String(),
		EpisodeIds:         []string{episodeTestID(3).String(), episodeTestID(2).String(), episodeTestID(1).String()},
		ExpectedEpisodeIds: []string{episodeTestID(1).String(), episodeTestID(2).String(), episodeTestID(3).String()},
	}

	resp, err := client.ReorderEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ReorderEpisodes: %v", err)
	}
	if !slices.Equal(episodePublicIDs(resp.Episodes), []string{"EP003", "EP002", "EP001"}) {
		t.Fatalf("episodes = %v, want reversed order", episodePublicIDs(resp.Episodes))
	}
	assertExpectations(t, mock)
}

func TestReorderEpisodesRejectsStaleExpectedOrder(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := []uuid.UUID{episodeTestID(1), episodeTestID(2), episodeTestID(3)}
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	expectLockSeriesByID(mock, tenantID, testSeriesID)
	// The client still thinks the series is EP001, EP002, EP003, but another
	// write has already swapped the first two.
	expectListEpisodesBySeries(mock, tenantID, testSeriesID, addEpisodeRow(
		addEpisodeRow(
			addEpisodeRow(episodeColumns(), ids[1], "EP002", 1),
			ids[0], "EP001", 2,
		),
		ids[2], "EP003", 3,
	))
	mock.ExpectRollback()

	req := &publiraadminv1.ReorderEpisodesRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:           testSeriesID.String(),
		EpisodeIds:         []string{episodeTestID(3).String(), episodeTestID(2).String(), episodeTestID(1).String()},
		ExpectedEpisodeIds: []string{episodeTestID(1).String(), episodeTestID(2).String(), episodeTestID(3).String()},
	}

	_, err := client.ReorderEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ReorderEpisodes code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeFailedPrecondition, err)
	}
	assertExpectations(t, mock)
}

func TestReorderEpisodesRollsBackWhenUpdateFails(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := []uuid.UUID{episodeTestID(1), episodeTestID(2)}
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	expectLockSeriesByID(mock, tenantID, testSeriesID)
	expectListEpisodesBySeries(mock, tenantID, testSeriesID, addEpisodeRow(
		addEpisodeRow(episodeColumns(), ids[0], "EP001", 1),
		ids[1], "EP002", 2,
	))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.UpdateEpisodeOrderIndexByIDForTenantAndSeries)).
		WithArgs(int32(1), tenantID, testSeriesID, episodeTestID(2)).
		WillReturnError(errors.New("order update failed"))
	mock.ExpectRollback()

	req := &publiraadminv1.ReorderEpisodesRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:           testSeriesID.String(),
		EpisodeIds:         []string{episodeTestID(2).String(), episodeTestID(1).String()},
		ExpectedEpisodeIds: []string{episodeTestID(1).String(), episodeTestID(2).String()},
	}

	_, err := client.ReorderEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
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
				Tenant:     &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:   testSeriesID.String(),
				EpisodeIds: []string{episodeTestID(1).String()},
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "not-a-permutation",
			request: &publiraadminv1.ReorderEpisodesRequest{
				Tenant:             &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:           testSeriesID.String(),
				EpisodeIds:         []string{episodeTestID(1).String(), episodeTestID(2).String()},
				ExpectedEpisodeIds: []string{episodeTestID(1).String(), episodeTestID(3).String()},
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "duplicate-desired",
			request: &publiraadminv1.ReorderEpisodesRequest{
				Tenant:             &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:           testSeriesID.String(),
				EpisodeIds:         []string{episodeTestID(1).String(), episodeTestID(1).String()},
				ExpectedEpisodeIds: []string{episodeTestID(1).String(), episodeTestID(2).String()},
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "series-not-found",
			request: &publiraadminv1.ReorderEpisodesRequest{
				Tenant:             &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:           testOtherSeriesID.String(),
				EpisodeIds:         []string{episodeTestID(1).String()},
				ExpectedEpisodeIds: []string{episodeTestID(1).String()},
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
				mock.ExpectBegin()
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockSeriesByIDForTenant)).
					WithArgs(tenantID, testOtherSeriesID).
					WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}))
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

			req := tc.request
			_, err := client.ReorderEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
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
	episodeID := testEpisodeID
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	expectEpisodeSeriesLookup(mock, tenantID, episodeID, testSeriesID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetMaxEpisodeImageDisplayOrderByEpisodeID)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"max_display_order"}).AddRow(int32(0)))

	// First image (1x1 PNG)
	image1ID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImage)).
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(image1ID, tenantID, episodeID, int32(1), now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImageVariant)).
		WithArgs(sqlmock.AnyArg(), tenantID, image1ID, "w1", "s3", sqlmock.AnyArg(), "image/png", int64(67), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), image1ID, "w1", "s3", "obj-1", "image/png", int64(67), int32(1), int32(1), now, tenantID))
	expectAdminAuditLogInsert(mock)

	// Second image (1x1 JPEG)
	image2ID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImage)).
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(image2ID, tenantID, episodeID, int32(2), now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImageVariant)).
		WithArgs(sqlmock.AnyArg(), tenantID, image2ID, "w1", "s3", sqlmock.AnyArg(), "image/jpeg", int64(163), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), image2ID, "w1", "s3", "obj-2", "image/jpeg", int64(163), int32(1), int32(1), now, tenantID))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "001.png", ContentType: "image/png", Data: oneByOnePNG, DisplayOrder: 0},
			{Filename: "002.jpg", ContentType: "image/jpeg", Data: oneByOneJPEG, DisplayOrder: 1},
		},
	}

	resp, err := client.UploadEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("UploadEpisodeImages: %v", err)
	}
	if len(resp.Images) != 2 {
		t.Fatalf("images count = %d, want 2", len(resp.Images))
	}
	if resp.Images[0].Width != 1 || resp.Images[0].Height != 1 {
		t.Fatalf("first image size = %dx%d, want 1x1", resp.Images[0].Width, resp.Images[0].Height)
	}
	if resp.Images[1].Width != 1 || resp.Images[1].Height != 1 {
		t.Fatalf("second image size = %dx%d, want 1x1", resp.Images[1].Width, resp.Images[1].Height)
	}
	assertAdminMediaToken(t, resp.Images[0].ImageUrl, tenantID, episodeID, 1)
	assertAdminMediaToken(t, resp.Images[1].ImageUrl, tenantID, episodeID, 1)
	assertExpectations(t, mock)
}

func TestListEpisodeImagesAttachesAdminMediaToken(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := testEpisodeID
	imageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByIDForTenant)).
		WithArgs(tenantID, testEpisodeID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "reading_direction", "spread_start_index", "series_reading_direction", "series_spread_start_index", "availability", "purchase_availability", "resolved_purchase_availability", "series_id"}).
			AddRow(episodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "draft", nil, nil, nil, nil, nil, nil, nil, nil, "all", uuid.Must(uuid.NewV7())))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeImagesByEpisodeID)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at", "content_type", "file_size_bytes", "width", "height"}).
			AddRow(imageID, tenantID, episodeID, int32(1), now, "image/jpeg", int64(2048), int32(1600), int32(900)))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.ListEpisodeImagesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
	}

	resp, err := client.ListEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListEpisodeImages: %v", err)
	}
	if len(resp.Images) != 1 {
		t.Fatalf("images count = %d, want 1", len(resp.Images))
	}
	assertAdminMediaToken(t, resp.Images[0].ImageUrl, tenantID, episodeID, 1)
	assertExpectations(t, mock)
}

func TestReorderEpisodeImagesAttachesAdminMediaToken(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := testEpisodeID
	image1ID := uuid.Must(uuid.NewV7())
	image2ID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	imageColumns := []string{"id", "tenant_id", "episode_id", "display_order", "created_at", "content_type", "file_size_bytes", "width", "height"}
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByIDForTenant)).
		WithArgs(tenantID, testEpisodeID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "reading_direction", "spread_start_index", "series_reading_direction", "series_spread_start_index", "availability", "purchase_availability", "resolved_purchase_availability", "series_id"}).
			AddRow(episodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "draft", nil, nil, nil, nil, nil, nil, nil, nil, "all", uuid.Must(uuid.NewV7())))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeImagesByEpisodeID)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows(imageColumns).
			AddRow(image1ID, tenantID, episodeID, int32(1), now, "image/jpeg", int64(2048), int32(1600), int32(900)).
			AddRow(image2ID, tenantID, episodeID, int32(2), now, "image/jpeg", int64(2048), int32(1600), int32(900)))
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.UpdateEpisodeImageDisplayOrderByIDForEpisode)).
		WithArgs(image2ID, episodeID, int32(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.UpdateEpisodeImageDisplayOrderByIDForEpisode)).
		WithArgs(image1ID, episodeID, int32(2)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeImagesByEpisodeID)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows(imageColumns).
			AddRow(image2ID, tenantID, episodeID, int32(1), now, "image/jpeg", int64(2048), int32(1600), int32(900)).
			AddRow(image1ID, tenantID, episodeID, int32(2), now, "image/jpeg", int64(2048), int32(1600), int32(900)))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.ReorderEpisodeImagesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		ImageIds:  []string{image2ID.String(), image1ID.String()},
	}

	resp, err := client.ReorderEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ReorderEpisodeImages: %v", err)
	}
	if len(resp.Images) != 2 {
		t.Fatalf("images count = %d, want 2", len(resp.Images))
	}
	if resp.Images[0].Id != image2ID.String() || resp.Images[1].Id != image1ID.String() {
		t.Fatalf("image ids = [%s %s], want [%s %s]", resp.Images[0].Id, resp.Images[1].Id, image2ID, image1ID)
	}
	assertAdminMediaToken(t, resp.Images[0].ImageUrl, tenantID, episodeID, 1)
	assertAdminMediaToken(t, resp.Images[1].ImageUrl, tenantID, episodeID, 1)
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
				Tenant:    &publirattypesv1.TenantContext{TenantId: ""},
				EpisodeId: testEpisodeID.String(),
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "episode-not-found",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:    &publirattypesv1.TenantContext{TenantId: ""},
				EpisodeId: testOtherEpisodeID.String(),
				Images:    []*publiraadminv1.EpisodeImageUpload{{Filename: "001.png", ContentType: "image/png", Data: []byte{0x89, 0x50, 0x4e, 0x47}, DisplayOrder: 0}},
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeSeriesByIDForTenant)).
					WithArgs(tenantID, testOtherEpisodeID).
					WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "series_id"}))
			},
			wantCode: connect.CodeNotFound,
		},
		{
			name: "invalid-content-type",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:    &publirattypesv1.TenantContext{TenantId: ""},
				EpisodeId: testEpisodeID.String(),
				Images:    []*publiraadminv1.EpisodeImageUpload{{Filename: "bad.txt", ContentType: "text/plain", Data: oneByOnePNG, DisplayOrder: 0}},
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				expectEpisodeSeriesLookup(mock, tenantID, testEpisodeID, testSeriesID)
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetMaxEpisodeImageDisplayOrderByEpisodeID)).
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

			client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			req := tc.request

			_, err := client.UploadEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req)
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
	episodeID := testEpisodeID
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	expectEpisodeSeriesLookup(mock, tenantID, episodeID, testSeriesID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetMaxEpisodeImageDisplayOrderByEpisodeID)).
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImage)).
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(createdImageID, tenantID, episodeID, int32(1), now))

	for _, variant := range variantSizes {
		mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImageVariant)).
			WithArgs(sqlmock.AnyArg(), tenantID, createdImageID, variant.label, "s3", sqlmock.AnyArg(), "image/jpeg", sqlmock.AnyArg(), variant.width, variant.height).
			WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at", "tenant_id"}).
				AddRow(uuid.Must(uuid.NewV7()), createdImageID, variant.label, "s3", "obj", "image/jpeg", int64(2048), variant.width, variant.height, now, tenantID))
	}
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "landscape.jpg", ContentType: "image/jpeg", Data: generateJPEG(t, 1600, 900), DisplayOrder: 0},
		},
	}

	resp, err := client.UploadEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("UploadEpisodeImages: %v", err)
	}
	if len(resp.Images) != 1 {
		t.Fatalf("images count = %d, want 1", len(resp.Images))
	}
	if resp.Images[0].Width != 1600 || resp.Images[0].Height != 900 {
		t.Fatalf("image size = %dx%d, want 1600x900", resp.Images[0].Width, resp.Images[0].Height)
	}

	assertExpectations(t, mock)
}

func TestUploadEpisodeImagesArchiveSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := testEpisodeID
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	expectEpisodeSeriesLookup(mock, tenantID, episodeID, testSeriesID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetMaxEpisodeImageDisplayOrderByEpisodeID)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"max_display_order"}).AddRow(int32(0)))

	image1ID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImage)).
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(image1ID, tenantID, episodeID, int32(1), now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImageVariant)).
		WithArgs(sqlmock.AnyArg(), tenantID, image1ID, "w1", "s3", sqlmock.AnyArg(), "image/png", int64(67), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), image1ID, "w1", "s3", "obj-1", "image/png", int64(67), int32(1), int32(1), now, tenantID))
	expectAdminAuditLogInsert(mock)

	image2ID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImage)).
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(image2ID, tenantID, episodeID, int32(2), now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImageVariant)).
		WithArgs(sqlmock.AnyArg(), tenantID, image2ID, "w1", "s3", sqlmock.AnyArg(), "image/jpeg", int64(163), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), image2ID, "w1", "s3", "obj-2", "image/jpeg", int64(163), int32(1), int32(1), now, tenantID))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:  testSeriesID.String(),
		EpisodeId: testEpisodeID.String(),
		ArchiveData: makeZipArchive(t,
			archiveEntry{name: "010.jpg", data: oneByOneJPEG},
			archiveEntry{name: "002.png", data: oneByOnePNG},
		),
		ArchiveFilename:    "episode-images.zip",
		ArchiveContentType: "application/zip",
	}

	resp, err := client.UploadEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("UploadEpisodeImages: %v", err)
	}
	if len(resp.Images) != 2 {
		t.Fatalf("images count = %d, want 2", len(resp.Images))
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
				Tenant:      &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:    testSeriesID.String(),
				EpisodeId:   testEpisodeID.String(),
				ArchiveData: []byte("not-a-zip"),
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "invalid-path",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:    &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:  testSeriesID.String(),
				EpisodeId: testEpisodeID.String(),
				ArchiveData: makeZipArchive(t,
					archiveEntry{name: "../001.png", data: oneByOnePNG},
				),
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "series-episode-mismatch",
			request: &publiraadminv1.UploadEpisodeImagesRequest{
				Tenant:    &publirattypesv1.TenantContext{TenantId: ""},
				SeriesId:  testOtherSeriesID.String(),
				EpisodeId: testEpisodeID.String(),
				ArchiveData: makeZipArchive(t,
					archiveEntry{name: "001.png", data: oneByOnePNG},
				),
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				expectEpisodeSeriesLookup(mock, tenantID, testEpisodeID, testSeriesID)
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

			client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			req := tc.request

			_, err := client.UploadEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req)
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
			name:      "future-timezone",
			scheduled: "2030-01-01T10:00:00+09:00",
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				scheduledAt, _ := time.Parse(time.RFC3339, "2030-01-01T10:00:00+09:00")
				normalized := scheduledAt.UTC()
				mock.ExpectBegin()
				mock.ExpectExec(regexp.QuoteMeta(dbmodels.UpdateEpisodePublishScheduleByIDForTenant)).
					WithArgs(sql.NullTime{Time: normalized, Valid: true}, tenantID, testEpisodeID).
					WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByIDForTenant)).
					WithArgs(tenantID, testEpisodeID).
					WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "reading_direction", "spread_start_index", "series_reading_direction", "series_spread_start_index", "availability", "purchase_availability", "resolved_purchase_availability", "series_id"}).
						AddRow(testEpisodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "scheduled", normalized, nil, nil, nil, nil, nil, nil, nil, "all", testSeriesID))
				// Taking a published episode back to a schedule changes what its
				// series' search document says about its episodes.
				expectCatalogIndexSync(mock, tenantID, "series", testSeriesID)
				mock.ExpectCommit()
				mock.ExpectExec(regexp.QuoteMeta(dbmodels.InsertAuditLog)).
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

			client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			req := &publiraadminv1.UpdateEpisodePublishScheduleRequest{
				Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				EpisodeId:   testEpisodeID.String(),
				ScheduledAt: tc.scheduled,
			}

			resp, err := client.UpdateEpisodePublishSchedule(testutil.WithBearer(context.Background(), sessionToken), req)
			if tc.wantSuccess {
				if err != nil {
					t.Fatalf("UpdateEpisodePublishSchedule: %v", err)
				}
				if resp.Episode == nil {
					t.Fatalf("episode is nil")
				}
				if resp.Episode.ScheduledAt != "2030-01-01T01:00:00Z" {
					t.Fatalf("scheduled_at = %q, want 2030-01-01T01:00:00Z", resp.Episode.ScheduledAt)
				}
			} else if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("UpdateEpisodePublishSchedule code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

// A time that has already passed publishes a draft or scheduled episode in the
// write that saves it, which owes the storefront's cache drop, the sync of its
// series' search document, and the followers' notice the scheduled publication
// job would otherwise write.
func TestUpdateEpisodePublishSchedulePublishesAtOnceWhenTheTimeHasPassed(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	scheduledAt := now.Add(-time.Hour).Truncate(time.Second)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.PublishEpisodeNowByIDForTenant)).
		WithArgs(scheduledAt, tenantID, testEpisodeID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByIDForTenant)).
		WithArgs(tenantID, testEpisodeID).
		WillReturnRows(sqlmock.NewRows(getEpisodeByIDColumns).
			AddRow(testEpisodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "published", scheduledAt, now, nil, nil, nil, nil, nil, nil, "all", testSeriesID))
	expectEpisodePublishedNotification(mock, tenantID, testEpisodeID, now)
	expectCatalogIndexSync(mock, tenantID, "series", testSeriesID)
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)

	resp, err := client.UpdateEpisodePublishSchedule(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId:   testEpisodeID.String(),
		ScheduledAt: scheduledAt.Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("UpdateEpisodePublishSchedule: %v", err)
	}
	if resp.Episode.Status != "published" || resp.Episode.PublishedAt == "" {
		t.Fatalf("status, published_at = %q, %q, want published and a time", resp.Episode.Status, resp.Episode.PublishedAt)
	}
	revalidations.waitForTags(t, wantEpisodePublicationRevalidateTags(tenantID))
	assertExpectations(t, mock)
}

// A time that has passed leaves an episode that is already published as it
// is, so its followers are not told about it again and nothing is owed.
func TestUpdateEpisodePublishScheduleLeavesAPublishedEpisodeWhenTheTimeHasPassed(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	publishedAt := now.Add(-48 * time.Hour)
	scheduledAt := now.Add(-time.Hour).Truncate(time.Second)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.PublishEpisodeNowByIDForTenant)).
		WithArgs(scheduledAt, tenantID, testEpisodeID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByIDForTenant)).
		WithArgs(tenantID, testEpisodeID).
		WillReturnRows(sqlmock.NewRows(getEpisodeByIDColumns).
			AddRow(testEpisodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "published", publishedAt, publishedAt, nil, nil, nil, nil, nil, nil, "all", testSeriesID))
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)

	resp, err := client.UpdateEpisodePublishSchedule(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId:   testEpisodeID.String(),
		ScheduledAt: scheduledAt.Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("UpdateEpisodePublishSchedule: %v", err)
	}
	if want := publishedAt.Format(time.RFC3339); resp.Episode.Status != "published" || resp.Episode.PublishedAt != want {
		t.Fatalf("status, published_at = %q, %q, want published at %s", resp.Episode.Status, resp.Episode.PublishedAt, want)
	}
	assertExpectations(t, mock)
}

// An id that names no episode is not found whether the time has passed or
// not.
func TestUpdateEpisodePublishScheduleWithAPastTimeReportsAMissingEpisode(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	scheduledAt := now.Add(-time.Hour).Truncate(time.Second)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.PublishEpisodeNowByIDForTenant)).
		WithArgs(scheduledAt, tenantID, testEpisodeID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByIDForTenant)).
		WithArgs(tenantID, testEpisodeID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	_, err := client.UpdateEpisodePublishSchedule(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId:   testEpisodeID.String(),
		ScheduledAt: scheduledAt.Format(time.RFC3339),
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateEpisodePublishSchedule code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	assertExpectations(t, mock)
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
		"availability",
	})
}

// episodeDetailColumns is the row of the admin episode reads that carry a
// layout: the list columns, the episode's overrides, and its series' values.
func episodeDetailColumns() *sqlmock.Rows {
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
		"reading_direction",
		"spread_start_index",
		"series_reading_direction",
		"series_spread_start_index",
		"availability",
		"purchase_availability",
		"resolved_purchase_availability",
	})
}

func addEpisodeRow(rows *sqlmock.Rows, id uuid.UUID, publicID string, orderIndex int32) *sqlmock.Rows {
	return rows.AddRow(id, publicID, "Episode "+publicID, orderIndex, int32(100), nil, "draft", nil, nil, nil)
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
	return publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL))), mock, sessionToken
}

func newListEpisodesRequest(tenantID uuid.UUID) *publiraadminv1.ListEpisodesRequest {
	req := &publiraadminv1.ListEpisodesRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId: testSeriesID.String(),
	}
	return req
}

func episodePublicIDs(items []*publirattypesv1.Episode) []string {
	publicIDs := make([]string, 0, len(items))
	for _, item := range items {
		publicIDs = append(publicIDs, item.PublicId)
	}
	return publicIDs
}

// episodeTestListKey names the episode list of SERIES001, the series every list
// request here asks for.
var episodeTestListKey = pagination.NewListKey("order_index_asc").Value("series_id", testSeriesID.String())

func encodeEpisodeTestToken(direction pagination.Direction, orderIndex int32, id uuid.UUID) string {
	return episodeTestListKey.Encode(direction, strconv.FormatInt(int64(orderIndex), 10), id.String())
}

func encodeEpisodeTestRecoveryToken(direction pagination.Direction, orderIndex int32, id uuid.UUID) string {
	return episodeTestListKey.Encode(direction, strconv.FormatInt(int64(orderIndex), 10), id.String(), "inclusive")
}

func TestListEpisodesFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodesBySeriesForTenantAsc)).
		WithArgs(tenantID, testSeriesID, uuid.NullUUID{}, false, sql.NullInt32{}, int32(3)).
		WillReturnRows(addEpisodeRow(
			addEpisodeRow(
				addEpisodeRow(episodeColumns(), ids[0], "EP001", 1),
				ids[1], "EP002", 2,
			),
			ids[2], "EP003", 3,
		))

	req := newListEpisodesRequest(tenantID)
	req.Limit = 2
	resp, err := client.ListEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if !slices.Equal(episodePublicIDs(resp.Episodes), []string{"EP001", "EP002"}) {
		t.Fatalf("public_ids = %v, want the over-fetched row dropped", episodePublicIDs(resp.Episodes))
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantKeys := []string{"order_index_asc+series_id:" + testSeriesID.String(), "2", ids[1].String()}
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodesBySeriesForTenantAsc)).
		WithArgs(tenantID, testSeriesID, uuid.NullUUID{}, false, sql.NullInt32{}, int32(21)).
		WillReturnRows(addEpisodeRow(episodeColumns(), uuid.Must(uuid.NewV7()), "EP001", 1))

	resp, err := client.ListEpisodes(testutil.WithBearer(context.Background(), sessionToken), newListEpisodesRequest(tenantID))
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if len(resp.Episodes) != 1 {
		t.Fatalf("episodes = %d rows, want 1", len(resp.Episodes))
	}
	if resp.PreviousToken != "" || resp.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.PreviousToken, resp.NextToken)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodesBySeriesForTenantAsc)).
		WithArgs(tenantID, testSeriesID, boundaryID, false, int32(2), int32(3)).
		WillReturnRows(addEpisodeRow(episodeColumns(), uuid.Must(uuid.NewV7()), "EP003", 3))

	req := newListEpisodesRequest(tenantID)
	req.Limit = 2
	req.Token = encodeEpisodeTestToken(pagination.Forward, 2, boundaryID)
	resp, err := client.ListEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if !slices.Equal(episodePublicIDs(resp.Episodes), []string{"EP003"}) {
		t.Fatalf("public_ids = %v, want the page after the boundary row", episodePublicIDs(resp.Episodes))
	}
	if resp.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListEpisodesFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodesBySeriesForTenantDesc)).
		WithArgs(tenantID, testSeriesID, boundaryID, false, int32(3), int32(3)).
		WillReturnRows(addEpisodeRow(
			addEpisodeRow(episodeColumns(), uuid.Must(uuid.NewV7()), "EP002", 2),
			uuid.Must(uuid.NewV7()), "EP001", 1,
		))

	req := newListEpisodesRequest(tenantID)
	req.Limit = 2
	req.Token = encodeEpisodeTestToken(pagination.Backward, 3, boundaryID)
	resp, err := client.ListEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if !slices.Equal(episodePublicIDs(resp.Episodes), []string{"EP001", "EP002"}) {
		t.Fatalf("public_ids = %v, want backward page restored to ascending order", episodePublicIDs(resp.Episodes))
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.PreviousToken)
	}
	if resp.NextToken == "" {
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
			wantQuery:             dbmodels.ListEpisodesBySeriesForTenantAsc,
			wantRecoveryQuery:     dbmodels.ListEpisodesBySeriesForTenantDesc,
			wantRecoveredEpisodes: []string{"EP001", "EP002"},
		},
		{
			name:                  "backward",
			direction:             pagination.Backward,
			wantQuery:             dbmodels.ListEpisodesBySeriesForTenantDesc,
			wantRecoveryQuery:     dbmodels.ListEpisodesBySeriesForTenantAsc,
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
				WithArgs(tenantID, testSeriesID, boundaryID, false, int32(2), int32(21)).
				WillReturnRows(episodeColumns())

			req := newListEpisodesRequest(tenantID)
			req.Token = encodeEpisodeTestToken(test.direction, 2, boundaryID)
			resp, err := client.ListEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
			if err != nil {
				t.Fatalf("ListEpisodes: %v", err)
			}
			recoveryToken := resp.PreviousToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.NextToken
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
				WithArgs(tenantID, testSeriesID, boundaryID, true, int32(2), int32(21)).
				WillReturnRows(recoveryRows)

			recoveryReq := newListEpisodesRequest(tenantID)
			recoveryReq.Token = recoveryToken
			recovered, err := client.ListEpisodes(testutil.WithBearer(context.Background(), sessionToken), recoveryReq)
			if err != nil {
				t.Fatalf("ListEpisodes recovery: %v", err)
			}
			if !slices.Equal(episodePublicIDs(recovered.Episodes), test.wantRecoveredEpisodes) {
				t.Fatalf("recovered public_ids = %v, want %v", episodePublicIDs(recovered.Episodes), test.wantRecoveredEpisodes)
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
			wantQuery: dbmodels.ListEpisodesBySeriesForTenantDesc,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: dbmodels.ListEpisodesBySeriesForTenantAsc,
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
				WithArgs(tenantID, testSeriesID, boundaryID, true, int32(2), int32(21)).
				WillReturnRows(episodeColumns())

			req := newListEpisodesRequest(tenantID)
			req.Token = encodeEpisodeTestRecoveryToken(test.direction, 2, boundaryID)
			resp, err := client.ListEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
			if err != nil {
				t.Fatalf("ListEpisodes: %v", err)
			}
			if len(resp.Episodes) != 0 {
				t.Fatalf("episodes = %d rows, want an empty page", len(resp.Episodes))
			}
			if resp.PreviousToken != "" || resp.NextToken != "" {
				t.Fatalf(
					"previous_token = %q / next_token = %q, want both empty once recovery also came back empty",
					resp.PreviousToken, resp.NextToken,
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
			token: episodeTestListKey.Encode(pagination.Forward, "second", uuid.Must(uuid.NewV7()).String()),
		},
		{
			name:  "trailing key is not the inclusive marker",
			token: episodeTestListKey.Encode(pagination.Forward, "2", uuid.Must(uuid.NewV7()).String(), "exclusive"),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

			req := newListEpisodesRequest(tenantID)
			req.Token = test.token
			_, err := client.ListEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
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

func TestListEpisodesRejectsAnotherSeriesToken(t *testing.T) {
	otherSeries := pagination.NewListKey("order_index_asc").Value("series_id", uuid.Must(uuid.NewV7()).String())
	boundaryID := uuid.Must(uuid.NewV7())
	tests := map[string]string{
		"boundary":        otherSeries.Encode(pagination.Forward, "2", boundaryID.String()),
		"recovery":        otherSeries.Encode(pagination.Backward, "2", boundaryID.String(), "inclusive"),
		"no series named": pagination.Encode(pagination.Forward, "2", boundaryID.String()),
	}

	for name, token := range tests {
		t.Run(name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

			req := newListEpisodesRequest(tenantID)
			req.Token = token
			_, err := client.ListEpisodes(testutil.WithBearer(context.Background(), sessionToken), req)
			if err == nil || err.Error() != "invalid_argument: token was issued for another filter" {
				t.Fatalf("ListEpisodes with another series' token error = %v, want invalid_argument", err)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodesBySeriesForTenantAsc)).
		WithArgs(tenantID, testSeriesID, uuid.NullUUID{}, false, sql.NullInt32{}, int32(21)).
		WillReturnError(errors.New(`pq: relation "episodes" does not exist`))

	_, err := client.ListEpisodes(testutil.WithBearer(context.Background(), sessionToken), newListEpisodesRequest(tenantID))
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
		// The layout the episode is read in, and the overrides it states.
		wantReadingDirection         publirattypesv1.ReadingDirection
		wantSpreadStartIndex         int32
		wantReadingDirectionOverride publirattypesv1.ReadingDirection
		wantSpreadStartIndexOverride *int32
	}{
		{
			name:           "draft",
			seriesPublicID: "SERIES001",
			publicID:       "EPISODE001",
			// An episode stating nothing is read in its series' layout.
			rows: episodeDetailColumns().AddRow(
				uuid.Must(uuid.NewV7()), "EPISODE001", "Draft Episode", int32(1), int32(0), nil, "draft", nil, nil,
				nil, nil, "ltr", int32(0),
				nil,
				nil,
				"all",
			),
			wantPublicID:         "EPISODE001",
			wantStatus:           "draft",
			wantReadingDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT,
			wantSpreadStartIndex: 0,
		},
		{
			name:           "scheduled",
			seriesPublicID: "SERIES001",
			publicID:       "EPISODE002",
			// An episode stating both is read in its own layout, whatever its
			// series says.
			rows: episodeDetailColumns().AddRow(
				uuid.Must(uuid.NewV7()), "EPISODE002", "Scheduled Episode", int32(2), int32(100), int32(24), "scheduled", scheduledAt, nil,
				"ltr", int32(0), "rtl", int32(1),
				nil,
				nil,
				"all",
			),
			wantPublicID:                 "EPISODE002",
			wantStatus:                   "scheduled",
			wantScheduledAt:              "2030-01-01T01:00:00Z",
			wantReadingDirection:         publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT,
			wantSpreadStartIndex:         0,
			wantReadingDirectionOverride: publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT,
			wantSpreadStartIndexOverride: new(int32),
		},
		{
			name:           "cross-tenant",
			seriesPublicID: "SERIES_OTHER",
			publicID:       "EPISODE_OTHER",
			rows:           episodeDetailColumns(),
			wantCode:       connect.CodeNotFound,
		},
		{
			name:           "not-found",
			seriesPublicID: "SERIES001",
			publicID:       "EPISODE_MISSING",
			rows:           episodeDetailColumns(),
			wantCode:       connect.CodeNotFound,
		},
		{
			name:           "wrong-series",
			seriesPublicID: "SERIES_OTHER",
			publicID:       "EPISODE001",
			rows:           episodeDetailColumns(),
			wantCode:       connect.CodeNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByPublicIDForTenantAndSeries)).
				WithArgs(tenantID, tc.seriesPublicID, tc.publicID).
				WillReturnRows(tc.rows)

			req := &publiraadminv1.GetEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				SeriesPublicId: tc.seriesPublicID,
				PublicId:       tc.publicID,
			}

			resp, err := client.GetEpisode(testutil.WithBearer(context.Background(), sessionToken), req)
			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("GetEpisode: %v", err)
				}
				if resp.Episode == nil {
					t.Fatal("episode is nil")
				}
				if resp.Episode.PublicId != tc.wantPublicID {
					t.Fatalf("public_id = %q, want %q", resp.Episode.PublicId, tc.wantPublicID)
				}
				if resp.Episode.Status != tc.wantStatus {
					t.Fatalf("status = %q, want %q", resp.Episode.Status, tc.wantStatus)
				}
				if resp.Episode.ScheduledAt != tc.wantScheduledAt {
					t.Fatalf("scheduled_at = %q, want %q", resp.Episode.ScheduledAt, tc.wantScheduledAt)
				}
				if resp.Episode.ReadingDirection != tc.wantReadingDirection || resp.Episode.SpreadStartIndex != tc.wantSpreadStartIndex {
					t.Fatalf("layout = %v from %d, want %v from %d", resp.Episode.ReadingDirection, resp.Episode.SpreadStartIndex, tc.wantReadingDirection, tc.wantSpreadStartIndex)
				}
				if resp.ReadingDirection != tc.wantReadingDirectionOverride {
					t.Fatalf("reading_direction override = %v, want %v", resp.ReadingDirection, tc.wantReadingDirectionOverride)
				}
				if (resp.SpreadStartIndex == nil) != (tc.wantSpreadStartIndexOverride == nil) ||
					(resp.SpreadStartIndex != nil && *resp.SpreadStartIndex != *tc.wantSpreadStartIndexOverride) {
					t.Fatalf("spread_start_index override = %v, want %v", resp.SpreadStartIndex, tc.wantSpreadStartIndexOverride)
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

			req := &publiraadminv1.GetEpisodeRequest{
				Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				SeriesPublicId: tc.seriesPublicID,
				PublicId:       tc.publicID,
			}

			_, err := client.GetEpisode(testutil.WithBearer(context.Background(), sessionToken), req)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByPublicIDForTenantAndSeries)).
		WithArgs(tenantID, "SERIES001", "EPISODE001").
		WillReturnError(errors.New(`pq: relation "episodes" does not exist`))

	req := &publiraadminv1.GetEpisodeRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId: "SERIES001",
		PublicId:       "EPISODE001",
	}

	_, err := client.GetEpisode(testutil.WithBearer(context.Background(), sessionToken), req)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByPublicIDForTenantAndSeries)).
		WithArgs(tenantID, "SERIES001", "EPISODE001").
		WillReturnError(context.Canceled)

	req := &publiraadminv1.GetEpisodeRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId: "SERIES001",
		PublicId:       "EPISODE001",
	}

	_, err := client.GetEpisode(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeCanceled {
		t.Fatalf("GetEpisode code = %v, want %v", connect.CodeOf(err), connect.CodeCanceled)
	}
	assertExpectations(t, mock)
}

// unconfiguredStorageProvider answers every upload the way a platform with no
// object store saved does, and counts how often it was asked.
type unconfiguredStorageProvider struct{ calls atomic.Int32 }

func (p *unconfiguredStorageProvider) Upload(context.Context, storage.UploadRequest) (storage.UploadResult, error) {
	p.calls.Add(1)
	return storage.UploadResult{}, storage.ErrNotConfigured
}

// No retry saves an upload on a platform with no object store, so the first
// refusal ends the request and says which state the platform is in.
func TestUploadEpisodeImagesWithoutPlatformStorage(t *testing.T) {
	provider := &unconfiguredStorageProvider{}
	testServer, mock := newTestAdminServerWithStorage(t, provider)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := testEpisodeID
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	expectEpisodeSeriesLookup(mock, tenantID, episodeID, testSeriesID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetMaxEpisodeImageDisplayOrderByEpisodeID)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"max_display_order"}).AddRow(int32(0)))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImage)).
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, episodeID, int32(1), now))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "page.jpg", ContentType: "image/jpeg", Data: generateJPEG(t, 480, 270), DisplayOrder: 0},
		},
	}

	_, err := client.UploadEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UploadEpisodeImages error = %v, want %v", err, connect.CodeFailedPrecondition)
	}
	if calls := provider.calls.Load(); calls != 1 {
		t.Fatalf("uploads attempted = %d, want 1", calls)
	}
	assertExpectations(t, mock)
}

// pinningStorageProvider answers Pin with a store of its own and refuses an
// upload that did not go through it, the way a switch of the platform's store
// between two variants would otherwise split one image across two buckets.
type pinningStorageProvider struct {
	pins   atomic.Int32
	pinned recordingStorageProvider
}

func (p *pinningStorageProvider) Upload(context.Context, storage.UploadRequest) (storage.UploadResult, error) {
	return storage.UploadResult{}, errors.New("upload did not go through the pinned store")
}

func (p *pinningStorageProvider) Pin(context.Context) (storage.Provider, error) {
	p.pins.Add(1)
	return &p.pinned, nil
}

func TestUploadEpisodeImagesWritesEveryVariantToOnePinnedStore(t *testing.T) {
	provider := &pinningStorageProvider{}
	testServer, mock := newTestAdminServerWithStorage(t, provider)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := testEpisodeID
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	expectEpisodeSeriesLookup(mock, tenantID, episodeID, testSeriesID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetMaxEpisodeImageDisplayOrderByEpisodeID)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"max_display_order"}).AddRow(int32(0)))

	createdImageID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImage)).
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(createdImageID, tenantID, episodeID, int32(1), now))
	for _, variant := range []struct {
		label         string
		width, height int32
	}{{"w480", 480, 270}, {"w960", 960, 540}, {"w1440", 1440, 810}, {"w1600", 1600, 900}} {
		mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImageVariant)).
			WithArgs(sqlmock.AnyArg(), tenantID, createdImageID, variant.label, "s3", sqlmock.AnyArg(), "image/jpeg", sqlmock.AnyArg(), variant.width, variant.height).
			WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at", "tenant_id"}).
				AddRow(uuid.Must(uuid.NewV7()), createdImageID, variant.label, "s3", "obj", "image/jpeg", int64(2048), variant.width, variant.height, now, tenantID))
	}
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "landscape.jpg", ContentType: "image/jpeg", Data: generateJPEG(t, 1600, 900), DisplayOrder: 0},
		},
	}

	if _, err := client.UploadEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req); err != nil {
		t.Fatalf("UploadEpisodeImages: %v", err)
	}
	if pins := provider.pins.Load(); pins != 1 {
		t.Fatalf("pins = %d, want one for the whole upload", pins)
	}
	if uploads := len(provider.pinned.recorded()); uploads != 4 {
		t.Fatalf("uploads to the pinned store = %d, want all 4 variants", uploads)
	}
	assertExpectations(t, mock)
}
