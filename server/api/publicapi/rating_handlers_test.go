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

	publirattypesv1 "github.com/publira/publira/server/internal/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/gen/publira/v1/publirav1connect"
)

const (
	getPublishedSeriesIDByPublicIDQuery = "-- name: GetPublishedSeriesIDByPublicID :one\n"
	insertRatingEventQuery              = "-- name: InsertRatingEvent :one\n"
)

// ratingFixture is one signed-in member about to rate something. The session
// lookups are registered up front because every RateContent call resolves the
// member before it looks at the score or the target.
type ratingFixture struct {
	client   publirav1connect.RatingServiceClient
	mock     sqlmock.Sqlmock
	tenantID uuid.UUID
	userID   uuid.UUID
	now      time.Time
}

func newRatingFixture(t *testing.T) *ratingFixture {
	t.Helper()

	testServer, mock := newTestPublicServer(t)
	fixture := &ratingFixture{
		client:   publirav1connect.NewRatingServiceClient(testServer.Client(), testServer.URL),
		mock:     mock,
		tenantID: uuid.Must(uuid.NewV7()),
		userID:   uuid.Must(uuid.NewV7()),
		now:      time.Now().UTC().Truncate(time.Microsecond),
	}
	expectTenantLookup(mock, fixture.tenantID, "TENANT", fixture.now)
	expectAuthSession(mock, fixture.tenantID, fixture.userID, fixture.now)
	return fixture
}

func (f *ratingFixture) rate(target *publirav1.RatingTarget, score int32) (*connect.Response[publirav1.RateContentResponse], error) {
	return f.client.RateContent(context.Background(), newAuthedPublicRequest(&publirav1.RateContentRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: f.tenantID.String()},
		Target: target,
		Score:  score,
	}, f.tenantID.String()))
}

// expectRatingInsert returns the stored row the way PostgreSQL would, so the
// response is asserted against what came back from the insert rather than
// against the request the handler was given.
func (f *ratingFixture) expectRatingInsert(seriesID uuid.UUID, episodeID uuid.NullUUID, score int16) {
	eventID := uuid.Must(uuid.NewV7())
	f.mock.ExpectQuery(regexp.QuoteMeta(insertRatingEventQuery)).
		WithArgs(sqlmock.AnyArg(), f.tenantID, f.userID, seriesID, episodeID, score, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()).AddRow(
			eventID, f.tenantID, "rating",
			uuid.NullUUID{UUID: f.userID, Valid: true}, uuid.NullUUID{}, uuid.NullUUID{UUID: f.userID, Valid: true},
			uuid.NullUUID{UUID: seriesID, Valid: true}, episodeID,
			sql.NullInt64{}, sql.NullInt16{Int16: score, Valid: true},
			sql.NullString{}, uuid.NullUUID{}, []byte("{}"), f.now, f.now,
		))
}

func seriesRatingTarget(publicID string) *publirav1.RatingTarget {
	return &publirav1.RatingTarget{Type: publirav1.RatingTargetType_RATING_TARGET_TYPE_SERIES, PublicId: publicID}
}

func episodeRatingTarget(publicID string) *publirav1.RatingTarget {
	return &publirav1.RatingTarget{Type: publirav1.RatingTargetType_RATING_TARGET_TYPE_EPISODE, PublicId: publicID}
}

func TestRateContentSeriesRecordsRatingWithNoEpisode(t *testing.T) {
	fixture := newRatingFixture(t)
	seriesID := uuid.Must(uuid.NewV7())
	fixture.mock.ExpectQuery(regexp.QuoteMeta(getPublishedSeriesIDByPublicIDQuery)).
		WithArgs(fixture.tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(seriesID))
	fixture.expectRatingInsert(seriesID, uuid.NullUUID{}, 4)

	response, err := fixture.rate(seriesRatingTarget("SERIES001"), 4)
	if err != nil {
		t.Fatalf("RateContent: %v", err)
	}
	if response.Msg.Score != 4 {
		t.Fatalf("score = %d, want 4", response.Msg.Score)
	}
	if got, want := response.Msg.RatedAt, fixture.now.Format(time.RFC3339); got != want {
		t.Fatalf("rated_at = %q, want %q", got, want)
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

// The request carries only an episode public ID, so the series a rating is
// filed under can only come from the episode row the server read.
func TestRateContentEpisodeResolvesSeriesFromTheEpisodeRow(t *testing.T) {
	fixture := newRatingFixture(t)
	seriesID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	fixture.mock.ExpectQuery(regexp.QuoteMeta(getPublishedEpisodeByPublicIDQuery)).
		WithArgs(fixture.tenantID, "EPISODE001").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "public_id", "title", "order_index", "series_id", "price",
			"reading_period_hours", "status", "scheduled_at", "published_at",
			"series_public_id", "series_title",
		}).AddRow(
			episodeID, "EPISODE001", "Episode Title", int32(1), seriesID,
			int32(0), int32(24), "published", nil, fixture.now, "SERIES001", "Series Title",
		))
	fixture.expectRatingInsert(seriesID, uuid.NullUUID{UUID: episodeID, Valid: true}, 5)

	response, err := fixture.rate(episodeRatingTarget("EPISODE001"), 5)
	if err != nil {
		t.Fatalf("RateContent: %v", err)
	}
	if response.Msg.Score != 5 {
		t.Fatalf("score = %d, want 5", response.Msg.Score)
	}
	assertPublicExpectations(t, fixture.mock)
}

// A score outside 1–5 is rejected before the target is resolved, so it cannot
// double as a probe for which public IDs exist. The unmet expectations check
// is what proves no target query ran.
func TestRateContentRejectsScoreOutsideOneToFive(t *testing.T) {
	for name, score := range map[string]int32{
		"unset":       0,
		"negative":    -1,
		"above range": 6,
		"far above":   100,
	} {
		t.Run(name, func(t *testing.T) {
			fixture := newRatingFixture(t)
			_, err := fixture.rate(seriesRatingTarget("SERIES001"), score)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("RateContent(%d) error = %v, want invalid_argument", score, err)
			}
			assertPublicExpectations(t, fixture.mock)
		})
	}
}

func TestRateContentRejectsUnknownTarget(t *testing.T) {
	testCases := map[string]struct {
		target *publirav1.RatingTarget
		want   connect.Code
	}{
		"missing target":     {target: nil, want: connect.CodeInvalidArgument},
		"blank public id":    {target: seriesRatingTarget("   "), want: connect.CodeInvalidArgument},
		"unspecified type":   {target: &publirav1.RatingTarget{PublicId: "SERIES001"}, want: connect.CodeInvalidArgument},
		"unpublished series": {target: seriesRatingTarget("SERIES404"), want: connect.CodeNotFound},
	}
	for name, testCase := range testCases {
		t.Run(name, func(t *testing.T) {
			fixture := newRatingFixture(t)
			if testCase.want == connect.CodeNotFound {
				fixture.mock.ExpectQuery(regexp.QuoteMeta(getPublishedSeriesIDByPublicIDQuery)).
					WithArgs(fixture.tenantID, "SERIES404").
					WillReturnError(sql.ErrNoRows)
			}
			_, err := fixture.rate(testCase.target, 3)
			if connect.CodeOf(err) != testCase.want {
				t.Fatalf("RateContent error = %v, want %v", err, testCase.want)
			}
			assertPublicExpectations(t, fixture.mock)
		})
	}
}

func TestRateContentRequiresASession(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", time.Now().UTC())

	client := publirav1connect.NewRatingServiceClient(testServer.Client(), testServer.URL)
	_, err := client.RateContent(context.Background(), connect.NewRequest(&publirav1.RateContentRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Target: seriesRatingTarget("SERIES001"),
		Score:  3,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("RateContent without a bearer error = %v, want unauthenticated", err)
	}
	assertPublicExpectations(t, mock)
}

func TestValidateRatingScoreAcceptsTheWholeRange(t *testing.T) {
	for score := int32(minRatingScore); score <= maxRatingScore; score++ {
		got, err := validateRatingScore(score)
		if err != nil {
			t.Fatalf("validateRatingScore(%d) = %v, want no error", score, err)
		}
		if int32(got) != score {
			t.Fatalf("validateRatingScore(%d) = %d, want %d", score, got, score)
		}
	}
}
