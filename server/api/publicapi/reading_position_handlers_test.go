package publicapi

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

const (
	saveEpisodeReadingPositionQuery  = "-- name: SaveEpisodeReadingPosition :one\n"
	getMyEpisodeReadingPositionQuery = "-- name: GetMyEpisodeReadingPosition :one\n"
	getMySeriesReadingProgressQuery  = "-- name: GetMySeriesReadingProgress :one\n"
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
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestGetMySeriesProgressIsEmptyForAnUnopenedSeries(t *testing.T) {
	fixture := newReadingPositionFixture(t)
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
