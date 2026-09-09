package publicapi

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"regexp"
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

// What the filters and the latest-update order do to the rows is settled
// against a real database; these cases settle the handler's own half — which
// query a request reaches, what its token names, and which requests never
// reach a query at all.

func expectGenreLookup(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, found bool) {
	query := mock.ExpectQuery(regexp.QuoteMeta(getGenreIDByPublicIDForTenantQuery)).WithArgs(tenantID, publicID)
	if !found {
		query.WillReturnError(sql.ErrNoRows)
		return
	}
	query.WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(uuid.Must(uuid.NewV7())))
}

func expectTagLookup(mock sqlmock.Sqlmock, tenantID uuid.UUID, slug string, found bool) {
	query := mock.ExpectQuery(regexp.QuoteMeta(getTagBySlugForTenantQuery)).WithArgs(tenantID, slug)
	if !found {
		query.WillReturnError(sql.ErrNoRows)
		return
	}
	query.WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(uuid.Must(uuid.NewV7())))
}

func TestCatalogListPublishedSeriesPassesEveryFilterToTheQuery(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	expectGenreLookup(mock, tenantID, "GENRE0000001", true)
	expectTagLookup(mock, tenantID, "swordplay", true)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantID, true, "GENRE0000001", "swordplay", "completed", int16(4), nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows())

	weekday := int32(4)
	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		HasFreeEpisodes: true,
		GenrePublicId:   "GENRE0000001",
		TagSlug:         "swordplay",
		Status:          publirattypesv1.SeriesStatus_SERIES_STATUS_COMPLETED,
		Weekday:         &weekday,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	assertPublicExpectations(t, mock)
}

// The token names the list it points into, so every filter that is on has to
// show up in it next to the order.
func TestCatalogListPublishedSeriesTokenNamesTheFilteredList(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectGenreLookup(mock, tenantID, "GENRE0000001", true)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByPublishedAtDescQuery)).
		WithArgs(tenantID, false, "GENRE0000001", nil, nil, int16(1), nil, false, nil, int32(2)).
		WillReturnRows(seriesIDRows(seriesID, uuid.Must(uuid.NewV7())))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailRows(now, []uuid.UUID{seriesID}))

	weekday := int32(1)
	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		GenrePublicId: "GENRE0000001",
		Weekday:       &weekday,
		Limit:         1,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	if want := "published_at_desc+genre:GENRE0000001+weekday:1"; cursor.Keys[0] != want {
		t.Fatalf("token list key = %q, want %q", cursor.Keys[0], want)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesRefusesATokenFromAnotherFilterSet(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	token := pagination.Encode(
		pagination.Forward,
		"published_at_desc+genre:GENRE0000001",
		now.Format(time.RFC3339Nano),
		boundaryID.String(),
	)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectGenreLookup(mock, tenantID, "GENRE0000002", true)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		GenrePublicId: "GENRE0000002",
		Token:         token,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedSeriesRefusesAFilterNamingNothing(t *testing.T) {
	tests := []struct {
		name    string
		expect  func(sqlmock.Sqlmock, uuid.UUID)
		request func(uuid.UUID) *publirav1.ListPublishedSeriesRequest
	}{
		{
			name: "a genre the tenant does not have",
			expect: func(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
				expectGenreLookup(mock, tenantID, "GENRE0000001", false)
			},
			request: func(tenantID uuid.UUID) *publirav1.ListPublishedSeriesRequest {
				return &publirav1.ListPublishedSeriesRequest{
					Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
					GenrePublicId: "GENRE0000001",
				}
			},
		},
		{
			name: "a tag the tenant does not have",
			expect: func(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
				expectTagLookup(mock, tenantID, "swordplay", false)
			},
			request: func(tenantID uuid.UUID) *publirav1.ListPublishedSeriesRequest {
				return &publirav1.ListPublishedSeriesRequest{
					Tenant:  &publirattypesv1.TenantContext{TenantId: tenantID.String()},
					TagSlug: "swordplay",
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			expectTenantLookup(mock, tenantID, "TENANT", time.Now())
			test.expect(mock, tenantID)

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(test.request(tenantID)))
			if connect.CodeOf(err) != connect.CodeNotFound {
				t.Fatalf("code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
			}

			assertPublicExpectations(t, mock)
		})
	}
}

// A weekday outside 0 to 6 is not a weekday, so the request is refused before
// it reaches a query.
func TestCatalogListPublishedSeriesRefusesAWeekdayOutsideTheWeek(t *testing.T) {
	for _, weekday := range []int32{-1, 7} {
		testServer, mock := newTestPublicServer(t)

		tenantID := uuid.Must(uuid.NewV7())
		expectTenantLookup(mock, tenantID, "TENANT", time.Now())

		client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
		_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
			Tenant:  &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			Weekday: &weekday,
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("weekday %d code = %v, want invalid_argument (err=%v)", weekday, connect.CodeOf(err), err)
		}

		assertPublicExpectations(t, mock)
	}
}

// The latest-update order is scanned by its own pair of queries, and its token
// carries the instant that pair sorted by rather than the series' own
// published_at.
func TestCatalogListPublishedSeriesLatestUpdateOrderCarriesTheEpisodeInstant(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	latestEpisodeAt := now.Add(-time.Hour)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByLatestEpisodeAtDescQuery)).
		WithArgs(nil, false, nil, int32(2), tenantID, false, nil, nil, nil, nil).
		WillReturnRows(sqlmock.NewRows([]string{"id", "latest_episode_at"}).
			AddRow(seriesID, latestEpisodeAt).
			AddRow(uuid.Must(uuid.NewV7()), latestEpisodeAt.Add(-time.Hour)))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailRows(now, []uuid.UUID{seriesID}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Order:  publirav1.SeriesOrder_SERIES_ORDER_LATEST_EPISODE_AT_DESC,
		Limit:  1,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	if cursor.Keys[0] != "latest_episode_at_desc" {
		t.Fatalf("token list key = %q, want latest_episode_at_desc", cursor.Keys[0])
	}
	if want := latestEpisodeAt.Format(time.RFC3339Nano); cursor.Keys[1] != want {
		t.Fatalf("token sort key = %q, want the episode instant %q", cursor.Keys[1], want)
	}

	assertPublicExpectations(t, mock)
}

// Walking back through the latest-update order scans it the other way, so the
// backward page comes from the ascending query.
func TestCatalogListPublishedSeriesLatestUpdateOrderReadsBackwardsAscending(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	token := pagination.Encode(
		pagination.Backward,
		"latest_episode_at_desc",
		now.Format(time.RFC3339Nano),
		boundaryID.String(),
	)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByLatestEpisodeAtAscQuery)).
		WithArgs(boundaryID, false, now, int32(21), tenantID, false, nil, nil, nil, nil).
		WillReturnRows(sqlmock.NewRows([]string{"id", "latest_episode_at"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Order:  publirav1.SeriesOrder_SERIES_ORDER_LATEST_EPISODE_AT_DESC,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	assertPublicExpectations(t, mock)
}

func publishedGenreRows(rows ...[]driver.Value) *sqlmock.Rows {
	built := sqlmock.NewRows([]string{"id", "public_id", "name", "slug", "display_order", "published_series_count"})
	for _, row := range rows {
		built.AddRow(row...)
	}
	return built
}

func TestCatalogListPublishedGenresSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	genreID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedGenresByTenantAscQuery)).
		WithArgs(tenantID, nil, false, nil, int32(21)).
		WillReturnRows(publishedGenreRows([]driver.Value{genreID, "GENRE0000001", "Fantasy", "fantasy", int32(1), int32(3)}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedGenres(context.Background(), connect.NewRequest(&publirav1.ListPublishedGenresRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListPublishedGenres: %v", err)
	}
	if len(resp.Msg.Genres) != 1 {
		t.Fatalf("genres = %v, want one", resp.Msg.Genres)
	}
	genre := resp.Msg.Genres[0]
	if genre.PublicId != "GENRE0000001" || genre.Name != "Fantasy" || genre.Slug != "fantasy" {
		t.Fatalf("genre = %v, want the seeded fantasy genre", genre)
	}
	if genre.PublishedSeriesCount != 3 {
		t.Fatalf("published_series_count = %d, want 3", genre.PublishedSeriesCount)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = %q / %q, want both empty when every genre fits in one page", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}

	assertPublicExpectations(t, mock)
}

// A backward page is scanned by the descending query and flipped back into the
// tenant's own order before it is returned.
func TestCatalogListPublishedGenresReadsBackwardsDescending(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	first := uuid.Must(uuid.NewV7())
	second := uuid.Must(uuid.NewV7())
	token := pagination.EncodeCountUUID(pagination.Backward, 5, boundaryID)

	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedGenresByTenantDescQuery)).
		WithArgs(tenantID, boundaryID, false, int32(5), int32(21)).
		WillReturnRows(publishedGenreRows(
			[]driver.Value{second, "GENRE0000002", "Mystery", "mystery", int32(4), int32(1)},
			[]driver.Value{first, "GENRE0000001", "Fantasy", "fantasy", int32(3), int32(2)},
		))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedGenres(context.Background(), connect.NewRequest(&publirav1.ListPublishedGenresRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedGenres: %v", err)
	}
	if len(resp.Msg.Genres) != 2 || resp.Msg.Genres[0].Name != "Fantasy" || resp.Msg.Genres[1].Name != "Mystery" {
		t.Fatalf("genres = %v, want the backward page flipped back into display order", resp.Msg.Genres)
	}

	assertPublicExpectations(t, mock)
}

func publishedTagRows(rows ...[]driver.Value) *sqlmock.Rows {
	built := sqlmock.NewRows([]string{"name", "slug", "published_series_count"})
	for _, row := range rows {
		built.AddRow(row...)
	}
	return built
}

func TestCatalogListPublishedTagsCarriesTheCountInItsToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedTagsByTenantDescQuery)).
		WithArgs(nil, nil, false, int32(2), tenantID).
		WillReturnRows(publishedTagRows(
			[]driver.Value{"Swordplay", "swordplay", int32(4)},
			[]driver.Value{"Rivals", "rivals", int32(2)},
		))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedTags(context.Background(), connect.NewRequest(&publirav1.ListPublishedTagsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  1,
	}))
	if err != nil {
		t.Fatalf("ListPublishedTags: %v", err)
	}
	if len(resp.Msg.Tags) != 1 || resp.Msg.Tags[0].Slug != "swordplay" {
		t.Fatalf("tags = %v, want the most-carried tag alone", resp.Msg.Tags)
	}
	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	// The count comes first because it is the first sort key; the slug breaks
	// its ties.
	if len(cursor.Keys) != 2 || cursor.Keys[0] != "4" || cursor.Keys[1] != "swordplay" {
		t.Fatalf("token keys = %v, want the boundary count and slug", cursor.Keys)
	}

	assertPublicExpectations(t, mock)
}

// A backward page is scanned by the ascending query and flipped back, so the
// most-carried tag leads the page either way.
func TestCatalogListPublishedTagsReadsBackwardsAscending(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Backward, "2", "rivals")

	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedTagsByTenantAscQuery)).
		WithArgs("rivals", int32(2), false, int32(21), tenantID).
		WillReturnRows(publishedTagRows(
			[]driver.Value{"Duels", "duels", int32(3)},
			[]driver.Value{"Swordplay", "swordplay", int32(4)},
		))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedTags(context.Background(), connect.NewRequest(&publirav1.ListPublishedTagsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedTags: %v", err)
	}
	if len(resp.Msg.Tags) != 2 || resp.Msg.Tags[0].Slug != "swordplay" || resp.Msg.Tags[1].Slug != "duels" {
		t.Fatalf("tags = %v, want the backward page flipped back to most-carried first", resp.Msg.Tags)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogPublishedClassificationRejectsAMalformedToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	if _, err := client.ListPublishedGenres(context.Background(), connect.NewRequest(&publirav1.ListPublishedGenresRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  "not-a-token",
	})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("genre token code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := client.ListPublishedTags(context.Background(), connect.NewRequest(&publirav1.ListPublishedTagsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  "not-a-token",
	})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("tag token code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	assertPublicExpectations(t, mock)
}

// An empty page under the latest-update order hands back a recovery token
// carrying the episode instant the scan sorted by, so the way out of it is the
// one every other order has.
func TestCatalogListPublishedSeriesLatestUpdateEmptyPageKeepsAWayBack(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	token := pagination.Encode(
		pagination.Forward,
		"latest_episode_at_desc",
		now.Format(time.RFC3339Nano),
		boundaryID.String(),
	)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesIDsByLatestEpisodeAtDescQuery)).
		WithArgs(boundaryID, false, now, int32(21), tenantID, false, nil, nil, nil, nil).
		WillReturnRows(sqlmock.NewRows([]string{"id", "latest_episode_at"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Order:  publirav1.SeriesOrder_SERIES_ORDER_LATEST_EPISODE_AT_DESC,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}
	if len(resp.Msg.Series) != 0 {
		t.Fatalf("series = %+v, want an empty page", resp.Msg.Series)
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty past the end of the list", resp.Msg.NextToken)
	}

	cursor, err := pagination.Decode(resp.Msg.PreviousToken)
	if err != nil {
		t.Fatalf("decode previous_token: %v", err)
	}
	if len(cursor.Keys) != 4 || cursor.Keys[3] != seriesInclusiveKey {
		t.Fatalf("recovery token keys = %v, want the boundary marked inclusive", cursor.Keys)
	}
	if want := now.Format(time.RFC3339Nano); cursor.Keys[1] != want {
		t.Fatalf("recovery token sort key = %q, want the episode instant %q", cursor.Keys[1], want)
	}

	assertPublicExpectations(t, mock)
}
