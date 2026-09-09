package publicapi

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"regexp"
	"strconv"
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

// subjectSeriesPublicID is the series every case here asks for neighbours of.
const subjectSeriesPublicID = "SUBJECT00001"

// scoredID is one row of the keyset scan: a series, the relatedness score it
// was scored at, and the ranking position it sorted under.
type scoredID struct {
	id       uuid.UUID
	score    int32
	sortRank int32
}

func relatedSeriesIDRows(rows ...scoredID) *sqlmock.Rows {
	result := sqlmock.NewRows([]string{"id", "score", "sort_rank"})
	for _, row := range rows {
		result.AddRow(row.id, row.score, row.sortRank)
	}
	return result
}

func expectSubjectSeriesLookup(mock sqlmock.Sqlmock, tenantID, seriesID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedSeriesIDByPublicIDQuery)).
		WithArgs(tenantID, subjectSeriesPublicID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(seriesID))
}

func listRelatedSeries(
	t *testing.T,
	testServer *httptest.Server,
	req *publirav1.ListRelatedSeriesRequest,
) (*publirav1.ListRelatedSeriesResponse, error) {
	t.Helper()

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRelatedSeries(context.Background(), connect.NewRequest(req))
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func TestCatalogListRelatedSeriesLeadsWithTheScoredRows(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	subjectID := uuid.Must(uuid.NewV7())
	sameCreator := uuid.Must(uuid.NewV7())
	sameLabel := uuid.Must(uuid.NewV7())
	unrelated := uuid.Must(uuid.NewV7())
	overFetched := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectSubjectSeriesLookup(mock, tenantID, subjectID)
	expectRankingSnapshotLookup(mock, tenantID, now, rankingItemsJSON(unrelated))
	// The scoring is decided in SQL, so the snapshot items and the subject id go
	// to the query untouched. The fourth id is the over-fetched one that says
	// another page exists.
	mock.ExpectQuery(regexp.QuoteMeta(listRelatedSeriesIDsQuery)).
		WithArgs(nil, nil, nil, false, nil, int32(4), tenantID, subjectID, rankingItemsJSON(unrelated)).
		WillReturnRows(relatedSeriesIDRows(
			scoredID{id: sameCreator, score: 3, sortRank: unrankedSortRank},
			scoredID{id: sameLabel, score: 2, sortRank: unrankedSortRank},
			scoredID{id: unrelated, score: 0, sortRank: 1},
			scoredID{id: overFetched, score: 0, sortRank: unrankedSortRank},
		))
	// The display query is unordered; the handler puts the rows back in the
	// order the keyset scan decided.
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(
			recommendedSeriesRow(
				recommendedSeriesRow(seriesDetailColumns(), unrelated, "UNRELATED", "Unrelated", now),
				sameLabel, "SAMELABEL", "Same Label", now),
			sameCreator, "SAMECREATOR", "Same Creator", now))

	resp, err := listRelatedSeries(t, testServer, &publirav1.ListRelatedSeriesRequest{
		Limit:          3,
		SeriesPublicId: subjectSeriesPublicID,
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("ListRelatedSeries: %v", err)
	}

	assertSeriesPublicIDs(t, resp.Series, "SAMECREATOR", "SAMELABEL", "UNRELATED")
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.PreviousToken)
	}
	if resp.NextToken == "" {
		t.Fatalf("next_token is empty, want a token while rows remain")
	}
	assertPublicExpectations(t, mock)
}

// The over-fetch that decides whether another page exists is what the default
// limit is visible through: a strip asking for nothing gets twelve.
func TestCatalogListRelatedSeriesDefaultsToTheStripSize(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	subjectID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectSubjectSeriesLookup(mock, tenantID, subjectID)
	expectRankingSnapshotLookup(mock, tenantID, now, rankingItemsJSON())
	mock.ExpectQuery(regexp.QuoteMeta(listRelatedSeriesIDsQuery)).
		WithArgs(nil, nil, nil, false, nil, defaultRelatedSeriesPageSize+1, tenantID, subjectID, rankingItemsJSON()).
		WillReturnRows(relatedSeriesIDRows())

	resp, err := listRelatedSeries(t, testServer, &publirav1.ListRelatedSeriesRequest{
		SeriesPublicId: subjectSeriesPublicID,
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("ListRelatedSeries: %v", err)
	}
	if len(resp.Series) != 0 {
		t.Fatalf("series = %v, want none in a catalogue of one", seriesPublicIDs(resp.Series))
	}
	assertPublicExpectations(t, mock)
}

// A token carries the score and the rank the scan reported, and the scan takes
// them back as the boundary of the next page.
func TestCatalogListRelatedSeriesPagesOnTheScoreAndTheRank(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	subjectID := uuid.Must(uuid.NewV7())
	boundary := uuid.Must(uuid.NewV7())
	next := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	publishedAt := now.Add(-2 * time.Hour)
	token := pagination.Encode(
		pagination.Forward,
		subjectSeriesPublicID,
		"2",
		strconv.FormatInt(int64(unrankedSortRank), 10),
		publishedAt.Format(time.RFC3339Nano),
		boundary.String(),
	)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectSubjectSeriesLookup(mock, tenantID, subjectID)
	expectRankingSnapshotLookup(mock, tenantID, now, rankingItemsJSON())
	mock.ExpectQuery(regexp.QuoteMeta(listRelatedSeriesIDsQuery)).
		WithArgs(
			boundary,
			int32(2),
			unrankedSortRank,
			false,
			publishedAt,
			int32(2),
			tenantID,
			subjectID,
			rankingItemsJSON(),
		).
		WillReturnRows(relatedSeriesIDRows(scoredID{id: next, score: 2, sortRank: unrankedSortRank}))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), next, "NEXT", "Next", publishedAt))

	resp, err := listRelatedSeries(t, testServer, &publirav1.ListRelatedSeriesRequest{
		Limit:          1,
		SeriesPublicId: subjectSeriesPublicID,
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:          token,
	})
	if err != nil {
		t.Fatalf("ListRelatedSeries: %v", err)
	}

	assertSeriesPublicIDs(t, resp.Series, "NEXT")
	if resp.PreviousToken == "" {
		t.Fatalf("previous_token is empty, want a token back to the page just left")
	}
	if resp.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.NextToken)
	}
	assertPublicExpectations(t, mock)
}

// A score is a position in one series' list and nothing anywhere else, so a
// token from another series is refused rather than continued.
func TestCatalogListRelatedSeriesRejectsATokenFromAnotherSeries(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	token := pagination.Encode(
		pagination.Forward,
		"OTHERSERIES1",
		"2",
		strconv.FormatInt(int64(unrankedSortRank), 10),
		now.Format(time.RFC3339Nano),
		uuid.Must(uuid.NewV7()).String(),
	)

	expectTenantLookup(mock, tenantID, "TENANT", now)

	_, err := listRelatedSeries(t, testServer, &publirav1.ListRelatedSeriesRequest{
		SeriesPublicId: subjectSeriesPublicID,
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:          token,
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRelatedSeriesIsNotFoundWithoutAPublishedSubject(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedSeriesIDByPublicIDQuery)).
		WithArgs(tenantID, subjectSeriesPublicID).
		WillReturnError(sql.ErrNoRows)

	_, err := listRelatedSeries(t, testServer, &publirav1.ListRelatedSeriesRequest{
		SeriesPublicId: subjectSeriesPublicID,
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("error = %v, want not_found", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRelatedSeriesRequiresASeries(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now().UTC())

	_, err := listRelatedSeries(t, testServer, &publirav1.ListRelatedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, mock)
}

// The boundary row was unpublished after the token was issued, so the page it
// names is empty. The client gets a token back to where it came from rather
// than being sent to the first page.
func TestCatalogListRelatedSeriesRecoversFromAnEmptyPage(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	subjectID := uuid.Must(uuid.NewV7())
	boundary := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	token := pagination.Encode(
		pagination.Forward,
		subjectSeriesPublicID,
		"3",
		"1",
		now.Format(time.RFC3339Nano),
		boundary.String(),
	)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectSubjectSeriesLookup(mock, tenantID, subjectID)
	expectRankingSnapshotLookup(mock, tenantID, now, rankingItemsJSON())
	mock.ExpectQuery(regexp.QuoteMeta(listRelatedSeriesIDsQuery)).
		WithArgs(boundary, int32(3), int32(1), false, now, int32(2), tenantID, subjectID, rankingItemsJSON()).
		WillReturnRows(relatedSeriesIDRows())

	resp, err := listRelatedSeries(t, testServer, &publirav1.ListRelatedSeriesRequest{
		Limit:          1,
		SeriesPublicId: subjectSeriesPublicID,
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:          token,
	})
	if err != nil {
		t.Fatalf("ListRelatedSeries: %v", err)
	}
	if len(resp.Series) != 0 {
		t.Fatalf("series = %v, want none", seriesPublicIDs(resp.Series))
	}
	if resp.PreviousToken == "" {
		t.Fatalf("previous_token is empty, want a recovery token back to the page just left")
	}
	if resp.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on a recovered page", resp.NextToken)
	}
	assertPublicExpectations(t, mock)
}
