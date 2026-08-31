package publicapi

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/pagination"
)

// rankingItemsJSON is the items array the ranking batch writes, cut down to
// what the handler and the query read. Building it from ids here keeps the test
// honest about the field names the snapshot actually carries.
func rankingItemsJSON(ids ...uuid.UUID) []byte {
	items := "["
	for i, id := range ids {
		if i > 0 {
			items += ","
		}
		items += fmt.Sprintf(`{"rank":%d,"entity_id":%q,"score":%d}`, i+1, id, len(ids)-i)
	}
	return []byte(items + "]")
}

// unrankedSortRank is the sort key the query gives a series the snapshot does
// not name. The tests spell it out rather than importing it, because the value
// belongs to the SQL: a token carries whatever that query reported.
const unrankedSortRank = int32(2147483647)

// rankedID is one row of the keyset scan: a series and the rank it sorted
// under.
type rankedID struct {
	id   uuid.UUID
	rank int32
}

// recommendedSeriesIDRows is what the keyset half of a page returns, already in
// the order the scan decided.
func recommendedSeriesIDRows(rows ...rankedID) *sqlmock.Rows {
	result := sqlmock.NewRows([]string{"id", "sort_rank"})
	for _, row := range rows {
		result.AddRow(row.id, row.rank)
	}
	return result
}

// recommendedSeriesRow is one row of the display query, with no eye catch
// image so the variant lookup stays out of the expectations.
func recommendedSeriesRow(rows *sqlmock.Rows, id uuid.UUID, publicID, title string, publishedAt time.Time) *sqlmock.Rows {
	return rows.AddRow(id, publicID, title, "", publishedAt, nil, nil, []byte("[]"), []byte("{}"))
}

func expectRankingSnapshotLookup(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time, items []byte) {
	mock.ExpectQuery(regexp.QuoteMeta(getLatestContentRankingSnapshotQuery)).
		WithArgs(tenantID, "weekly", "series").
		WillReturnRows(sqlmock.NewRows(contentRankingSnapshotColumns()).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, "weekly", now, now, "series", items, int32(1), now))
}

func TestCatalogListRecommendedSeriesLeadsWithTheRanking(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	rankedFirst := uuid.Must(uuid.NewV7())
	rankedSecond := uuid.Must(uuid.NewV7())
	newest := uuid.Must(uuid.NewV7())
	older := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectRankingSnapshotLookup(mock, tenantID, now, rankingItemsJSON(rankedFirst, rankedSecond))
	// The snapshot items go to the query as they are stored: the order is
	// decided in SQL, so a ranked series that has since been unpublished is
	// dropped by the same scan that orders the rest. The fourth id is the
	// over-fetched one that says another page exists.
	mock.ExpectQuery(regexp.QuoteMeta(listRecommendedSeriesIDsQuery)).
		WithArgs(nil, nil, false, nil, int32(4), rankingItemsJSON(rankedFirst, rankedSecond), tenantID).
		WillReturnRows(recommendedSeriesIDRows(
			rankedID{id: rankedFirst, rank: 1},
			rankedID{id: rankedSecond, rank: 2},
			rankedID{id: newest, rank: unrankedSortRank},
			rankedID{id: older, rank: unrankedSortRank},
		))
	// The display query is unordered; the handler puts the rows back in the
	// order the keyset scan decided.
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(
			recommendedSeriesRow(
				recommendedSeriesRow(seriesDetailColumns(), newest, "NEWEST", "Newest", now),
				rankedSecond, "SECOND", "Second", now),
			rankedFirst, "FIRST", "First", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Limit:  3,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListRecommendedSeries: %v", err)
	}

	assertSeriesPublicIDs(t, resp.Msg.Series, "FIRST", "SECOND", "NEWEST")
	if resp.Msg.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_RANKING {
		t.Fatalf("source = %v, want RANKING", resp.Msg.Source)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatalf("next_token is empty, want a token while rows remain")
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRecommendedSeriesPagesPastTheRanking(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	ranked := uuid.Must(uuid.NewV7())
	older := uuid.Must(uuid.NewV7())
	boundary := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	publishedAt := now.Add(-2 * time.Hour)
	// The last row of the previous page was an unranked one, so its token sorts
	// under the rank the query gives every series the snapshot does not name.
	token := pagination.Encode(
		pagination.Forward,
		strconv.FormatInt(int64(unrankedSortRank), 10),
		publishedAt.Format(time.RFC3339Nano),
		boundary.String(),
	)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectRankingSnapshotLookup(mock, tenantID, now, rankingItemsJSON(ranked))
	mock.ExpectQuery(regexp.QuoteMeta(listRecommendedSeriesIDsQuery)).
		WithArgs(boundary, unrankedSortRank, false, sqlmock.AnyArg(), int32(3), rankingItemsJSON(ranked), tenantID).
		WillReturnRows(recommendedSeriesIDRows(rankedID{id: older, rank: unrankedSortRank}))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), older, "OLDER", "Older", publishedAt.Add(-time.Hour)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListRecommendedSeries: %v", err)
	}

	assertSeriesPublicIDs(t, resp.Msg.Series, "OLDER")
	if resp.Msg.PreviousToken == "" {
		t.Fatalf("previous_token is empty, want a way back to the ranked page")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	// A tenant stays "ranked" on a page that shows none of its ranked series.
	if resp.Msg.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_RANKING {
		t.Fatalf("source = %v, want RANKING", resp.Msg.Source)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRecommendedSeriesFallsBackToNewArrivals(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// A tenant whose signals have never been ranked has no snapshot row at all.
	mock.ExpectQuery(regexp.QuoteMeta(getLatestContentRankingSnapshotQuery)).
		WithArgs(tenantID, "weekly", "series").
		WillReturnError(sql.ErrNoRows)
	// An empty items array leaves every series unranked, which is the
	// newest-first list.
	mock.ExpectQuery(regexp.QuoteMeta(listRecommendedSeriesIDsQuery)).
		WithArgs(nil, nil, false, nil, int32(3), []byte("[]"), tenantID).
		WillReturnRows(recommendedSeriesIDRows(rankedID{id: seriesID, rank: unrankedSortRank}))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), seriesID, "NEWEST", "Newest", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListRecommendedSeries: %v", err)
	}

	assertSeriesPublicIDs(t, resp.Msg.Series, "NEWEST")
	if resp.Msg.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_NEW_ARRIVALS {
		t.Fatalf("source = %v, want NEW_ARRIVALS", resp.Msg.Source)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRecommendedSeriesFallsBackWhenTheSnapshotIsMalformed(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// An object where the batch writes an array. The order is advisory, so the
	// storefront gets the same series in publication order rather than a 500.
	expectRankingSnapshotLookup(mock, tenantID, now, []byte(`{"broken":true}`))
	mock.ExpectQuery(regexp.QuoteMeta(listRecommendedSeriesIDsQuery)).
		WithArgs(nil, nil, false, nil, int32(3), []byte("[]"), tenantID).
		WillReturnRows(recommendedSeriesIDRows(rankedID{id: seriesID, rank: unrankedSortRank}))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), seriesID, "NEWEST", "Newest", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListRecommendedSeries: %v", err)
	}

	assertSeriesPublicIDs(t, resp.Msg.Series, "NEWEST")
	if resp.Msg.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_NEW_ARRIVALS {
		t.Fatalf("source = %v, want NEW_ARRIVALS", resp.Msg.Source)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRecommendedSeriesRecoversFromAnEmptyPage(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	boundary := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	token := pagination.Encode(
		pagination.Forward,
		"1",
		now.Format(time.RFC3339Nano),
		boundary.String(),
	)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectRankingSnapshotLookup(mock, tenantID, now, rankingItemsJSON(boundary))
	// Everything past the boundary was unpublished after the token was issued.
	mock.ExpectQuery(regexp.QuoteMeta(listRecommendedSeriesIDsQuery)).
		WithArgs(boundary, int32(1), false, sqlmock.AnyArg(), int32(3), sqlmock.AnyArg(), tenantID).
		WillReturnRows(recommendedSeriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListRecommendedSeries: %v", err)
	}

	if len(resp.Msg.Series) != 0 {
		t.Fatalf("series = %+v, want an empty page", resp.Msg.Series)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatalf("previous_token is empty, want a recovery token back to the boundary")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty when nothing follows the boundary", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRecommendedSeriesRejectsABrokenToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		// Three keys are the right count, but the rank is not a number.
		Token: pagination.Encode(pagination.Forward, "first", now.Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String()),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error code = %v, want InvalidArgument", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRecommendedSeriesRejectsAnotherTenantsRequest(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(getTenantByIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("error code = %v, want NotFound", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}
