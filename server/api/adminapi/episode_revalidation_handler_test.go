package adminapi

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// wantEpisodeRevalidateTags is what a write to what an episode holds drops: the
// series detail every cached episode read and series page carries.
func wantEpisodeRevalidateTags(tenantID uuid.UUID) []string {
	return []string{"tenant:" + tenantID.String() + ":series:detail"}
}

// wantEpisodePublicationRevalidateTags is what a write to whether, and where,
// an episode is readable drops: the series detail and the series lists, sorted
// the way the recorder reports them.
func wantEpisodePublicationRevalidateTags(tenantID uuid.UUID) []string {
	return []string{
		"tenant:" + tenantID.String() + ":series:detail",
		"tenant:" + tenantID.String() + ":series:list",
	}
}

var getEpisodeByIDColumns = []string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "reading_direction", "spread_start_index", "series_reading_direction", "series_spread_start_index", "availability", "purchase_availability", "resolved_purchase_availability", "series_id"}

func expectPublishedEpisodeLookup(mock sqlmock.Sqlmock, tenantID uuid.UUID, availability any) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByIDForTenant)).
		WithArgs(tenantID, testEpisodeID).
		WillReturnRows(sqlmock.NewRows(getEpisodeByIDColumns).
			AddRow(testEpisodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "published", nil, time.Now().UTC(), nil, nil, nil, nil, availability, nil, "all", testSeriesID))
}

// The series page lists the episodes in their order and numbers them by it, so
// a reorder drops it in the transaction that writes the order.
func TestReorderEpisodesRevalidatesTheSeriesDetail(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
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
	expectUpdateEpisodeOrderIndex(mock, tenantID, testSeriesID, ids[1], 1)
	expectUpdateEpisodeOrderIndex(mock, tenantID, testSeriesID, ids[0], 2)
	expectListEpisodesBySeries(mock, tenantID, testSeriesID, addEpisodeRow(
		addEpisodeRow(episodeColumns(), ids[1], "EP002", 1),
		ids[0], "EP001", 2,
	))
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()

	req := &publiraadminv1.ReorderEpisodesRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:           testSeriesID.String(),
		EpisodeIds:         []string{ids[1].String(), ids[0].String()},
		ExpectedEpisodeIds: []string{ids[0].String(), ids[1].String()},
	}

	if _, err := client.ReorderEpisodes(testutil.WithBearer(context.Background(), sessionToken), req); err != nil {
		t.Fatalf("ReorderEpisodes: %v", err)
	}
	revalidations.waitForTags(t, wantEpisodeRevalidateTags(tenantID))
	assertExpectations(t, mock)
}

// Pages added to an episode that is already out are read from the cached
// viewer until something drops it.
func TestUploadEpisodeImagesRevalidatesTheSeriesDetail(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := testEpisodeID
	imageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	expectEpisodeSeriesLookup(mock, tenantID, episodeID, testSeriesID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetMaxEpisodeImageDisplayOrderByEpisodeID)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"max_display_order"}).AddRow(int32(0)))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImage)).
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(imageID, tenantID, episodeID, int32(1), now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImageVariant)).
		WithArgs(sqlmock.AnyArg(), tenantID, imageID, "w1", "s3", sqlmock.AnyArg(), "image/png", int64(67), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), imageID, "w1", "s3", "obj-1", "image/png", int64(67), int32(1), int32(1), now, tenantID))
	expectAdminAuditLogInsert(mock)
	expectRevalidationRecord(mock, tenantID)

	req := &publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "001.png", ContentType: "image/png", Data: oneByOnePNG, DisplayOrder: 0},
		},
	}

	if _, err := client.UploadEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req); err != nil {
		t.Fatalf("UploadEpisodeImages: %v", err)
	}
	revalidations.waitForTags(t, wantEpisodeRevalidateTags(tenantID))
	assertExpectations(t, mock)
}

// The pages are stored one by one, so an upload that fails part way leaves the
// pages before the failure on the episode, and they are just as stale in a
// cache as the pages of an upload that succeeded.
func TestUploadEpisodeImagesRevalidatesThePagesStoredBeforeAFailure(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := testEpisodeID
	imageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	expectEpisodeSeriesLookup(mock, tenantID, episodeID, testSeriesID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetMaxEpisodeImageDisplayOrderByEpisodeID)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"max_display_order"}).AddRow(int32(0)))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImage)).
		WithArgs(sqlmock.AnyArg(), tenantID, episodeID, int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at"}).
			AddRow(imageID, tenantID, episodeID, int32(1), now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeImageVariant)).
		WithArgs(sqlmock.AnyArg(), tenantID, imageID, "w1", "s3", sqlmock.AnyArg(), "image/png", int64(67), int32(1), int32(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "episode_image_id", "label", "storage_provider", "object_key", "content_type", "file_size_bytes", "width", "height", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), imageID, "w1", "s3", "obj-1", "image/png", int64(67), int32(1), int32(1), now, tenantID))
	expectAdminAuditLogInsert(mock)
	expectRevalidationRecord(mock, tenantID)

	req := &publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "001.png", ContentType: "image/png", Data: oneByOnePNG, DisplayOrder: 0},
			{Filename: "002.png", ContentType: "image/png", Data: []byte("not an image"), DisplayOrder: 1},
		},
	}

	if _, err := client.UploadEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UploadEpisodeImages code = %v, want invalid_argument for the second page (err=%v)", connect.CodeOf(err), err)
	}
	revalidations.waitForTags(t, wantEpisodeRevalidateTags(tenantID))
	assertExpectations(t, mock)
}

// The viewer shows an episode's pages in their order, so a reorder drops it in
// the transaction that writes the order.
func TestReorderEpisodeImagesRevalidatesTheSeriesDetail(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := testEpisodeID
	image1ID := uuid.Must(uuid.NewV7())
	image2ID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	imageColumns := []string{"id", "tenant_id", "episode_id", "display_order", "created_at", "content_type", "file_size_bytes", "width", "height"}
	expectPublishedEpisodeLookup(mock, tenantID, nil)
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
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeImagesByEpisodeID)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows(imageColumns).
			AddRow(image2ID, tenantID, episodeID, int32(1), now, "image/jpeg", int64(2048), int32(1600), int32(900)).
			AddRow(image1ID, tenantID, episodeID, int32(2), now, "image/jpeg", int64(2048), int32(1600), int32(900)))

	req := &publiraadminv1.ReorderEpisodeImagesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		ImageIds:  []string{image2ID.String(), image1ID.String()},
	}

	if _, err := client.ReorderEpisodeImages(testutil.WithBearer(context.Background(), sessionToken), req); err != nil {
		t.Fatalf("ReorderEpisodeImages: %v", err)
	}
	revalidations.waitForTags(t, wantEpisodeRevalidateTags(tenantID))
	assertExpectations(t, mock)
}

// A schedule saved over a published episode takes it down, which changes the
// series lists as much as publishing it does.
func TestUpdateEpisodePublishScheduleRevalidatesTheSeriesDetailAndLists(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	scheduledAt := now.Add(24 * time.Hour).Truncate(time.Second)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.UpdateEpisodePublishScheduleByIDForTenant)).
		WithArgs(sql.NullTime{Time: scheduledAt, Valid: true}, tenantID, testEpisodeID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeByIDForTenant)).
		WithArgs(tenantID, testEpisodeID).
		WillReturnRows(sqlmock.NewRows(getEpisodeByIDColumns).
			AddRow(testEpisodeID, "EPISODE001", "Episode", int32(1), int32(100), int32(24), "scheduled", scheduledAt, nil, nil, nil, nil, nil, nil, nil, "all", testSeriesID))
	expectCatalogIndexSync(mock, tenantID, "series", testSeriesID)
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)

	req := &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId:   testEpisodeID.String(),
		ScheduledAt: scheduledAt.Format(time.RFC3339),
	}

	if _, err := client.UpdateEpisodePublishSchedule(testutil.WithBearer(context.Background(), sessionToken), req); err != nil {
		t.Fatalf("UpdateEpisodePublishSchedule: %v", err)
	}
	revalidations.waitForTags(t, wantEpisodePublicationRevalidateTags(tenantID))
	assertExpectations(t, mock)
}

// The surfaces an episode is shown on decide where it counts as its series'
// latest episode and as a free one, which the series lists answer with.
func TestUpdateEpisodeAvailabilityRevalidatesTheSeriesDetailAndLists(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	expectPublishedEpisodeLookup(mock, tenantID, nil)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.UpdateEpisodeAvailabilityByIDForTenant)).
		WithArgs(sql.NullString{String: "app", Valid: true}, tenantID, testEpisodeID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectCatalogIndexSync(mock, tenantID, "series", testSeriesID)
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()
	expectPublishedEpisodeLookup(mock, tenantID, "app")
	expectAdminAuditLogInsert(mock)

	req := &publiraadminv1.UpdateEpisodeAvailabilityRequest{
		Tenant:       &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId:    testEpisodeID.String(),
		Availability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
	}

	if _, err := client.UpdateEpisodeAvailability(testutil.WithBearer(context.Background(), sessionToken), req); err != nil {
		t.Fatalf("UpdateEpisodeAvailability: %v", err)
	}
	revalidations.waitForTags(t, wantEpisodePublicationRevalidateTags(tenantID))
	assertExpectations(t, mock)
}

// The series page lists the episodes by title and the viewer heads the body
// with it, so a rename drops them in the transaction that writes it.
func TestUpdateEpisodeTitleRevalidatesTheSeriesDetail(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.UpdateEpisodeTitleByIDForTenant)).
		WithArgs("Episode", tenantID, testEpisodeID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()
	expectPublishedEpisodeLookup(mock, tenantID, nil)
	expectAdminAuditLogInsert(mock)

	req := &publiraadminv1.UpdateEpisodeTitleRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		Title:     "Episode",
	}

	if _, err := client.UpdateEpisodeTitle(testutil.WithBearer(context.Background(), sessionToken), req); err != nil {
		t.Fatalf("UpdateEpisodeTitle: %v", err)
	}
	revalidations.waitForTags(t, wantEpisodeRevalidateTags(tenantID))
	assertExpectations(t, mock)
}

// A rename that reaches no row is not_found, and rolls back before any drop is
// recorded: nothing a cache holds has changed.
func TestUpdateEpisodeTitleOfNoEpisodeIsNotFound(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.UpdateEpisodeTitleByIDForTenant)).
		WithArgs("Episode", tenantID, testEpisodeID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	req := &publiraadminv1.UpdateEpisodeTitleRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		Title:     "Episode",
	}

	if _, err := client.UpdateEpisodeTitle(testutil.WithBearer(context.Background(), sessionToken), req); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateEpisodeTitle error = %v, want not_found", err)
	}
	assertExpectations(t, mock)
}

// The viewer shows the pages that are left, so a delete drops it in the
// transaction that takes the page out.
func TestDeleteEpisodeImageRevalidatesTheSeriesDetail(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	keptID := uuid.Must(uuid.NewV7())
	deletedID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEpisodeClient(t, tenantID, userID, now)

	imageColumns := []string{"id", "tenant_id", "episode_id", "display_order", "created_at", "content_type", "file_size_bytes", "width", "height"}
	expectPublishedEpisodeLookup(mock, tenantID, nil)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.DeleteEpisodeImageByIDForEpisode)).
		WithArgs(deletedID, testEpisodeID).
		WillReturnRows(sqlmock.NewRows([]string{"display_order"}).AddRow(int32(1)))
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeImagesByEpisodeID)).
		WithArgs(testEpisodeID).
		WillReturnRows(sqlmock.NewRows(imageColumns).
			AddRow(keptID, tenantID, testEpisodeID, int32(2), now, "image/jpeg", int64(2048), int32(1600), int32(900)))

	req := &publiraadminv1.DeleteEpisodeImageRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: testEpisodeID.String(),
		ImageId:   deletedID.String(),
	}

	resp, err := client.DeleteEpisodeImage(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("DeleteEpisodeImage: %v", err)
	}
	if len(resp.Images) != 1 || resp.Images[0].Id != keptID.String() {
		t.Fatalf("answered pages = %v, want only %s", resp.Images, keptID)
	}
	revalidations.waitForTags(t, wantEpisodeRevalidateTags(tenantID))
	assertExpectations(t, mock)
}
