package publicapi

import (
	"context"
	"database/sql"
	"regexp"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/recommendfeatures"
	"github.com/publira/publira/server/internal/testutil"
)

type myRecommendedFixture struct {
	client   publirav1connect.CatalogServiceClient
	mock     sqlmock.Sqlmock
	tenantID uuid.UUID
	userID   uuid.UUID
	now      time.Time
	// call is the CallInfo of the fixture's latest RPC, which carries the
	// response headers.
	call *connect.CallInfo
}

func newMyRecommendedFixture(t *testing.T) *myRecommendedFixture {
	t.Helper()

	testServer, mock := newTestPublicServer(t)
	fixture := &myRecommendedFixture{
		client:   publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL))),
		mock:     mock,
		tenantID: uuid.Must(uuid.NewV7()),
		userID:   uuid.Must(uuid.NewV7()),
		now:      time.Now().UTC().Truncate(time.Microsecond),
	}
	expectTenantLookup(mock, fixture.tenantID, "TENANT", fixture.now)
	expectAuthSession(mock, fixture.tenantID, fixture.userID, fixture.now)
	return fixture
}

func (f *myRecommendedFixture) list(limit int32, token string) (*publirav1.ListMyRecommendedSeriesResponse, error) {
	ctx, call := testutil.NewClientContext(testutil.WithBearer(context.Background(), issueTestPublicToken(f.tenantID.String())))
	f.call = call
	return f.client.ListMyRecommendedSeries(ctx, &publirav1.ListMyRecommendedSeriesRequest{
		Limit:  limit,
		Tenant: &publirattypesv1.TenantContext{TenantId: f.tenantID.String()},
		Token:  token,
	})
}

// expectFeatures stands in for the check that decides which order the reader
// gets. It is asked for the version this build writes, never for any row.
func (f *myRecommendedFixture) expectFeatures(has bool) {
	f.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.HasUserRecommendFeatures)).
		WithArgs(f.tenantID, f.userID, int32(recommendfeatures.FeatureVersion)).
		WillReturnRows(sqlmock.NewRows([]string{"has_features"}).AddRow(has))
}

// readerScoredID is one row of the reader-order keyset scan.
type readerScoredID struct {
	id         uuid.UUID
	engaged    int32
	score      int64
	popularity int64
}

func readerScoredSeriesIDRows(rows ...readerScoredID) *sqlmock.Rows {
	result := sqlmock.NewRows([]string{"id", "engaged", "score", "popularity"})
	for _, row := range rows {
		result.AddRow(row.id, row.engaged, row.score, row.popularity)
	}
	return result
}

// readerOrderToken is a token of the reader's own order, built the way the
// handler builds one: the sort keys, then the order, then the surface.
func readerOrderToken(direction pagination.Direction, row readerScoredID, publishedAt time.Time) string {
	token := pagination.Encode(
		direction,
		strconv.FormatInt(int64(row.engaged), 10),
		strconv.FormatInt(row.score, 10),
		strconv.FormatInt(row.popularity, 10),
		publishedAt.UTC().Format(time.RFC3339Nano),
		row.id.String(),
	)
	bindRecommendedOrderTokens(readerRecommendedOrderKey, &token)
	return onWeb(token)
}

func TestListMyRecommendedSeriesOrdersByTheReadersFeatures(t *testing.T) {
	fixture := newMyRecommendedFixture(t)
	first := readerScoredID{id: uuid.Must(uuid.NewV7()), score: 300, popularity: 40}
	second := readerScoredID{id: uuid.Must(uuid.NewV7()), score: 0, popularity: 90}
	beyond := readerScoredID{id: uuid.Must(uuid.NewV7()), engaged: 1, score: 0, popularity: 500}

	fixture.expectFeatures(true)
	// The fourth argument onwards: no cursor, one row past the page, and the
	// reader's own row read under the version this build writes.
	fixture.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListMyRecommendedSeriesIDs)).
		WithArgs(uuid.NullUUID{}, sql.NullInt32{}, sql.NullInt64{}, sql.NullInt64{}, false, sql.NullTime{}, int32(3),
			fixture.tenantID, fixture.userID, int32(recommendfeatures.FeatureVersion), "UTC", "web").
		WillReturnRows(readerScoredSeriesIDRows(first, second, beyond))
	fixture.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", fixture.tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(
			recommendedSeriesRow(seriesDetailColumns(), second.id, "SECOND", "Second", fixture.now),
			first.id, "FIRST", "First", fixture.now))

	resp, err := fixture.list(2, "")
	if err != nil {
		t.Fatalf("ListMyRecommendedSeries: %v", err)
	}

	assertSeriesPublicIDs(t, resp.Series, "FIRST", "SECOND")
	if resp.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_READER_FEATURES {
		t.Fatalf("source = %v, want READER_FEATURES", resp.Source)
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.PreviousToken)
	}
	// The token carries the keys the scan reported for the last row that
	// stayed on the page, under the order it was built in.
	if want := readerOrderToken(pagination.Forward, second, fixture.now); resp.NextToken != want {
		t.Fatalf("next_token = %q, want %q", resp.NextToken, want)
	}
	if got := fixture.call.ResponseHeader().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestListMyRecommendedSeriesReadsTheBackwardDirectionReversed(t *testing.T) {
	fixture := newMyRecommendedFixture(t)
	boundary := readerScoredID{id: uuid.Must(uuid.NewV7()), score: 120, popularity: 7}
	before := readerScoredID{id: uuid.Must(uuid.NewV7()), score: 300, popularity: 0}
	publishedAt := fixture.now.Add(-time.Hour)

	fixture.expectFeatures(true)
	fixture.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListMyRecommendedSeriesIDsReversed)).
		WithArgs(
			uuid.NullUUID{UUID: boundary.id, Valid: true},
			sql.NullInt32{Int32: 0, Valid: true},
			sql.NullInt64{Int64: 120, Valid: true},
			sql.NullInt64{Int64: 7, Valid: true},
			false,
			sql.NullTime{Time: publishedAt, Valid: true},
			int32(21),
			fixture.tenantID, fixture.userID, int32(recommendfeatures.FeatureVersion), "UTC", "web").
		WillReturnRows(readerScoredSeriesIDRows(before))
	fixture.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", fixture.tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), before.id, "BEFORE", "Before", fixture.now))

	resp, err := fixture.list(0, readerOrderToken(pagination.Backward, boundary, publishedAt))
	if err != nil {
		t.Fatalf("ListMyRecommendedSeries: %v", err)
	}
	assertSeriesPublicIDs(t, resp.Series, "BEFORE")
	if resp.NextToken == "" {
		t.Fatal("next_token is empty, want the way back to the page the client came from")
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan ran out", resp.PreviousToken)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestListMyRecommendedSeriesRecoversOnceFromAnEmptyPage(t *testing.T) {
	fixture := newMyRecommendedFixture(t)
	boundary := readerScoredID{id: uuid.Must(uuid.NewV7()), engaged: 1, score: 8, popularity: 3}
	publishedAt := fixture.now.Add(-time.Hour)

	fixture.expectFeatures(true)
	fixture.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListMyRecommendedSeriesIDs)).
		WithArgs(
			uuid.NullUUID{UUID: boundary.id, Valid: true},
			sql.NullInt32{Int32: 1, Valid: true},
			sql.NullInt64{Int64: 8, Valid: true},
			sql.NullInt64{Int64: 3, Valid: true},
			false,
			sql.NullTime{Time: publishedAt, Valid: true},
			int32(21),
			fixture.tenantID, fixture.userID, int32(recommendfeatures.FeatureVersion), "UTC", "web").
		WillReturnRows(readerScoredSeriesIDRows())

	resp, err := fixture.list(0, readerOrderToken(pagination.Forward, boundary, publishedAt))
	if err != nil {
		t.Fatalf("ListMyRecommendedSeries: %v", err)
	}
	if len(resp.Series) != 0 {
		t.Fatalf("series = %d, want none", len(resp.Series))
	}
	recovery := pagination.Encode(
		pagination.Backward,
		"1", "8", "3",
		publishedAt.UTC().Format(time.RFC3339Nano),
		boundary.id.String(),
		seriesInclusiveKey,
	)
	bindRecommendedOrderTokens(readerRecommendedOrderKey, &recovery)
	if want := onWeb(recovery); resp.PreviousToken != want {
		t.Fatalf("previous_token = %q, want the recovery token back to the boundary row", resp.PreviousToken)
	}
	if resp.NextToken != "" {
		t.Fatalf("next_token = %q, want empty", resp.NextToken)
	}
	assertPublicExpectations(t, fixture.mock)
}

// A reader the batch has nothing for gets the tenant-wide page, read exactly
// the way ListRecommendedSeries reads it, but still as a private response.
func TestListMyRecommendedSeriesFallsBackToTheTenantOrderWithoutFeatures(t *testing.T) {
	fixture := newMyRecommendedFixture(t)
	ranked := uuid.Must(uuid.NewV7())
	newest := uuid.Must(uuid.NewV7())

	fixture.expectFeatures(false)
	expectRankingSnapshotLookup(fixture.mock, fixture.tenantID, fixture.now, rankingItemsJSON(ranked))
	fixture.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListRecommendedSeriesIDs)).
		WithArgs(nil, nil, false, nil, int32(2), rankingItemsJSON(ranked), fixture.tenantID, "web").
		WillReturnRows(recommendedSeriesIDRows(
			rankedID{id: ranked, rank: 1},
			rankedID{id: newest, rank: unrankedSortRank},
		))
	fixture.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", fixture.tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), ranked, "RANKED", "Ranked", fixture.now))

	resp, err := fixture.list(1, "")
	if err != nil {
		t.Fatalf("ListMyRecommendedSeries: %v", err)
	}
	assertSeriesPublicIDs(t, resp.Series, "RANKED")
	if resp.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_RANKING {
		t.Fatalf("source = %v, want RANKING", resp.Source)
	}
	next := encodeRecommendedCursor(pagination.Forward, 1, dbmodels.ListActiveSeriesByIDsRow{
		ID:          ranked,
		PublishedAt: sql.NullTime{Time: fixture.now, Valid: true},
	})
	bindRecommendedOrderTokens(tenantRecommendedOrderKey, &next)
	if want := onWeb(next); resp.NextToken != want {
		t.Fatalf("next_token = %q, want the tenant-order token %q", resp.NextToken, want)
	}
	if got := fixture.call.ResponseHeader().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

// A token names a position in one order. Once the batch has written or
// dropped the reader's features, that position is not one the other order
// has, so the client is told to start over rather than shown a wrong page.
func TestListMyRecommendedSeriesRejectsATokenFromTheOtherOrder(t *testing.T) {
	tenantOrder := pagination.Encode(pagination.Forward, "1", time.Now().UTC().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String())
	bindRecommendedOrderTokens(tenantRecommendedOrderKey, &tenantOrder)
	readerOrder := readerOrderToken(pagination.Forward, readerScoredID{id: uuid.Must(uuid.NewV7()), score: 1}, time.Now())

	cases := map[string]struct {
		hasFeatures bool
		token       string
	}{
		"a tenant-order token once the reader has features": {hasFeatures: true, token: onWeb(tenantOrder)},
		"a reader-order token once the features are gone":   {hasFeatures: false, token: readerOrder},
		// ListRecommendedSeries's own tokens carry no order at all.
		"a token of the shared list": {hasFeatures: false, token: webToken(pagination.Forward, "1", time.Now().UTC().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String())},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			fixture := newMyRecommendedFixture(t)
			fixture.expectFeatures(tc.hasFeatures)

			_, err := fixture.list(0, tc.token)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("ListMyRecommendedSeries error = %v, want invalid_argument", err)
			}
			assertPublicExpectations(t, fixture.mock)
		})
	}
}

func TestListMyRecommendedSeriesRejectsAMalformedReaderToken(t *testing.T) {
	cases := map[string][]string{
		"too few keys":            {"0", "1", "2", time.Now().UTC().Format(time.RFC3339Nano)},
		"an engaged flag of 2":    {"2", "1", "2", time.Now().UTC().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String()},
		"a score that is text":    {"0", "high", "2", time.Now().UTC().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String()},
		"an unknown trailing key": {"0", "1", "2", time.Now().UTC().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String(), "again"},
	}
	for name, keys := range cases {
		t.Run(name, func(t *testing.T) {
			fixture := newMyRecommendedFixture(t)
			fixture.expectFeatures(true)
			token := pagination.Encode(pagination.Forward, keys...)
			bindRecommendedOrderTokens(readerRecommendedOrderKey, &token)

			_, err := fixture.list(0, onWeb(token))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("ListMyRecommendedSeries error = %v, want invalid_argument", err)
			}
			assertPublicExpectations(t, fixture.mock)
		})
	}
}

func TestListMyRecommendedSeriesRequiresASession(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", time.Now().UTC())
	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))

	_, err := client.ListMyRecommendedSeries(context.Background(), &publirav1.ListMyRecommendedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListMyRecommendedSeries without a bearer error = %v, want unauthenticated", err)
	}
	assertPublicExpectations(t, mock)
}
