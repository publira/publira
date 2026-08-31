package publicapi

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
)

// rankingItemsJSON is the items array the ranking batch writes, cut down to
// what the handler reads. Building it from ids here keeps the test honest
// about the field name the snapshot actually carries.
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

// recommendedSeriesRow is one row of the display query, with no eye catch
// image so the variant lookup stays out of the expectations.
func recommendedSeriesRow(rows *sqlmock.Rows, id uuid.UUID, publicID, title string, publishedAt time.Time) *sqlmock.Rows {
	return rows.AddRow(id, publicID, title, "", publishedAt, nil, nil, []byte("[]"), []byte("{}"))
}

func TestCatalogListRecommendedSeriesUsesRankingOrder(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	rankedFirst := uuid.Must(uuid.NewV7())
	unpublished := uuid.Must(uuid.NewV7())
	rankedSecond := uuid.Must(uuid.NewV7())
	newest := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getLatestContentRankingSnapshotQuery)).
		WithArgs(tenantID, "weekly", "series").
		WillReturnRows(sqlmock.NewRows(contentRankingSnapshotColumns()).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, "weekly", now, now, "series",
				rankingItemsJSON(rankedFirst, unpublished, rankedSecond), int32(1), now))
	// The display query is unordered and drops the series that has since been
	// unpublished; the handler puts what survives back in ranking order.
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(
			recommendedSeriesRow(seriesDetailColumns(), rankedSecond, "SECOND", "Second", now),
			rankedFirst, "FIRST", "First", now))
	// One slot is still open, so the top-up over-fetches by the two ranked
	// series it already holds.
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantID, nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(newest, rankedFirst, rankedSecond))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), newest, "NEWEST", "Newest", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Limit:  3,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListRecommendedSeries: %v", err)
	}

	got := make([]string, 0, len(resp.Msg.Series))
	for _, series := range resp.Msg.Series {
		got = append(got, series.PublicId)
	}
	want := []string{"FIRST", "SECOND", "NEWEST"}
	if len(got) != len(want) {
		t.Fatalf("series = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("series = %v, want %v", got, want)
		}
	}
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
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantID, nil, false, nil, int32(2)).
		WillReturnRows(seriesIDRows(seriesID))
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
	if len(resp.Msg.Series) != 1 || resp.Msg.Series[0].PublicId != "NEWEST" {
		t.Fatalf("series = %+v, want the newest published series", resp.Msg.Series)
	}
	if resp.Msg.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_NEW_ARRIVALS {
		t.Fatalf("source = %v, want NEW_ARRIVALS", resp.Msg.Source)
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
