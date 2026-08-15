package publicapi

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
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

func TestCatalogListPublishedSeriesSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	seriesImageID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows(seriesID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(seriesID, "SERIESPUB", "Public Series", "Public Synopsis", now, seriesImageID, now, []byte(`[{"public_id":"CREATOR001","name":"Author A","role":"writer","profile_text":"","icon_image_url":"/images/creators/6f4bba7c-5d8a-4bb3-8e0f-3e94985f14e8","icon_image_file_size_bytes":0,"icon_image_updated_at":""}]`), []byte(`{"public_id":"LABEL001","name":"Weekly Jump"}`)))
	mock.ExpectQuery(regexp.QuoteMeta(listSeriesImageVariantsByImageIDsQuery)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"series_image_id", "variant_type", "label", "content_type", "file_size_bytes", "width", "height"}).
			AddRow(seriesImageID, "square", "md", "image/webp", int64(2048), int32(512), int32(512)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}
	if len(resp.Msg.Series) != 1 {
		t.Fatalf("series count = %d, want 1", len(resp.Msg.Series))
	}
	if resp.Msg.Series[0].PublicId != "SERIESPUB" {
		t.Fatalf("series public_id = %q, want SERIESPUB", resp.Msg.Series[0].PublicId)
	}
	if len(resp.Msg.Series[0].Creators) != 1 || resp.Msg.Series[0].Creators[0].IconImageUrl == "" {
		t.Fatalf("series creators = %+v, want creator icon_image_url", resp.Msg.Series[0].Creators)
	}
	if got := len(resp.Msg.Series[0].EyeCatchImageVariants); got != 1 {
		t.Fatalf("eye_catch_image_variants count = %d, want 1", got)
	}
	if resp.Msg.Series[0].EyeCatchImageVariants[0].Url == "" {
		t.Fatalf("eye_catch_image_variants url is empty")
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty when every row fits in one page", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func seriesDetailColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "public_id", "title", "synopsis", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "creators", "label_info"})
}

// seriesIDRows is what the keyset half of a page returns: ids only, already in
// page order.
func seriesIDRows(ids ...uuid.UUID) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"id"})
	for _, id := range ids {
		rows.AddRow(id)
	}
	return rows
}

// seriesDetailRows builds the display rows for `ids`, one second apart starting
// at `newest`, so the cursor keys of the rows differ.
func seriesDetailRows(newest time.Time, ids []uuid.UUID) *sqlmock.Rows {
	rows := seriesDetailColumns()
	for i, id := range ids {
		publishedAt := newest.Add(-time.Duration(i) * time.Second)
		rows.AddRow(id, fmt.Sprintf("SERIES%03d", i), fmt.Sprintf("Series %d", i), nil, publishedAt, nil, nil, []byte(`[]`), []byte(`{}`))
	}
	return rows
}

// newSeriesIDs makes `count` ids in the order a page would return them.
func newSeriesIDs(count int) []uuid.UUID {
	ids := make([]uuid.UUID, 0, count)
	for range count {
		ids = append(ids, uuid.Must(uuid.NewV7()))
	}
	return ids
}

func TestCatalogListPublishedSeriesFirstPageReportsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	// The handler asks for one id past the page to learn that a next page exists.
	ids := newSeriesIDs(3)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantID, nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailRows(now, ids[:2]))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	if got := len(resp.Msg.Series); got != 2 {
		t.Fatalf("series count = %d, want the over-fetched row dropped", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token for the next page")
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesFollowsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryPublishedAt := now.Add(-time.Second)
	token := pagination.Encode(pagination.Forward, "published_at_desc", boundaryPublishedAt.Format(time.RFC3339Nano), boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(1)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryPublishedAt, int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailRows(now.Add(-2*time.Second), ids))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	if got := len(resp.Msg.Series); got != 1 {
		t.Fatalf("series count = %d, want 1", got)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesFollowsPreviousTokenBackwards(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryPublishedAt := now.Add(-10 * time.Second)
	token := pagination.Encode(pagination.Backward, "published_at_desc", boundaryPublishedAt.Format(time.RFC3339Nano), boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// A backward page scans ascending, so the oldest id of the page comes first.
	olderID := uuid.Must(uuid.NewV7())
	newerID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtAscQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryPublishedAt, int32(3)).
		WillReturnRows(seriesIDRows(olderID, newerID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(olderID, "SERIES_OLD", "Older", nil, now.Add(-2*time.Second), nil, nil, []byte(`[]`), []byte(`{}`)).
			AddRow(newerID, "SERIES_NEW", "Newer", nil, now.Add(-time.Second), nil, nil, []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	got := make([]string, 0, len(resp.Msg.Series))
	for _, series := range resp.Msg.Series {
		got = append(got, series.PublicId)
	}
	if !slices.Equal(got, []string{"SERIES_NEW", "SERIES_OLD"}) {
		t.Fatalf("series = %v, want the backward page flipped back to newest first", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesEmptyPageKeepsAWayBack(t *testing.T) {
	for _, test := range seriesRecoveryCases() {
		t.Run(test.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			sortKey, sortArg := test.boundarySortKey(now)
			token := pagination.Encode(test.direction, test.orderName, sortKey, boundaryID.String())

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, false, sortArg, int32(21)).
				WillReturnRows(seriesIDRows())

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Order:  test.order,
				Token:  token,
			}))
			if err != nil {
				t.Fatalf("ListPublishedSeries: %v", err)
			}

			if len(resp.Msg.Series) != 0 {
				t.Fatalf("series = %+v, want an empty page", resp.Msg.Series)
			}
			wantPrevious := test.direction == pagination.Forward
			if (resp.Msg.PreviousToken != "") != wantPrevious {
				t.Fatalf("previous_token = %q, want present: %t", resp.Msg.PreviousToken, wantPrevious)
			}
			if (resp.Msg.NextToken != "") == wantPrevious {
				t.Fatalf("next_token = %q, want present: %t", resp.Msg.NextToken, !wantPrevious)
			}

			// The recovery token points back the way the client came and is
			// marked inclusive, so the boundary row is in the page it returns.
			recoveryToken := resp.Msg.PreviousToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.Msg.NextToken
				recoveryDirection = pagination.Forward
			}
			cursor, err := pagination.Decode(recoveryToken)
			if err != nil {
				t.Fatalf("decode recovery token: %v", err)
			}
			wantKeys := []string{test.orderName, sortKey, boundaryID.String(), seriesInclusiveKey}
			if cursor.Direction != recoveryDirection || !slices.Equal(cursor.Keys, wantKeys) {
				t.Fatalf("recovery token = %+v, want direction %q and keys %v", cursor, recoveryDirection, wantKeys)
			}

			assertPublicExpectations(t, mock)
		})
	}
}

// seriesRecoveryCase is one empty page: the order it was requested in, the
// direction the client was moving, and the keyset query that answers it.
// published_at and title are separate SQL branches carrying different sort key
// types, so both orders are walked in each direction.
type seriesRecoveryCase struct {
	name          string
	order         publirav1.SeriesOrder
	orderName     string
	boundaryTitle string
	direction     pagination.Direction
	wantQuery     string
}

// boundarySortKey returns the boundary value as the token spells it and as the
// query receives it. A title order carries the title itself; the default order
// carries a timestamp, which only the caller's clock can supply.
func (c seriesRecoveryCase) boundarySortKey(now time.Time) (string, any) {
	if c.boundaryTitle != "" {
		return c.boundaryTitle, c.boundaryTitle
	}
	return now.Format(time.RFC3339Nano), now
}

func seriesRecoveryCases() []seriesRecoveryCase {
	return []seriesRecoveryCase{
		{
			name:      "forward by published_at into a page whose rows are gone",
			order:     publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_DESC,
			orderName: "published_at_desc",
			direction: pagination.Forward,
			wantQuery: listActiveSeriesIDsByPublishedAtDescQuery,
		},
		{
			name:      "backward by published_at into a page whose rows are gone",
			order:     publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_DESC,
			orderName: "published_at_desc",
			direction: pagination.Backward,
			wantQuery: listActiveSeriesIDsByPublishedAtAscQuery,
		},
		{
			name:          "forward by title into a page whose rows are gone",
			order:         publirav1.SeriesOrder_SERIES_ORDER_TITLE_ASC,
			orderName:     "title_asc",
			boundaryTitle: "Series 001",
			direction:     pagination.Forward,
			wantQuery:     listActiveSeriesIDsByTitleAscQuery,
		},
		{
			name:          "backward by title into a page whose rows are gone",
			order:         publirav1.SeriesOrder_SERIES_ORDER_TITLE_ASC,
			orderName:     "title_asc",
			boundaryTitle: "Series 001",
			direction:     pagination.Backward,
			wantQuery:     listActiveSeriesIDsByTitleDescQuery,
		},
	}
}

// Recovery happens once. When the boundary row itself is gone the recovery
// query is empty too, and both tokens stay empty so the client falls back to
// the first page instead of bouncing between empty pages.
func TestCatalogListPublishedSeriesEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	// The recovery token's own direction picks the query, so the cases the
	// empty page produced are the cases coming back in.
	for _, test := range seriesRecoveryCases() {
		t.Run(test.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			sortKey, sortArg := test.boundarySortKey(now)
			token := pagination.Encode(
				test.direction,
				test.orderName,
				sortKey,
				boundaryID.String(),
				seriesInclusiveKey,
			)

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, true, sortArg, int32(21)).
				WillReturnRows(seriesIDRows())

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Order:  test.order,
				Token:  token,
			}))
			if err != nil {
				t.Fatalf("ListPublishedSeries: %v", err)
			}

			if len(resp.Msg.Series) != 0 {
				t.Fatalf("series = %+v, want an empty page", resp.Msg.Series)
			}
			if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
				t.Fatalf(
					"previous_token = %q / next_token = %q, want both empty once recovery also came back empty",
					resp.Msg.PreviousToken, resp.Msg.NextToken,
				)
			}

			assertPublicExpectations(t, mock)
		})
	}
}

func TestCatalogListPublishedSeriesSortsByRequestedOrder(t *testing.T) {
	tests := []struct {
		name      string
		order     publirav1.SeriesOrder
		wantQuery string
	}{
		{
			name:      "unspecified falls back to newest first",
			order:     publirav1.SeriesOrder_SERIES_ORDER_UNSPECIFIED,
			wantQuery: listActiveSeriesIDsByPublishedAtDescQuery,
		},
		{
			name:      "oldest first",
			order:     publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_ASC,
			wantQuery: listActiveSeriesIDsByPublishedAtAscQuery,
		},
		{
			name:      "title ascending",
			order:     publirav1.SeriesOrder_SERIES_ORDER_TITLE_ASC,
			wantQuery: listActiveSeriesIDsByTitleAscQuery,
		},
		{
			name:      "title descending",
			order:     publirav1.SeriesOrder_SERIES_ORDER_TITLE_DESC,
			wantQuery: listActiveSeriesIDsByTitleDescQuery,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			expectTenantLookup(mock, tenantID, "TENANT", time.Now())
			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, nil, false, nil, int32(21)).
				WillReturnRows(seriesIDRows())

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Order:  test.order,
			}))
			if err != nil {
				t.Fatalf("ListPublishedSeries: %v", err)
			}

			assertPublicExpectations(t, mock)
		})
	}
}

func TestCatalogListPublishedSeriesTitleTokenCarriesTheTitleKey(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "title_asc", "Series 001", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByTitleAscQuery)).
		WithArgs(tenantID, boundaryID, false, "Series 001", int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Order:  publirav1.SeriesOrder_SERIES_ORDER_TITLE_ASC,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesRejectsTokenFromAnotherOrder(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "published_at_desc", time.Now().UTC().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Order:  publirav1.SeriesOrder_SERIES_ORDER_TITLE_ASC,
		Token:  token,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument when the token was built for another order", err)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesRejectsUnknownOrder(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Order:  publirav1.SeriesOrder(99),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}

	assertPublicExpectations(t, mock)
}

// The fourth key exists only to mark a recovery cursor, so anything else in
// that position is a token this server did not issue.
func TestCatalogListPublishedSeriesRejectsUnknownFourthKey(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	token := pagination.Encode(
		pagination.Forward,
		"published_at_desc",
		now.Format(time.RFC3339Nano),
		uuid.Must(uuid.NewV7()).String(),
		"exclusive",
	)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("error = %q, want token internals hidden", err)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesRejectsBrokenToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  "not-a-token",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesLimitOutOfRangeUsesDefault(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  101,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesTenantIsolation(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantAID := uuid.Must(uuid.NewV7())
	tenantBID := uuid.Must(uuid.NewV7())
	now := time.Now()
	seriesAID := uuid.Must(uuid.NewV7())
	seriesBID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantAID, "TENANT_A", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantAID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows(seriesAID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantAID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(seriesAID, "SERIES_A", "Series A", "Synopsis A", now, nil, nil, []byte(`[]`), []byte(`{}`)))
	expectTenantLookup(mock, tenantBID, "TENANT_B", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantBID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows(seriesBID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantBID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(seriesBID, "SERIES_B", "Series B", "Synopsis B", now, nil, nil, []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	respA, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantAID.String()},
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries for TENANT_A: %v", err)
	}
	respB, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantBID.String()},
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries for TENANT_B: %v", err)
	}

	if len(respA.Msg.Series) != 1 || respA.Msg.Series[0].PublicId != "SERIES_A" {
		t.Fatalf("TENANT_A response = %+v, want SERIES_A only", respA.Msg.Series)
	}
	if len(respB.Msg.Series) != 1 || respB.Msg.Series[0].PublicId != "SERIES_B" {
		t.Fatalf("TENANT_B response = %+v, want SERIES_B only", respB.Msg.Series)
	}

	assertPublicExpectations(t, mock)
}

func TestListActiveSeriesQueriesHavePublicationGuards(t *testing.T) {
	// Both halves of a page filter on their own; neither may lean on the other
	// to keep unpublished series out.
	queries := map[string]string{
		"listActiveSeriesIDsByPublishedAtDesc": listActiveSeriesIDsByPublishedAtDescQuery,
		"listActiveSeriesIDsByPublishedAtAsc":  listActiveSeriesIDsByPublishedAtAscQuery,
		"listActiveSeriesIDsByTitleAsc":        listActiveSeriesIDsByTitleAscQuery,
		"listActiveSeriesIDsByTitleDesc":       listActiveSeriesIDsByTitleDescQuery,
		"listActiveSeriesByIDs":                listActiveSeriesByIDsQuery,
	}
	requiredSnippets := []string{
		"s.is_published = true",
		"s.published_at IS NOT NULL",
		"s.published_at <= NOW()",
	}
	for name, query := range queries {
		for _, snippet := range requiredSnippets {
			if !strings.Contains(query, snippet) {
				t.Fatalf("%s does not contain %q", name, snippet)
			}
		}
	}
}

func TestCatalogGetSeriesDetailContract(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	seriesImageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIESPUB", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "eye_catch_image_id", "eye_catch_image_updated_at", "synopsis", "is_published", "published_at", "creators", "episodes"}).
			AddRow(
				seriesID,
				"SERIESPUB",
				"Public Series",
				"LABEL001",
				"Weekly Jump",
				seriesImageID,
				nil,
				"Public Synopsis",
				true,
				now,
				[]byte(`[{"name":"Author A","role":"writer","icon_image_url":"/images/creators/6f4bba7c-5d8a-4bb3-8e0f-3e94985f14e8","icon_image_file_size_bytes":0,"icon_image_updated_at":""}]`),
				[]byte(`[{"public_id":"EP001","title":"Episode 1","order_index":1,"price":100,"reading_period_hours":24,"status":"published","scheduled_at":null,"published_at":"2026-03-18T00:00:00Z"}]`),
			))
	mock.ExpectQuery(regexp.QuoteMeta(listSeriesImageVariantsByImageIDsQuery)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"series_image_id", "variant_type", "label", "content_type", "file_size_bytes", "width", "height"}).
			AddRow(seriesImageID, "portrait", "md", "image/webp", int64(3072), int32(768), int32(1024)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "SERIESPUB",
	}))
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}

	if resp.Msg.Series == nil {
		t.Fatalf("series is nil")
	}
	if resp.Msg.Series.PublicId != "SERIESPUB" {
		t.Fatalf("series public_id = %q, want SERIESPUB", resp.Msg.Series.PublicId)
	}
	if resp.Msg.Series.Label == nil || resp.Msg.Series.Label.Name != "Weekly Jump" {
		t.Fatalf("series label = %+v, want Weekly Jump", resp.Msg.Series.Label)
	}
	if len(resp.Msg.Series.Creators) != 1 || resp.Msg.Series.Creators[0].Name != "Author A" {
		t.Fatalf("series creators = %+v, want one creator Author A", resp.Msg.Series.Creators)
	}
	if got := len(resp.Msg.Series.EyeCatchImageVariants); got != 1 {
		t.Fatalf("eye_catch_image_variants count = %d, want 1", got)
	}
	if resp.Msg.Series.Creators[0].IconImageUrl == "" {
		t.Fatalf("creator icon_image_url is empty")
	}
	if len(resp.Msg.Episodes) != 1 || resp.Msg.Episodes[0].PublicId != "EP001" {
		t.Fatalf("episodes = %+v, want one published episode EP001", resp.Msg.Episodes)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogGetSeriesDetailReturnsPermissionDeniedForUnpublishedSeries(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIES_DRAFT", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "eye_catch_image_id", "eye_catch_image_updated_at", "synopsis", "is_published", "published_at", "creators", "episodes"}).
			AddRow(uuid.Must(uuid.NewV7()), "SERIES_DRAFT", "Draft Series", nil, nil, nil, nil, nil, false, nil, []byte(`[]`), []byte(`[]`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "SERIES_DRAFT",
	}))

	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("GetSeriesDetail code = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogGetSeriesDetailReturnsNotFoundForMissingSeries(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIES_MISSING", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "eye_catch_image_id", "eye_catch_image_updated_at", "synopsis", "is_published", "published_at", "creators", "episodes"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "SERIES_MISSING",
	}))

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetSeriesDetail code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogGetSeriesDetailDatabaseErrorIsHidden(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIESPUB", tenantID).
		WillReturnError(errors.New(`pq: relation "series" does not exist`))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "SERIESPUB",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetSeriesDetail code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetSeriesDetailPreservesContextCanceled(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIESPUB", tenantID).
		WillReturnError(context.Canceled)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "SERIESPUB",
	}))
	if connect.CodeOf(err) != connect.CodeCanceled {
		t.Fatalf("GetSeriesDetail code = %v, want %v", connect.CodeOf(err), connect.CodeCanceled)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesDatabaseErrorIsHidden(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantID, nil, false, nil, int32(21)).
		WillReturnError(errors.New(`pq: relation "series" does not exist`))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListPublishedSeries code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetEpisodeDetailTenantBoundary(t *testing.T) {
	normalEpisodeID := uuid.Must(uuid.NewV7())

	tests := []struct {
		episodeID uuid.UUID
		name      string
		publicID  string
		rows      *sqlmock.Rows
		wantCode  connect.Code
	}{
		{
			// Paid episode without session: metadata OK, body locked (no images).
			episodeID: normalEpisodeID,
			name:      "normal-paid-locked",
			publicID:  "EPISODE001",
			rows: sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}).
				AddRow(normalEpisodeID, "EPISODE001", "Episode Title", int32(1), int32(100), int32(24), "published", nil, time.Now().UTC(), "SERIES001", "Series Title"),
		},
		{
			name:     "unpublished",
			publicID: "EPISODE_DRAFT",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "scheduled-boundary-not-reached",
			publicID: "EPISODE_SCHEDULED",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "cross-tenant",
			publicID: "EPISODE_OTHER_TENANT",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "not-found",
			publicID: "EPISODE_MISSING",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}),
			wantCode: connect.CodeNotFound,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now()

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(getPublishedEpisodeByPublicIDQuery)).
				WithArgs(tenantID, tc.publicID).
				WillReturnRows(tc.rows)

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			resp, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				PublicId: tc.publicID,
			}))

			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("GetEpisodeDetail: %v", err)
				}
				if resp.Msg.Episode == nil {
					t.Fatalf("episode is nil")
				}
				if resp.Msg.Episode.PublicId != tc.publicID {
					t.Fatalf("episode public_id = %q, want %q", resp.Msg.Episode.PublicId, tc.publicID)
				}
				if resp.Msg.Series == nil || resp.Msg.Series.PublicId != "SERIES001" {
					t.Fatalf("series public_id = %q, want SERIES001", resp.Msg.Series.GetPublicId())
				}
				if resp.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
					t.Fatalf("access = %v, want %v", resp.Msg.Access, publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED)
				}
				if len(resp.Msg.Images) != 0 {
					t.Fatalf("images count = %d, want 0 for locked paid episode", len(resp.Msg.Images))
				}
			} else {
				if connect.CodeOf(err) != tc.wantCode {
					t.Fatalf("GetEpisodeDetail code = %v, want %v", connect.CodeOf(err), tc.wantCode)
				}
			}
			assertPublicExpectations(t, mock)
		})
	}
}

func TestCatalogGetEpisodeDetailAccessEvaluation(t *testing.T) {
	tests := []struct {
		name   string
		price  int32
		authed bool
		// invalidBearer sends Authorization with a non-verifiable token (no auth SQL expected).
		invalidBearer    bool
		hasContentAccess bool
		wantAccess       publirav1.EpisodeAccess
		wantImageCount   int
	}{
		{
			name:           "free-unauthenticated",
			price:          0,
			wantAccess:     publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
			wantImageCount: 1,
		},
		{
			name:           "paid-unauthenticated-locked",
			price:          500,
			wantAccess:     publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			wantImageCount: 0,
		},
		{
			name:             "paid-authed-with-ticket-entitled",
			price:            500,
			authed:           true,
			hasContentAccess: true,
			wantAccess:       publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED,
			wantImageCount:   1,
		},
		{
			name:             "paid-authed-without-grant-locked",
			price:            500,
			authed:           true,
			hasContentAccess: false,
			wantAccess:       publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			wantImageCount:   0,
		},
		{
			name:           "paid-invalid-bearer-locked",
			price:          500,
			invalidBearer:  true,
			wantAccess:     publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			wantImageCount: 0,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			episodeID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now()

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(getPublishedEpisodeByPublicIDQuery)).
				WithArgs(tenantID, "EPISODE001").
				WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at", "series_public_id", "series_title"}).
					AddRow(episodeID, "EPISODE001", "Episode Title", int32(1), tc.price, int32(24), "published", nil, now.UTC(), "SERIES001", "Series Title"))

			if tc.authed {
				// authenticateAccessToken looks up tenant again via tenantByContext
				expectTenantLookup(mock, tenantID, "TENANT", now)
				expectAuthSession(mock, tenantID, userID, now)
				mock.ExpectQuery(regexp.QuoteMeta(userHasEpisodeContentAccessQuery)).
					WithArgs(tenantID, userID, episodeID).
					WillReturnRows(sqlmock.NewRows([]string{"has_access"}).AddRow(tc.hasContentAccess))
			} else if tc.invalidBearer {
				// Token verify fails after tenant re-lookup; no content-access or images queries.
				expectTenantLookup(mock, tenantID, "TENANT", now)
			}

			if tc.wantImageCount > 0 {
				mock.ExpectQuery(regexp.QuoteMeta(listEpisodeImagesByEpisodeIDQuery)).
					WithArgs(episodeID).
					WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "episode_id", "display_order", "created_at", "content_type", "file_size_bytes", "width", "height"}).
						AddRow(uuid.Must(uuid.NewV7()), tenantID, episodeID, int32(1), now, "image/png", int64(1024), int32(1200), int32(1800)))
			}

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			var req *connect.Request[publirav1.GetEpisodeDetailRequest]
			switch {
			case tc.authed:
				req = newAuthedPublicRequest(&publirav1.GetEpisodeDetailRequest{
					Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
					PublicId: "EPISODE001",
				}, tenantID.String())
			case tc.invalidBearer:
				req = connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
					Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
					PublicId: "EPISODE001",
				})
				req.Header().Set("Authorization", "Bearer not-a-valid-jwt")
			default:
				req = connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
					Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
					PublicId: "EPISODE001",
				})
			}

			resp, err := client.GetEpisodeDetail(context.Background(), req)
			if err != nil {
				t.Fatalf("GetEpisodeDetail: %v", err)
			}
			if resp.Msg.Access != tc.wantAccess {
				t.Fatalf("access = %v, want %v", resp.Msg.Access, tc.wantAccess)
			}
			if len(resp.Msg.Images) != tc.wantImageCount {
				t.Fatalf("images count = %d, want %d", len(resp.Msg.Images), tc.wantImageCount)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

func TestGetPublishedEpisodeQueryHasPublicationGuards(t *testing.T) {
	requiredSnippets := []string{
		"s.is_published = true",
		"s.published_at IS NOT NULL",
		"s.published_at <= NOW()",
		"el.status = 'published'",
		"el.published_at IS NOT NULL",
		"el.published_at <= NOW()",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(getPublishedEpisodeByPublicIDQuery, snippet) {
			t.Fatalf("getPublishedEpisodeByPublicIDQuery does not contain %q", snippet)
		}
	}
}

func TestUserHasEpisodeContentAccessQueryCoversPurchasesAndTickets(t *testing.T) {
	requiredSnippets := []string{
		"FROM purchases p",
		"FROM access_tickets at",
		"at.revoked_at IS NULL",
		"at.expires_at > NOW()",
		"p.expires_at > NOW()",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(userHasEpisodeContentAccessQuery, snippet) {
			t.Fatalf("userHasEpisodeContentAccessQuery does not contain %q", snippet)
		}
	}
}
