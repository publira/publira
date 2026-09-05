package publicapi

import (
	"context"
	"database/sql"
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

	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

func authorListColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"public_id",
		"name",
		"profile_text",
		"icon_image_id",
		"icon_image_updated_at",
		"icon_image_file_size_bytes",
		"published_series_count",
	})
}

func authorListRows(ids []uuid.UUID, names []string) *sqlmock.Rows {
	rows := authorListColumns()
	for i, id := range ids {
		rows.AddRow(id, fmt.Sprintf("AUTHOR%05d", i), names[i], "Writes things", nil, nil, int64(0), int32(1))
	}
	return rows
}

func TestCatalogListPublishedAuthorsSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	authorID := uuid.Must(uuid.NewV7())
	iconID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorIDsByNameAscQuery)).
		WithArgs(tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows(authorID))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorsByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(authorListColumns().
			AddRow(authorID, "AUTHOR00001", "Aoi Sakura", "Draws things", iconID, now, int64(2048), int32(2)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors: %v", err)
	}
	if len(resp.Msg.Authors) != 1 {
		t.Fatalf("authors count = %d, want 1", len(resp.Msg.Authors))
	}
	author := resp.Msg.Authors[0]
	if author.PublicId != "AUTHOR00001" {
		t.Fatalf("public_id = %q, want AUTHOR00001", author.PublicId)
	}
	if author.Name != "Aoi Sakura" {
		t.Fatalf("name = %q, want Aoi Sakura", author.Name)
	}
	if author.ProfileText != "Draws things" {
		t.Fatalf("profile_text = %q, want Draws things", author.ProfileText)
	}
	if author.PublishedSeriesCount != 2 {
		t.Fatalf("published_series_count = %d, want 2", author.PublishedSeriesCount)
	}
	if author.IconImageUrl != fmt.Sprintf("/images/creators/%s", iconID) {
		t.Fatalf("icon_image_url = %q, want /images/creators/%s", author.IconImageUrl, iconID)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty when every row fits in one page", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedAuthorsFirstPageReportsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(3)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorIDsByNameAscQuery)).
		WithArgs(tenantID, nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorsByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(authorListRows(ids[:2], []string{"Akira", "Mika"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors: %v", err)
	}
	if got := len(resp.Msg.Authors); got != 2 {
		t.Fatalf("authors count = %d, want the over-fetched row dropped", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token for the next page")
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedAuthorsDropsAuthorsWhoseSeriesWentUnpublished(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	keptID := uuid.Must(uuid.NewV7())
	droppedID := uuid.Must(uuid.NewV7())
	extraID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorIDsByNameAscQuery)).
		WithArgs(tenantID, nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(keptID, droppedID, extraID))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorsByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(authorListColumns().
			AddRow(keptID, "AUTHORK0001", "Akira", nil, nil, nil, int64(0), int32(1)).
			AddRow(droppedID, "AUTHORD0001", "Dropped", nil, nil, nil, int64(0), int32(0)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors: %v", err)
	}
	if got := len(resp.Msg.Authors); got != 1 || resp.Msg.Authors[0].PublicId != "AUTHORK0001" {
		t.Fatalf("authors = %+v, want only Akira after the unpublished row dropped", resp.Msg.Authors)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token built from the remaining row")
	}
	wantToken := pagination.Encode(pagination.Forward, "Akira", keptID.String())
	if resp.Msg.NextToken != wantToken {
		t.Fatalf("next_token = %q, want the remaining author's cursor, not the dropped row", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedAuthorsFollowsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "Mika", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(1)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorIDsByNameAscQuery)).
		WithArgs(tenantID, boundaryID, false, "Mika", int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorsByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(authorListRows(ids, []string{"Yuki"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors: %v", err)
	}
	if got := len(resp.Msg.Authors); got != 1 {
		t.Fatalf("authors count = %d, want 1", got)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedAuthorsFollowsPreviousTokenBackwards(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Backward, "Yuki", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	akiraID := uuid.Must(uuid.NewV7())
	mikaID := uuid.Must(uuid.NewV7())
	// A backward page scans descending names, so Yuki's predecessor Mika comes
	// first, then Akira. pagination.Page flips that back to name ascending.
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorIDsByNameDescQuery)).
		WithArgs(tenantID, boundaryID, false, "Yuki", int32(3)).
		WillReturnRows(seriesIDRows(mikaID, akiraID))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorsByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(authorListColumns().
			AddRow(akiraID, "AUTHORAKIRA", "Akira", nil, nil, nil, int64(0), int32(1)).
			AddRow(mikaID, "AUTHORMIKA0", "Mika", nil, nil, nil, int64(0), int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors: %v", err)
	}

	got := make([]string, 0, len(resp.Msg.Authors))
	for _, author := range resp.Msg.Authors {
		got = append(got, author.Name)
	}
	if !slices.Equal(got, []string{"Akira", "Mika"}) {
		t.Fatalf("authors = %v, want the backward page flipped back to name ascending", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedAuthorsEmptyPageKeepsAWayBack(t *testing.T) {
	for _, test := range []struct {
		name      string
		direction pagination.Direction
		wantQuery string
		wantPrev  bool
	}{
		{
			name:      "forward",
			direction: pagination.Forward,
			wantQuery: listPublishedAuthorIDsByNameAscQuery,
			wantPrev:  true,
		},
		{
			name:      "backward",
			direction: pagination.Backward,
			wantQuery: listPublishedAuthorIDsByNameDescQuery,
			wantPrev:  false,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC()
			boundaryID := uuid.Must(uuid.NewV7())
			token := pagination.Encode(test.direction, "Mika", boundaryID.String())

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, false, "Mika", int32(21)).
				WillReturnRows(seriesIDRows())

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			resp, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Token:  token,
			}))
			if err != nil {
				t.Fatalf("ListPublishedAuthors: %v", err)
			}
			if len(resp.Msg.Authors) != 0 {
				t.Fatalf("authors = %+v, want empty", resp.Msg.Authors)
			}
			if test.wantPrev {
				if resp.Msg.PreviousToken == "" {
					t.Fatal("previous_token is empty, want a recovery token back")
				}
				if resp.Msg.NextToken != "" {
					t.Fatalf("next_token = %q, want empty on a forward empty page", resp.Msg.NextToken)
				}
			} else {
				if resp.Msg.NextToken == "" {
					t.Fatal("next_token is empty, want a recovery token forward")
				}
				if resp.Msg.PreviousToken != "" {
					t.Fatalf("previous_token = %q, want empty on a backward empty page", resp.Msg.PreviousToken)
				}
			}
			assertPublicExpectations(t, mock)
		})
	}
}

func TestCatalogListPublishedAuthorsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "Mika", boundaryID.String(), authorInclusiveKey)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorIDsByNameAscQuery)).
		WithArgs(tenantID, boundaryID, true, "Mika", int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors: %v", err)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty after a failed recovery", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedAuthorsRejectsBrokenToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  "not-a-token",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("error = %q, want token internals hidden", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedAuthorsRejectsUnknownFourthKey(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	token := pagination.Encode(pagination.Forward, "Mika", uuid.Must(uuid.NewV7()).String(), "nope")

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedAuthorsLimitOutOfRangeUsesDefault(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedAuthorIDsByNameAscQuery)).
		WithArgs(tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  101,
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors: %v", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedAuthorDetailSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	authorID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
		WithArgs(tenantID, "AUTHOR00001").
		WillReturnRows(authorListColumns().
			AddRow(authorID, "AUTHOR00001", "Aoi Sakura", "Draws things", nil, nil, int64(0), int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleAscQuery)).
		WithArgs(authorID, tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows(seriesID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(seriesID, "SERIESPUB", "Public Series", "Public Synopsis", now, nil, nil, []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "AUTHOR00001",
	}))
	if err != nil {
		t.Fatalf("GetPublishedAuthorDetail: %v", err)
	}
	if resp.Msg.Author == nil || resp.Msg.Author.PublicId != "AUTHOR00001" {
		t.Fatalf("author = %+v, want AUTHOR00001", resp.Msg.Author)
	}
	if resp.Msg.Author.PublishedSeriesCount != 1 {
		t.Fatalf("published_series_count = %d, want 1", resp.Msg.Author.PublishedSeriesCount)
	}
	if len(resp.Msg.Series) != 1 || resp.Msg.Series[0].PublicId != "SERIESPUB" {
		t.Fatalf("series = %+v, want SERIESPUB", resp.Msg.Series)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty when every series fits in one page", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedAuthorDetailFirstPageReportsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	authorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(3)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
		WithArgs(tenantID, "AUTHOR00001").
		WillReturnRows(authorListColumns().
			AddRow(authorID, "AUTHOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(3)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleAscQuery)).
		WithArgs(authorID, tenantID, nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESALPHA", "Alpha", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)).
			AddRow(ids[1], "SERIESBETA0", "Beta", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "AUTHOR00001",
		Limit:    2,
	}))
	if err != nil {
		t.Fatalf("GetPublishedAuthorDetail: %v", err)
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
	wantToken := pagination.Encode(pagination.Forward, "title_asc", "Beta", ids[1].String())
	if resp.Msg.NextToken != wantToken {
		t.Fatalf("next_token = %q, want the last returned title cursor", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedAuthorDetailFollowsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	authorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "title_asc", "Beta", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(1)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
		WithArgs(tenantID, "AUTHOR00001").
		WillReturnRows(authorListColumns().
			AddRow(authorID, "AUTHOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(3)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleAscQuery)).
		WithArgs(authorID, tenantID, boundaryID, false, "Beta", int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESZETA0", "Zeta", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "AUTHOR00001",
		Limit:    2,
		Token:    token,
	}))
	if err != nil {
		t.Fatalf("GetPublishedAuthorDetail: %v", err)
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

func TestCatalogGetPublishedAuthorDetailFollowsPreviousTokenBackwards(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	authorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Backward, "title_asc", "Zeta", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	alphaID := uuid.Must(uuid.NewV7())
	betaID := uuid.Must(uuid.NewV7())
	// A backward page scans descending titles, so Zeta's predecessor Beta
	// comes first, then Alpha. pagination.Page flips that back to title asc.
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
		WithArgs(tenantID, "AUTHOR00001").
		WillReturnRows(authorListColumns().
			AddRow(authorID, "AUTHOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(3)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleDescQuery)).
		WithArgs(authorID, tenantID, boundaryID, false, "Zeta", int32(3)).
		WillReturnRows(seriesIDRows(betaID, alphaID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(alphaID, "SERIESALPHA", "Alpha", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)).
			AddRow(betaID, "SERIESBETA0", "Beta", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "AUTHOR00001",
		Limit:    2,
		Token:    token,
	}))
	if err != nil {
		t.Fatalf("GetPublishedAuthorDetail: %v", err)
	}

	got := make([]string, 0, len(resp.Msg.Series))
	for _, series := range resp.Msg.Series {
		got = append(got, series.Title)
	}
	if !slices.Equal(got, []string{"Alpha", "Beta"}) {
		t.Fatalf("series = %v, want the backward page flipped back to title ascending", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedAuthorDetailEmptyPageKeepsAWayBack(t *testing.T) {
	for _, test := range []struct {
		name      string
		direction pagination.Direction
		wantQuery string
		wantPrev  bool
	}{
		{
			name:      "forward",
			direction: pagination.Forward,
			wantQuery: listPublishedSeriesIDsByCreatorTitleAscQuery,
			wantPrev:  true,
		},
		{
			name:      "backward",
			direction: pagination.Backward,
			wantQuery: listPublishedSeriesIDsByCreatorTitleDescQuery,
			wantPrev:  false,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			authorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC()
			boundaryID := uuid.Must(uuid.NewV7())
			token := pagination.Encode(test.direction, "title_asc", "Beta", boundaryID.String())

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
				WithArgs(tenantID, "AUTHOR00001").
				WillReturnRows(authorListColumns().
					AddRow(authorID, "AUTHOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(1)))
			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(authorID, tenantID, boundaryID, false, "Beta", int32(21)).
				WillReturnRows(seriesIDRows())

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			resp, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				PublicId: "AUTHOR00001",
				Token:    token,
			}))
			if err != nil {
				t.Fatalf("GetPublishedAuthorDetail: %v", err)
			}
			if len(resp.Msg.Series) != 0 {
				t.Fatalf("series = %+v, want empty", resp.Msg.Series)
			}
			if test.wantPrev {
				if resp.Msg.PreviousToken == "" {
					t.Fatal("previous_token is empty, want a recovery token back")
				}
				if resp.Msg.NextToken != "" {
					t.Fatalf("next_token = %q, want empty on a forward empty page", resp.Msg.NextToken)
				}
			} else {
				if resp.Msg.NextToken == "" {
					t.Fatal("next_token is empty, want a recovery token forward")
				}
				if resp.Msg.PreviousToken != "" {
					t.Fatalf("previous_token = %q, want empty on a backward empty page", resp.Msg.PreviousToken)
				}
			}
			assertPublicExpectations(t, mock)
		})
	}
}

func TestCatalogGetPublishedAuthorDetailEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	authorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "title_asc", "Beta", boundaryID.String(), seriesInclusiveKey)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
		WithArgs(tenantID, "AUTHOR00001").
		WillReturnRows(authorListColumns().
			AddRow(authorID, "AUTHOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleAscQuery)).
		WithArgs(authorID, tenantID, boundaryID, true, "Beta", int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "AUTHOR00001",
		Token:    token,
	}))
	if err != nil {
		t.Fatalf("GetPublishedAuthorDetail: %v", err)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty after a failed recovery", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedAuthorDetailRejectsBrokenToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	authorID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
		WithArgs(tenantID, "AUTHOR00001").
		WillReturnRows(authorListColumns().
			AddRow(authorID, "AUTHOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "AUTHOR00001",
		Token:    "not-a-token",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("error = %q, want token internals hidden", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedAuthorDetailRejectsTokenFromAnotherOrder(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	authorID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "published_at_desc", time.Now().UTC().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
		WithArgs(tenantID, "AUTHOR00001").
		WillReturnRows(authorListColumns().
			AddRow(authorID, "AUTHOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "AUTHOR00001",
		Token:    token,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument when the token was built for another order", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedAuthorDetailLimitOutOfRangeUsesDefault(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	authorID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
		WithArgs(tenantID, "AUTHOR00001").
		WillReturnRows(authorListColumns().
			AddRow(authorID, "AUTHOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleAscQuery)).
		WithArgs(authorID, tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "AUTHOR00001",
		Limit:    101,
	}))
	if err != nil {
		t.Fatalf("GetPublishedAuthorDetail: %v", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedAuthorDetailNotFound(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
		WithArgs(tenantID, "MISSING00001").
		WillReturnError(sql.ErrNoRows)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "MISSING00001",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("error = %v, want not_found", err)
	}
	if err.Error() != "not_found: author not found" {
		t.Fatalf("error = %q, want author not found", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedAuthorDetailDatabaseErrorIsHidden(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedAuthorByPublicIDQuery)).
		WithArgs(tenantID, "AUTHOR00001").
		WillReturnError(errors.New(`pq: relation "creators" does not exist`))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "AUTHOR00001",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetPublishedAuthorDetail code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertPublicExpectations(t, mock)
}

func TestListPublishedAuthorQueriesHavePublicationGuards(t *testing.T) {
	queries := map[string]string{
		"listPublishedAuthorIDsByNameAsc":          listPublishedAuthorIDsByNameAscQuery,
		"listPublishedAuthorIDsByNameDesc":         listPublishedAuthorIDsByNameDescQuery,
		"listPublishedAuthorsByIDs":                listPublishedAuthorsByIDsQuery,
		"getPublishedAuthorByPublicID":             getPublishedAuthorByPublicIDQuery,
		"listPublishedSeriesIDsByCreatorTitleAsc":  listPublishedSeriesIDsByCreatorTitleAscQuery,
		"listPublishedSeriesIDsByCreatorTitleDesc": listPublishedSeriesIDsByCreatorTitleDescQuery,
	}
	// Compacted so a drifted copy of the published predicate cannot hide
	// behind different wrapping. This is the same three-way check as
	// ListActiveSeriesIDsByPublishedAtDesc.
	publishedPredicate := compactSQL(`
		s.is_published = true
		AND s.published_at IS NOT NULL
		AND s.published_at <= NOW()
	`)
	creatorPublishedJoin := compactSQL(`
		FROM series_creators sc
		JOIN series s ON s.id = sc.series_id
		WHERE sc.creator_id = c.id
		AND s.tenant_id = c.tenant_id
		AND s.is_published = true
		AND s.published_at IS NOT NULL
		AND s.published_at <= NOW()
	`)
	for name, query := range queries {
		got := compactSQL(query)
		if !strings.Contains(got, publishedPredicate) {
			t.Fatalf("%s is missing the published-series predicate", name)
		}
	}
	for _, name := range []string{
		"listPublishedAuthorIDsByNameAsc",
		"listPublishedAuthorIDsByNameDesc",
		"listPublishedAuthorsByIDs",
		"getPublishedAuthorByPublicID",
	} {
		if !strings.Contains(compactSQL(queries[name]), creatorPublishedJoin) {
			t.Fatalf("%s does not use the shared creator→published-series join", name)
		}
	}
}

func compactSQL(query string) string {
	return strings.Join(strings.Fields(query), " ")
}
