package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogsearch"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/publishedseries"
	"github.com/publira/publira/server/internal/testutil"
)

func TestNormalizeSearchQuery(t *testing.T) {
	t.Parallel()

	got, err := normalizeSearchQuery("  Seed Series  ")
	if err != nil {
		t.Fatalf("normalizeSearchQuery: %v", err)
	}
	if got != "Seed Series" {
		t.Fatalf("query = %q, want trimmed", got)
	}

	_, err = normalizeSearchQuery("   ")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("empty query error = %v, want invalid_argument", err)
	}

	_, err = normalizeSearchQuery(strings.Repeat("あ", maxSearchQueryRunes+1))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("oversized query error = %v, want invalid_argument", err)
	}

	got, err = normalizeSearchQuery(strings.Repeat("あ", maxSearchQueryRunes))
	if err != nil {
		t.Fatalf("max-length query: %v", err)
	}
	if utf8Len := len([]rune(got)); utf8Len != maxSearchQueryRunes {
		t.Fatalf("max-length query runes = %d, want %d", utf8Len, maxSearchQueryRunes)
	}
}

func TestCatalogSearchPublishedSeriesSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesIDsByTitleAsc)).
		WithArgs(tenantID, "web", false, nil, nil, nil, nil, "%seed%", nil, false, nil, int32(21)).
		WillReturnRows(searchHitRows(searchHit{seriesID, "Seed Series"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(seriesID, "SERIESPUB", "Seed Series", "A seed synopsis", "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "  Seed  ",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	if len(resp.Msg.Series) != 1 || resp.Msg.Series[0].PublicId != "SERIESPUB" {
		t.Fatalf("series = %+v, want SERIESPUB", resp.Msg.Series)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty on a single page", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedSeriesRejectsEmptyQuery(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "   ",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedSeriesRejectsQueryMismatchOnToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	token := webToken(pagination.Forward, "alpha", "title_asc", "Beta", boundaryID.String())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Zeta",
		Token:  token,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	if err.Error() != "invalid_argument: token was issued for another query" {
		t.Fatalf("error = %q, want a query-mismatch message without token internals", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedSeriesFirstPageReportsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(3)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesIDsByTitleAsc)).
		WithArgs(tenantID, "web", false, nil, nil, nil, nil, "%seed%", nil, false, nil, int32(3)).
		WillReturnRows(searchHitRows(searchHit{ids[0], "Alpha Seed"}, searchHit{ids[1], "Beta Seed"}, searchHit{ids[2], "Zeta Seed"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESALPHA", "Alpha Seed", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)).
			AddRow(ids[1], "SERIESBETA0", "Beta Seed", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Seed",
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	if got := len(resp.Msg.Series); got != 2 {
		t.Fatalf("series count = %d, want the over-fetched row dropped", got)
	}
	wantToken := webToken(pagination.Forward, "seed", "title_asc", "Beta Seed", ids[1].String())
	if resp.Msg.NextToken != wantToken {
		t.Fatalf("next_token = %q, want the last returned search cursor", resp.Msg.NextToken)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedSeriesFollowsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := webToken(pagination.Forward, "seed", "title_asc", "Beta Seed", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(1)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesIDsByTitleAsc)).
		WithArgs(tenantID, "web", false, nil, nil, nil, nil, "%seed%", boundaryID, false, "Beta Seed", int32(3)).
		WillReturnRows(searchHitRows(searchHit{ids[0], "Zeta Seed"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESZETA0", "Zeta Seed", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Seed",
		Limit:  2,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
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

func TestCatalogSearchPublishedSeriesRejectsInvalidToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Seed",
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

func TestCatalogSearchPublishedSeriesAcceptsRecasedQueryOnToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := webToken(pagination.Forward, "seed", "title_asc", "Beta Seed", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(1)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesIDsByTitleAsc)).
		WithArgs(tenantID, "web", false, nil, nil, nil, nil, "%seed%", boundaryID, false, "Beta Seed", int32(21)).
		WillReturnRows(searchHitRows(searchHit{ids[0], "Zeta Seed"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESZETA0", "Zeta Seed", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "SEED",
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	if got := len(resp.Msg.Series); got != 1 {
		t.Fatalf("series count = %d, want 1", got)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedSeriesFollowsPreviousTokenBackwards(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := webToken(pagination.Backward, "seed", "title_asc", "Zeta Seed", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	alphaID := uuid.Must(uuid.NewV7())
	betaID := uuid.Must(uuid.NewV7())
	// A backward page scans descending titles, so Zeta's predecessor Beta
	// comes first, then Alpha. pagination.Page flips that back to title asc.
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesIDsByTitleDesc)).
		WithArgs(tenantID, "web", false, nil, nil, nil, nil, "%seed%", boundaryID, false, "Zeta Seed", int32(3)).
		WillReturnRows(searchHitRows(searchHit{betaID, "Beta Seed"}, searchHit{alphaID, "Alpha Seed"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(alphaID, "SERIESALPHA", "Alpha Seed", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)).
			AddRow(betaID, "SERIESBETA0", "Beta Seed", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Seed",
		Limit:  2,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}

	got := make([]string, 0, len(resp.Msg.Series))
	for _, series := range resp.Msg.Series {
		got = append(got, series.Title)
	}
	if !slices.Equal(got, []string{"Alpha Seed", "Beta Seed"}) {
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

func TestCatalogSearchPublishedSeriesEmptyPageKeepsAWayBack(t *testing.T) {
	for _, test := range []struct {
		name      string
		direction pagination.Direction
		wantQuery string
	}{
		{
			name:      "forward",
			direction: pagination.Forward,
			wantQuery: dbmodels.ListActiveSeriesIDsByTitleAsc,
		},
		{
			name:      "backward",
			direction: pagination.Backward,
			wantQuery: dbmodels.ListActiveSeriesIDsByTitleDesc,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC()
			boundaryID := uuid.Must(uuid.NewV7())
			token := webToken(test.direction, "seed", "title_asc", "Beta Seed", boundaryID.String())

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, "web", false, nil, nil, nil, nil, "%seed%", boundaryID, false, "Beta Seed", int32(21)).
				WillReturnRows(searchHitRows())

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			resp, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Query:  "Seed",
				Token:  token,
			}))
			if err != nil {
				t.Fatalf("SearchPublishedSeries: %v", err)
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

			recoveryToken := resp.Msg.PreviousToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.Msg.NextToken
				recoveryDirection = pagination.Forward
			}
			cursor, err := decodeSurfaceToken(recoveryToken, "web")
			if err != nil {
				t.Fatalf("decode recovery token: %v", err)
			}
			wantKeys := []string{"seed", "title_asc", "Beta Seed", boundaryID.String(), seriesInclusiveKey}
			if cursor.Direction != recoveryDirection || !slices.Equal(cursor.Keys, wantKeys) {
				t.Fatalf("recovery token = %+v, want direction %q and keys %v", cursor, recoveryDirection, wantKeys)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

func TestCatalogSearchPublishedSeriesEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := webToken(pagination.Forward, "seed", "title_asc", "Beta Seed", boundaryID.String(), seriesInclusiveKey)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesIDsByTitleAsc)).
		WithArgs(tenantID, "web", false, nil, nil, nil, nil, "%seed%", boundaryID, true, "Beta Seed", int32(21)).
		WillReturnRows(searchHitRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Seed",
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty after a failed recovery", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

// searchHit is one row a search query of the SQL backend returns: the id, and
// the title or name the tokens are built from.
type searchHit struct {
	id      uuid.UUID
	sortKey string
}

func searchHitRows(hits ...searchHit) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"id", "sort_key"})
	for _, hit := range hits {
		rows.AddRow(hit.id, hit.sortKey)
	}
	return rows
}

// searchLabelColumns is the row ListPublishedLabelsByIDs reads for each label
// a search found.
func searchLabelColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "public_id", "name", "eye_catch_image_id", "eye_catch_image_updated_at", "published_series_count"})
}

func labelPublicIDs(items []*publirav1.PublishedLabel) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.PublicId)
	}
	return ids
}

func TestCatalogSearchPublishedCreatorsSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedCreatorsBySearchNameAsc)).
		WithArgs(tenantID, "%sakura%", "web", nil, false, nil, int32(21)).
		WillReturnRows(searchHitRows(searchHit{creatorID, "Aoi Sakura"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedCreatorsByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(creatorListColumns().
			AddRow(creatorID, "CREATOR00001", "Aoi Sakura", "Draws things", nil, nil, int64(0), int32(2)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedCreators(context.Background(), connect.NewRequest(&publirav1.SearchPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "  Sakura  ",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedCreators: %v", err)
	}
	if len(resp.Msg.Creators) != 1 || resp.Msg.Creators[0].PublicId != "CREATOR00001" {
		t.Fatalf("creators = %+v, want CREATOR00001", resp.Msg.Creators)
	}
	if resp.Msg.Creators[0].PublishedSeriesCount != 2 {
		t.Fatalf("published_series_count = %d, want 2", resp.Msg.Creators[0].PublishedSeriesCount)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty on a single page", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedCreatorsRejectsEmptyQuery(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.SearchPublishedCreators(context.Background(), connect.NewRequest(&publirav1.SearchPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "   ",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedCreatorsRejectsQueryMismatchOnToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	token := webToken(pagination.Forward, "akira", "Akira", boundaryID.String())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.SearchPublishedCreators(context.Background(), connect.NewRequest(&publirav1.SearchPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Sakura",
		Token:  token,
	}))
	if err.Error() != "invalid_argument: token was issued for another query" {
		t.Fatalf("error = %q, want a query-mismatch message without token internals", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedCreatorsFirstPageReportsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	akiraID := uuid.Must(uuid.NewV7())
	mikaID := uuid.Must(uuid.NewV7())
	overFetchedID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedCreatorsBySearchNameAsc)).
		WithArgs(tenantID, "%a%", "web", nil, false, nil, int32(3)).
		WillReturnRows(searchHitRows(searchHit{akiraID, "Akira"}, searchHit{mikaID, "Mika"}, searchHit{overFetchedID, "Sakura"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedCreatorsByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(creatorListColumns().
			AddRow(akiraID, "CREATORAKIRA", "Akira", nil, nil, nil, int64(0), int32(1)).
			AddRow(mikaID, "CREATORMIKA0", "Mika", nil, nil, nil, int64(0), int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedCreators(context.Background(), connect.NewRequest(&publirav1.SearchPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "A",
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedCreators: %v", err)
	}
	if got := len(resp.Msg.Creators); got != 2 {
		t.Fatalf("creator count = %d, want the over-fetched row dropped", got)
	}
	wantToken := webToken(pagination.Forward, "a", "Mika", mikaID.String())
	if resp.Msg.NextToken != wantToken {
		t.Fatalf("next_token = %q, want the last returned search cursor", resp.Msg.NextToken)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedCreatorsFollowsPreviousTokenBackwards(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := webToken(pagination.Backward, "a", "Yuki", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	akiraID := uuid.Must(uuid.NewV7())
	mikaID := uuid.Must(uuid.NewV7())
	// A backward page scans descending names, so Yuki's predecessor Mika comes
	// first, then Akira. pagination.Page flips that back to name ascending.
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedCreatorsBySearchNameDesc)).
		WithArgs(tenantID, "%a%", "web", boundaryID, false, "Yuki", int32(3)).
		WillReturnRows(searchHitRows(searchHit{mikaID, "Mika"}, searchHit{akiraID, "Akira"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedCreatorsByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(creatorListColumns().
			AddRow(akiraID, "CREATORAKIRA", "Akira", nil, nil, nil, int64(0), int32(1)).
			AddRow(mikaID, "CREATORMIKA0", "Mika", nil, nil, nil, int64(0), int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedCreators(context.Background(), connect.NewRequest(&publirav1.SearchPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "A",
		Limit:  2,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedCreators: %v", err)
	}
	if got := creatorPublicIDs(resp.Msg.Creators); !slices.Equal(got, []string{"CREATORAKIRA", "CREATORMIKA0"}) {
		t.Fatalf("creators = %v, want the backward page flipped back to name ascending", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedLabelsSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsBySearchNameAsc)).
		WithArgs(tenantID, "%jump%", "web", nil, false, nil, int32(21)).
		WillReturnRows(searchHitRows(searchHit{labelID, "Jump"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(searchLabelColumns().AddRow(labelID, "LABELPUB001", "Jump", nil, nil, int32(3)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "  Jump  ",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels: %v", err)
	}
	if len(resp.Msg.Labels) != 1 || resp.Msg.Labels[0].PublicId != "LABELPUB001" {
		t.Fatalf("labels = %+v, want LABELPUB001", resp.Msg.Labels)
	}
	if got := resp.Msg.Labels[0].PublishedSeriesCount; got != 3 {
		t.Fatalf("published_series_count = %d, want 3", got)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty on a single page", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedLabelsRejectsEmptyQuery(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "   ",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedLabelsRejectsQueryMismatchOnToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	token := webToken(pagination.Forward, "jump", "Jump", boundaryID.String())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Magazine",
		Token:  token,
	}))
	if err.Error() != "invalid_argument: token was issued for another query" {
		t.Fatalf("error = %q, want a query-mismatch message without token internals", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedLabelsFirstPageReportsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	alphaID := uuid.Must(uuid.NewV7())
	betaID := uuid.Must(uuid.NewV7())
	overFetchedID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsBySearchNameAsc)).
		WithArgs(tenantID, "%comics%", "web", nil, false, nil, int32(3)).
		WillReturnRows(searchHitRows(searchHit{alphaID, "Alpha Comics"}, searchHit{betaID, "Beta Comics"}, searchHit{overFetchedID, "Zeta Comics"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(searchLabelColumns().
			AddRow(alphaID, "LABELALPHA1", "Alpha Comics", nil, nil, int32(1)).
			AddRow(betaID, "LABELBETA01", "Beta Comics", nil, nil, int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Comics",
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels: %v", err)
	}
	if got := len(resp.Msg.Labels); got != 2 {
		t.Fatalf("label count = %d, want the over-fetched row dropped", got)
	}
	wantToken := webToken(pagination.Forward, "comics", "Beta Comics", betaID.String())
	if resp.Msg.NextToken != wantToken {
		t.Fatalf("next_token = %q, want the last returned search cursor", resp.Msg.NextToken)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedLabelsFollowsPreviousTokenBackwards(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := webToken(pagination.Backward, "comics", "Zeta Comics", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	alphaID := uuid.Must(uuid.NewV7())
	betaID := uuid.Must(uuid.NewV7())
	// A backward page scans descending names, so Zeta's predecessor Beta comes
	// first, then Alpha. pagination.Page flips that back to name ascending.
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsBySearchNameDesc)).
		WithArgs(tenantID, "%comics%", "web", boundaryID, false, "Zeta Comics", int32(3)).
		WillReturnRows(searchHitRows(searchHit{betaID, "Beta Comics"}, searchHit{alphaID, "Alpha Comics"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(searchLabelColumns().
			AddRow(alphaID, "LABELALPHA1", "Alpha Comics", nil, nil, int32(1)).
			AddRow(betaID, "LABELBETA01", "Beta Comics", nil, nil, int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Comics",
		Limit:  2,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels: %v", err)
	}
	if got := labelPublicIDs(resp.Msg.Labels); !slices.Equal(got, []string{"LABELALPHA1", "LABELBETA01"}) {
		t.Fatalf("labels = %v, want the backward page flipped back to name ascending", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchPublishedLabelsAttachesEyeCatchVariants(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	imageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsBySearchNameAsc)).
		WithArgs(tenantID, "%jump%", "web", nil, false, nil, int32(21)).
		WillReturnRows(searchHitRows(searchHit{labelID, "Jump"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(searchLabelColumns().AddRow(labelID, "LABELPUB001", "Jump", imageID, now, int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListLabelImageVariantsByImageIDs)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "label_image_id", "variant_type", "label", "content_type", "file_size_bytes", "width", "height"}).
			AddRow(uuid.Must(uuid.NewV7()), imageID, "portrait", "portrait_1200w", "image/webp", int64(2048), int32(1200), int32(1600)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "Jump",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels: %v", err)
	}
	if len(resp.Msg.Labels) != 1 {
		t.Fatalf("labels = %+v, want one hit", resp.Msg.Labels)
	}
	variants := resp.Msg.Labels[0].EyeCatchImageVariants
	if len(variants) != 1 || variants[0].Label != "portrait_1200w" {
		t.Fatalf("eye_catch_image_variants = %+v, want the seeded portrait variant", variants)
	}
	if resp.Msg.Labels[0].EyeCatchImageUpdatedAt == "" {
		t.Fatal("eye_catch_image_updated_at is empty, want the stored timestamp")
	}
	assertPublicExpectations(t, mock)
}

// fakeSearchBackend answers every search with page, or err, and keeps the
// request it was asked.
type fakeSearchBackend struct {
	page      catalogsearch.Page
	err       error
	got       catalogsearch.Request
	gotSeries catalogsearch.SeriesRequest
}

func (f *fakeSearchBackend) SearchSeries(_ context.Context, req catalogsearch.SeriesRequest) (catalogsearch.Page, error) {
	f.got = req.Request
	f.gotSeries = req
	return f.page, f.err
}

func (f *fakeSearchBackend) SearchCreators(_ context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	f.got = req
	return f.page, f.err
}

func (f *fakeSearchBackend) SearchLabels(_ context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	f.got = req
	return f.page, f.err
}

func newSearchBackendTestServer(t *testing.T, backend catalogsearch.Backend) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	server := httptest.NewServer(handlerFromServer(
		newAPIServer(db, dbmodels.New(db), nil, testutil.TokenManager(), nil, slog.Default(), readerGuards{}, nil, backend),
	))
	t.Cleanup(server.Close)
	return server, mock
}

// The handler shows the hits of whichever backend it was given, in that
// backend's order, and binds the backend's tokens to the calling surface.
func TestCatalogSearchShowsTheHitsOfTheConfiguredBackend(t *testing.T) {
	alphaID := uuid.Must(uuid.NewV7())
	betaID := uuid.Must(uuid.NewV7())
	backend := &fakeSearchBackend{page: catalogsearch.Page{
		IDs:       []uuid.UUID{betaID, alphaID},
		NextToken: pagination.Encode(pagination.Forward, "opaque"),
	}}
	testServer, mock := newSearchBackendTestServer(t, backend)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(searchLabelColumns().
			AddRow(alphaID, "LABELALPHA1", "Alpha Comics", nil, nil, int32(1)).
			AddRow(betaID, "LABELBETA01", "Beta Comics", nil, nil, int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:  "  Comics  ",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels: %v", err)
	}
	if got := labelPublicIDs(resp.Msg.Labels); !slices.Equal(got, []string{"LABELBETA01", "LABELALPHA1"}) {
		t.Fatalf("labels = %v, want the backend's order", got)
	}
	if want := webToken(pagination.Forward, "opaque"); resp.Msg.NextToken != want {
		t.Fatalf("next_token = %q, want the backend's token bound to the web surface", resp.Msg.NextToken)
	}
	want := catalogsearch.Request{TenantID: tenantID, Surface: "web", Query: "Comics", Limit: defaultLabelPageSize}
	if backend.got.TenantID != want.TenantID || backend.got.Surface != want.Surface || backend.got.Query != want.Query || backend.got.Limit != want.Limit || !backend.got.Cursor.IsZero() {
		t.Fatalf("backend request = %+v, want %+v", backend.got, want)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogSearchAnswersABackendFailure(t *testing.T) {
	for _, test := range []struct {
		name     string
		err      error
		wantCode connect.Code
		wantMsg  string
	}{
		{name: "token for another query", err: catalogsearch.ErrTokenForAnotherQuery, wantCode: connect.CodeInvalidArgument, wantMsg: "invalid_argument: token was issued for another query"},
		{name: "token for another order or filter", err: catalogsearch.ErrTokenForAnotherNarrowing, wantCode: connect.CodeInvalidArgument, wantMsg: "invalid_argument: token was issued for another order or filter"},
		{name: "invalid token", err: catalogsearch.ErrInvalidToken, wantCode: connect.CodeInvalidArgument, wantMsg: "invalid_argument: token is invalid"},
		{name: "engine failure", err: errors.New("connection refused"), wantCode: connect.CodeInternal, wantMsg: "internal: internal server error"},
	} {
		t.Run(test.name, func(t *testing.T) {
			testServer, mock := newSearchBackendTestServer(t, &fakeSearchBackend{err: test.err})

			tenantID := uuid.Must(uuid.NewV7())
			expectTenantLookup(mock, tenantID, "TENANT", time.Now())

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			_, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Query:  "Seed",
			}))
			if connect.CodeOf(err) != test.wantCode || err.Error() != test.wantMsg {
				t.Fatalf("error = %v, want %q", err, test.wantMsg)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

// The order and the filters reach the backend resolved, in the shape the list
// uses for them, and an unspecified order leaves the backend its own.
func TestCatalogSearchPublishedSeriesHandsTheBackendItsOrderAndFilters(t *testing.T) {
	monday := int32(1)
	for _, test := range []struct {
		name       string
		req        *publirav1.SearchPublishedSeriesRequest
		lookups    func(sqlmock.Sqlmock, uuid.UUID)
		wantOrder  publishedseries.Order
		wantFilter publishedseries.Filter
	}{
		{
			name: "nothing asked",
			req:  &publirav1.SearchPublishedSeriesRequest{},
		},
		{
			name:      "an order",
			req:       &publirav1.SearchPublishedSeriesRequest{Order: publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_DESC},
			wantOrder: publishedseries.PublishedAtDesc,
		},
		{
			name: "every filter",
			req: &publirav1.SearchPublishedSeriesRequest{
				HasFreeEpisodes: true,
				GenrePublicId:   "GENRE0000001",
				TagSlug:         "swordplay",
				Status:          publirattypesv1.SeriesStatus_SERIES_STATUS_COMPLETED,
				Weekday:         &monday,
			},
			lookups: func(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
				expectGenreLookup(mock, tenantID, "GENRE0000001", true)
				expectTagLookup(mock, tenantID, "swordplay", true)
			},
			wantFilter: publishedseries.Filter{
				HasFreeEpisodes: true,
				GenrePublicID:   sql.NullString{String: "GENRE0000001", Valid: true},
				TagSlug:         sql.NullString{String: "swordplay", Valid: true},
				Status:          sql.NullString{String: "completed", Valid: true},
				Weekday:         sql.NullInt16{Int16: 1, Valid: true},
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			backend := &fakeSearchBackend{}
			testServer, mock := newSearchBackendTestServer(t, backend)

			tenantID := uuid.Must(uuid.NewV7())
			expectTenantLookup(mock, tenantID, "TENANT", time.Now())
			if test.lookups != nil {
				test.lookups(mock, tenantID)
			}

			test.req.Tenant = &publirattypesv1.TenantContext{TenantId: tenantID.String()}
			test.req.Query = "Seed"
			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			if _, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(test.req)); err != nil {
				t.Fatalf("SearchPublishedSeries: %v", err)
			}
			if backend.gotSeries.Order != test.wantOrder {
				t.Fatalf("order = %+v, want %+v", backend.gotSeries.Order, test.wantOrder)
			}
			if backend.gotSeries.Filter != test.wantFilter {
				t.Fatalf("filter = %+v, want %+v", backend.gotSeries.Filter, test.wantFilter)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

func TestCatalogSearchPublishedSeriesRefusesAGenreTheTenantDoesNotHave(t *testing.T) {
	backend := &fakeSearchBackend{}
	testServer, mock := newSearchBackendTestServer(t, backend)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	expectGenreLookup(mock, tenantID, "GENREFOREIGN", false)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:         "Seed",
		GenrePublicId: "GENREFOREIGN",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("error = %v, want not_found", err)
	}
	if backend.gotSeries.Query != "" {
		t.Fatalf("backend was asked %+v, want no search for a genre that is not there", backend.gotSeries)
	}
	assertPublicExpectations(t, mock)
}

// The SQL backend runs the list's scan of the requested order with the filters
// beside the keyword, and the token it hands back names that order and those
// filters after the query.
func TestCatalogSearchPublishedSeriesNarrowsTheListScan(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := newSeriesIDs(2)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectGenreLookup(mock, tenantID, "GENRE0000001", true)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesIDsByPublishedAtDesc)).
		WithArgs(tenantID, "web", true, "GENRE0000001", nil, "ongoing", nil, "%seed%", nil, false, nil, int32(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "published_at"}).
			AddRow(ids[0], now).
			AddRow(ids[1], now.Add(-time.Hour)))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESNEW01", "Newer Seed", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(1), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Query:           "Seed",
		Limit:           1,
		Order:           publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_DESC,
		HasFreeEpisodes: true,
		GenrePublicId:   "GENRE0000001",
		Status:          publirattypesv1.SeriesStatus_SERIES_STATUS_ONGOING,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	wantToken := webToken(pagination.Forward, "seed", "published_at_desc+has_free_episodes+genre:GENRE0000001+status:ongoing", now.Format(time.RFC3339Nano), ids[0].String())
	if resp.Msg.NextToken != wantToken {
		t.Fatalf("next_token = %q, want %q", resp.Msg.NextToken, wantToken)
	}
	assertPublicExpectations(t, mock)
}
