package publicapi

import (
	"context"
	"database/sql"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

const (
	saveEpisodeReadingPositionQuery  = "-- name: SaveEpisodeReadingPosition :one\n"
	getMyEpisodeReadingPositionQuery = "-- name: GetMyEpisodeReadingPosition :one\n"
	getMySeriesReadingProgressQuery  = "-- name: GetMySeriesReadingProgress :one\n"
	listMyFinishedEpisodesQuery      = "-- name: ListMyFinishedEpisodePublicIDsInSeries :many\n"
	listMyRecentSeriesDescQuery      = "-- name: ListMyRecentSeriesDesc :many\n"
	listMyRecentSeriesAscQuery       = "-- name: ListMyRecentSeriesAsc :many\n"
)

type readingPositionFixture struct {
	client   publirav1connect.EpisodeReadServiceClient
	mock     sqlmock.Sqlmock
	tenantID uuid.UUID
	userID   uuid.UUID
	now      time.Time
}

func newReadingPositionFixture(t *testing.T) *readingPositionFixture {
	t.Helper()

	testServer, mock := newTestPublicServer(t)
	fixture := &readingPositionFixture{
		client:   publirav1connect.NewEpisodeReadServiceClient(testServer.Client(), testServer.URL),
		mock:     mock,
		tenantID: uuid.Must(uuid.NewV7()),
		userID:   uuid.Must(uuid.NewV7()),
		now:      time.Now().UTC().Truncate(time.Microsecond),
	}
	expectTenantLookup(mock, fixture.tenantID, "TENANT", fixture.now)
	expectAuthSession(mock, fixture.tenantID, fixture.userID, fixture.now)
	return fixture
}

func (f *readingPositionFixture) save(publicID string, pageIndex int32) (*connect.Response[publirav1.SaveReadingPositionResponse], error) {
	return f.client.SaveReadingPosition(context.Background(), newAuthedPublicRequest(&publirav1.SaveReadingPositionRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: f.tenantID.String()},
		EpisodePublicId: publicID,
		PageIndex:       pageIndex,
	}, f.tenantID.String()))
}

func (f *readingPositionFixture) get(publicID string) (*connect.Response[publirav1.GetMyReadingPositionResponse], error) {
	return f.client.GetMyReadingPosition(context.Background(), newAuthedPublicRequest(&publirav1.GetMyReadingPositionRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: f.tenantID.String()},
		EpisodePublicId: publicID,
	}, f.tenantID.String()))
}

func (f *readingPositionFixture) progress(seriesPublicID string) (*connect.Response[publirav1.GetMySeriesProgressResponse], error) {
	return f.client.GetMySeriesProgress(context.Background(), newAuthedPublicRequest(&publirav1.GetMySeriesProgressRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: f.tenantID.String()},
		SeriesPublicId: seriesPublicID,
	}, f.tenantID.String()))
}

// expectFinishedEpisodes stands in for the finished-episode read every
// GetMySeriesProgress call makes before it looks for a progress row.
func (f *readingPositionFixture) expectFinishedEpisodes(seriesPublicID string, publicIDs ...string) {
	rows := sqlmock.NewRows([]string{"public_id"})
	for _, publicID := range publicIDs {
		rows.AddRow(publicID)
	}
	f.mock.ExpectQuery(regexp.QuoteMeta(listMyFinishedEpisodesQuery)).
		WithArgs(f.tenantID, f.userID, seriesPublicID).
		WillReturnRows(rows)
}

// expectSave stands in for the single statement that gates the episode and
// writes the position. A rejected page is the same row with the saved columns
// empty, which is what savedPageIndex nil produces.
func (f *readingPositionFixture) expectSave(publicID string, pageIndex, episodePageCount int32, savedPageIndex any) {
	rows := sqlmock.NewRows([]string{"episode_page_count", "page_index", "page_count", "updated_at"})
	if savedPageIndex == nil {
		rows.AddRow(episodePageCount, nil, nil, nil)
	} else {
		rows.AddRow(episodePageCount, savedPageIndex, episodePageCount, f.now)
	}
	f.mock.ExpectQuery(regexp.QuoteMeta(saveEpisodeReadingPositionQuery)).
		WithArgs(f.tenantID, publicID, f.userID, pageIndex).
		WillReturnRows(rows)
}

func TestSaveReadingPositionStoresThePageAndReturnsPrivateResponse(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	fixture.expectSave("EPISODE001", 11, 40, int32(11))

	response, err := fixture.save("EPISODE001", 11)
	if err != nil {
		t.Fatalf("SaveReadingPosition: %v", err)
	}
	position := response.Msg.Position
	if position == nil {
		t.Fatal("SaveReadingPosition returned no position")
	}
	if position.EpisodePublicId != "EPISODE001" || position.PageIndex != 11 || position.PageCount != 40 {
		t.Fatalf("position = %+v, want EPISODE001 at 11 of 40", position)
	}
	if got, want := position.UpdatedAt, fixture.now.Format(time.RFC3339Nano); got != want {
		t.Fatalf("updated_at = %q, want %q", got, want)
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestSaveReadingPositionRejectsAPageOutsideTheEpisode(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	fixture.expectSave("EPISODE001", 40, 40, nil)

	_, err := fixture.save("EPISODE001", 40)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("SaveReadingPosition past the last page error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestSaveReadingPositionRejectsAnEpisodeWithNoPages(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	fixture.expectSave("EPISODE001", 0, 0, nil)

	_, err := fixture.save("EPISODE001", 0)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("SaveReadingPosition on a pageless episode error = %v, want failed_precondition", err)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestSaveReadingPositionHidesUnavailableEpisodes(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	fixture.mock.ExpectQuery(regexp.QuoteMeta(saveEpisodeReadingPositionQuery)).
		WithArgs(fixture.tenantID, "UNAVAILABLE", fixture.userID, int32(3)).
		WillReturnError(sql.ErrNoRows)

	_, err := fixture.save("UNAVAILABLE", 3)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("SaveReadingPosition error = %v, want not_found", err)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestSaveReadingPositionRejectsBlankPublicID(t *testing.T) {
	fixture := newReadingPositionFixture(t)

	_, err := fixture.save("   ", 1)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("SaveReadingPosition blank ID error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestSaveReadingPositionRequiresASession(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", time.Now().UTC())
	client := publirav1connect.NewEpisodeReadServiceClient(testServer.Client(), testServer.URL)

	_, err := client.SaveReadingPosition(context.Background(), connect.NewRequest(&publirav1.SaveReadingPositionRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodePublicId: "EPISODE001",
		PageIndex:       1,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("SaveReadingPosition without a bearer error = %v, want unauthenticated", err)
	}
	assertPublicExpectations(t, mock)
}

func TestGetMyReadingPositionReturnsTheStoredPage(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	fixture.mock.ExpectQuery(regexp.QuoteMeta(getMyEpisodeReadingPositionQuery)).
		WithArgs(fixture.tenantID, fixture.userID, "EPISODE001").
		WillReturnRows(sqlmock.NewRows([]string{"page_index", "page_count", "updated_at"}).
			AddRow(int32(11), int32(40), fixture.now))

	response, err := fixture.get("EPISODE001")
	if err != nil {
		t.Fatalf("GetMyReadingPosition: %v", err)
	}
	position := response.Msg.Position
	if position == nil {
		t.Fatal("GetMyReadingPosition returned no position")
	}
	if position.EpisodePublicId != "EPISODE001" || position.PageIndex != 11 || position.PageCount != 40 {
		t.Fatalf("position = %+v, want EPISODE001 at 11 of 40", position)
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestGetMyReadingPositionIsEmptyWithoutOne(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	fixture.mock.ExpectQuery(regexp.QuoteMeta(getMyEpisodeReadingPositionQuery)).
		WithArgs(fixture.tenantID, fixture.userID, "EPISODE001").
		WillReturnError(sql.ErrNoRows)

	response, err := fixture.get("EPISODE001")
	if err != nil {
		t.Fatalf("GetMyReadingPosition: %v", err)
	}
	if response.Msg.Position != nil {
		t.Fatalf("position = %+v, want none", response.Msg.Position)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestGetMySeriesProgressReturnsTheLastOpenedEpisode(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	fixture.expectFinishedEpisodes("SERIES001", "EPISODE001", "EPISODE002")
	fixture.mock.ExpectQuery(regexp.QuoteMeta(getMySeriesReadingProgressQuery)).
		WithArgs(fixture.tenantID, fixture.userID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{
			"episode_public_id", "episode_title", "order_index", "price", "reading_period_hours",
			"status", "scheduled_at", "published_at", "page_index", "page_count", "updated_at", "is_finished",
		}).AddRow("EPISODE003", "Episode 3", int32(3), int32(0), nil, "published", nil, fixture.now, int32(11), int32(40), fixture.now, false))

	response, err := fixture.progress("SERIES001")
	if err != nil {
		t.Fatalf("GetMySeriesProgress: %v", err)
	}
	progress := response.Msg.Progress
	if progress == nil {
		t.Fatal("GetMySeriesProgress returned no progress")
	}
	if progress.Episode.GetPublicId() != "EPISODE003" || progress.Episode.GetTitle() != "Episode 3" {
		t.Fatalf("episode = %+v, want EPISODE003", progress.Episode)
	}
	if progress.Position.GetEpisodePublicId() != "EPISODE003" || progress.Position.GetPageIndex() != 11 {
		t.Fatalf("position = %+v, want EPISODE003 at 11", progress.Position)
	}
	if progress.IsFinished {
		t.Fatal("is_finished = true, want false")
	}
	if !slices.Equal(response.Msg.FinishedEpisodePublicIds, []string{"EPISODE001", "EPISODE002"}) {
		t.Fatalf("finished_episode_public_ids = %v, want the two finished episodes", response.Msg.FinishedEpisodePublicIds)
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestGetMySeriesProgressIsEmptyForAnUnopenedSeries(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	fixture.expectFinishedEpisodes("SERIES001")
	fixture.mock.ExpectQuery(regexp.QuoteMeta(getMySeriesReadingProgressQuery)).
		WithArgs(fixture.tenantID, fixture.userID, "SERIES001").
		WillReturnError(sql.ErrNoRows)

	response, err := fixture.progress("SERIES001")
	if err != nil {
		t.Fatalf("GetMySeriesProgress: %v", err)
	}
	if response.Msg.Progress != nil {
		t.Fatalf("progress = %+v, want none", response.Msg.Progress)
	}
	if len(response.Msg.FinishedEpisodePublicIds) != 0 {
		t.Fatalf("finished_episode_public_ids = %v, want none", response.Msg.FinishedEpisodePublicIds)
	}
	assertPublicExpectations(t, fixture.mock)
}

// A reader can finish episodes without ever saving a position in one, so the
// finished list is reported even when there is no progress row behind it.
func TestGetMySeriesProgressReportsFinishedEpisodesWithoutAPosition(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	fixture.expectFinishedEpisodes("SERIES001", "EPISODE001")
	fixture.mock.ExpectQuery(regexp.QuoteMeta(getMySeriesReadingProgressQuery)).
		WithArgs(fixture.tenantID, fixture.userID, "SERIES001").
		WillReturnError(sql.ErrNoRows)

	response, err := fixture.progress("SERIES001")
	if err != nil {
		t.Fatalf("GetMySeriesProgress: %v", err)
	}
	if response.Msg.Progress != nil {
		t.Fatalf("progress = %+v, want none", response.Msg.Progress)
	}
	if !slices.Equal(response.Msg.FinishedEpisodePublicIds, []string{"EPISODE001"}) {
		t.Fatalf("finished_episode_public_ids = %v, want EPISODE001", response.Msg.FinishedEpisodePublicIds)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestGetMySeriesProgressRejectsBlankSeriesPublicID(t *testing.T) {
	fixture := newReadingPositionFixture(t)

	_, err := fixture.progress("  ")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("GetMySeriesProgress blank ID error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, fixture.mock)
}

// recentSeriesColumns is the keyset half of a recent series page: the series
// id and sort key, the episode to continue from, and the position when the
// reader may still open that episode's body.
func recentSeriesColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"series_id", "last_activity_at", "episode_public_id", "episode_title", "order_index",
		"price", "reading_period_hours", "status", "scheduled_at", "published_at",
		"page_index", "page_count", "position_updated_at",
	})
}

func (f *readingPositionFixture) recent(limit int32, token string) (*connect.Response[publirav1.ListMyRecentSeriesResponse], error) {
	return f.client.ListMyRecentSeries(context.Background(), newAuthedPublicRequest(&publirav1.ListMyRecentSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: f.tenantID.String()},
		Limit:  limit,
		Token:  token,
	}, f.tenantID.String()))
}

func TestListMyRecentSeriesReturnsTheEpisodeToContinueFrom(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	resumed := uuid.Must(uuid.NewV7())
	started := uuid.Must(uuid.NewV7())
	activity := fixture.now.Add(-time.Hour)

	fixture.mock.ExpectQuery(regexp.QuoteMeta(listMyRecentSeriesDescQuery)).
		WithArgs(fixture.tenantID, fixture.userID, sql.NullTime{}, false, uuid.NullUUID{}, int32(3)).
		WillReturnRows(recentSeriesColumns().
			AddRow(resumed, fixture.now, "EPISODE003", "Episode 3", int32(3), int32(0), nil, "published", nil, fixture.now, int32(11), int32(40), fixture.now).
			AddRow(started, activity, "EPISODE004", "Episode 4", int32(4), int32(500), nil, "published", nil, activity, nil, nil, nil))
	fixture.mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(fixture.tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(started, "SERIES002", "Started", "", "ongoing", []byte("{}"), "all", fixture.now, nil, nil, int32(0), []byte("[]"), []byte("[]"), []byte("[]"), []byte("{}")).
			AddRow(resumed, "SERIES001", "Resumed", "", "ongoing", []byte("{}"), "all", fixture.now, nil, nil, int32(0), []byte("[]"), []byte("[]"), []byte("[]"), []byte("{}")))

	response, err := fixture.recent(2, "")
	if err != nil {
		t.Fatalf("ListMyRecentSeries: %v", err)
	}
	// The display query is unordered; the keyset scan is what decides the page
	// order, and the handler puts the rows back into it.
	items := make([]*publirattypesv1.Series, 0, len(response.Msg.Series))
	for _, item := range response.Msg.Series {
		items = append(items, item.GetSeries())
	}
	assertSeriesPublicIDs(t, items, "SERIES001", "SERIES002")

	first := response.Msg.Series[0]
	if got := first.GetEpisode().GetPublicId(); got != "EPISODE003" {
		t.Fatalf("episode = %q, want the unfinished EPISODE003", got)
	}
	if got := first.GetPosition().GetPageIndex(); got != 11 {
		t.Fatalf("position = %+v, want page 11", first.GetPosition())
	}
	if got, want := first.GetLastActivityAt(), fixture.now.Format(time.RFC3339Nano); got != want {
		t.Fatalf("last_activity_at = %q, want %q", got, want)
	}

	// A next episode the reader has never opened has no position to resume, and
	// a paid one they have not bought is offered all the same.
	second := response.Msg.Series[1]
	if got := second.GetEpisode().GetPublicId(); got != "EPISODE004" {
		t.Fatalf("episode = %q, want the next EPISODE004", got)
	}
	if second.GetPosition() != nil {
		t.Fatalf("position = %+v, want none for an episode never opened", second.GetPosition())
	}

	if response.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", response.Msg.PreviousToken)
	}
	if response.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", response.Msg.NextToken)
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestListMyRecentSeriesPagesForwardOnTheActivityCursor(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	series := uuid.Must(uuid.NewV7())
	boundary := uuid.Must(uuid.NewV7())
	activity := fixture.now.Add(-2 * time.Hour)

	fixture.mock.ExpectQuery(regexp.QuoteMeta(listMyRecentSeriesDescQuery)).
		WithArgs(fixture.tenantID, fixture.userID, sql.NullTime{}, false, uuid.NullUUID{}, int32(2)).
		WillReturnRows(recentSeriesColumns().
			AddRow(series, fixture.now, "EPISODE001", "Episode 1", int32(1), int32(0), nil, "published", nil, fixture.now, int32(2), int32(20), fixture.now).
			AddRow(boundary, activity, "EPISODE009", "Episode 9", int32(9), int32(0), nil, "published", nil, activity, nil, nil, nil))
	fixture.mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(fixture.tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(series, "SERIES001", "Resumed", "", "ongoing", []byte("{}"), "all", fixture.now, nil, nil, int32(0), []byte("[]"), []byte("[]"), []byte("[]"), []byte("{}")))

	response, err := fixture.recent(1, "")
	if err != nil {
		t.Fatalf("ListMyRecentSeries: %v", err)
	}
	// The over-fetched row is dropped from the page and is what says another
	// page exists; the token names the last row that stayed.
	if len(response.Msg.Series) != 1 {
		t.Fatalf("series = %d, want the single row of the page", len(response.Msg.Series))
	}
	want := pagination.EncodeTimeUUID(pagination.Forward, fixture.now, series)
	if response.Msg.NextToken != want {
		t.Fatalf("next_token = %q, want the token of the last row on the page", response.Msg.NextToken)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestListMyRecentSeriesReadsTheBackwardDirectionAscending(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	series := uuid.Must(uuid.NewV7())
	boundary := uuid.Must(uuid.NewV7())
	token := pagination.EncodeTimeUUID(pagination.Backward, fixture.now, boundary)

	fixture.mock.ExpectQuery(regexp.QuoteMeta(listMyRecentSeriesAscQuery)).
		WithArgs(fixture.tenantID, fixture.userID, sql.NullTime{Time: fixture.now, Valid: true}, false, uuid.NullUUID{UUID: boundary, Valid: true}, int32(21)).
		WillReturnRows(recentSeriesColumns().
			AddRow(series, fixture.now, "EPISODE001", "Episode 1", int32(1), int32(0), nil, "published", nil, fixture.now, int32(2), int32(20), fixture.now))
	fixture.mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(fixture.tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(series, "SERIES001", "Resumed", "", "ongoing", []byte("{}"), "all", fixture.now, nil, nil, int32(0), []byte("[]"), []byte("[]"), []byte("[]"), []byte("{}")))

	response, err := fixture.recent(0, token)
	if err != nil {
		t.Fatalf("ListMyRecentSeries: %v", err)
	}
	if len(response.Msg.Series) != 1 {
		t.Fatalf("series = %d, want the single row of the page", len(response.Msg.Series))
	}
	// The side the client came from is known to hold rows without asking.
	if response.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want the way back to the page the client came from")
	}
	if response.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan ran out", response.Msg.PreviousToken)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestListMyRecentSeriesRecoversOnceFromAnEmptyPage(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	boundary := uuid.Must(uuid.NewV7())
	token := pagination.EncodeTimeUUID(pagination.Forward, fixture.now, boundary)

	fixture.mock.ExpectQuery(regexp.QuoteMeta(listMyRecentSeriesDescQuery)).
		WithArgs(fixture.tenantID, fixture.userID, sql.NullTime{Time: fixture.now, Valid: true}, false, uuid.NullUUID{UUID: boundary, Valid: true}, int32(21)).
		WillReturnRows(recentSeriesColumns())

	response, err := fixture.recent(0, token)
	if err != nil {
		t.Fatalf("ListMyRecentSeries: %v", err)
	}
	if len(response.Msg.Series) != 0 {
		t.Fatalf("series = %d, want none", len(response.Msg.Series))
	}
	want := pagination.EncodeTimeUUIDRecovery(pagination.Backward, fixture.now, boundary)
	if response.Msg.PreviousToken != want {
		t.Fatalf("previous_token = %q, want the recovery token back to the boundary row", response.Msg.PreviousToken)
	}
	if response.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty", response.Msg.NextToken)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestListMyRecentSeriesRecoversOnceFromAnEmptyBackwardPage(t *testing.T) {
	fixture := newReadingPositionFixture(t)
	boundary := uuid.Must(uuid.NewV7())
	token := pagination.EncodeTimeUUID(pagination.Backward, fixture.now, boundary)

	fixture.mock.ExpectQuery(regexp.QuoteMeta(listMyRecentSeriesAscQuery)).
		WithArgs(fixture.tenantID, fixture.userID, sql.NullTime{Time: fixture.now, Valid: true}, false, uuid.NullUUID{UUID: boundary, Valid: true}, int32(21)).
		WillReturnRows(recentSeriesColumns())

	response, err := fixture.recent(0, token)
	if err != nil {
		t.Fatalf("ListMyRecentSeries: %v", err)
	}
	if len(response.Msg.Series) != 0 {
		t.Fatalf("series = %d, want none", len(response.Msg.Series))
	}
	want := pagination.EncodeTimeUUIDRecovery(pagination.Forward, fixture.now, boundary)
	if response.Msg.NextToken != want {
		t.Fatalf("next_token = %q, want the recovery token back to the boundary row", response.Msg.NextToken)
	}
	if response.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty", response.Msg.PreviousToken)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestListMyRecentSeriesRejectsAMalformedToken(t *testing.T) {
	fixture := newReadingPositionFixture(t)

	_, err := fixture.recent(10, "not-a-token")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListMyRecentSeries error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestListMyRecentSeriesRequiresASession(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", time.Now().UTC())
	client := publirav1connect.NewEpisodeReadServiceClient(testServer.Client(), testServer.URL)

	_, err := client.ListMyRecentSeries(context.Background(), connect.NewRequest(&publirav1.ListMyRecentSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListMyRecentSeries without a bearer error = %v, want unauthenticated", err)
	}
	assertPublicExpectations(t, mock)
}
