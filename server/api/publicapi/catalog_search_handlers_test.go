package publicapi

import (
	"context"
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

func TestSearchQueryKeyAndIlikePatternShareIdentity(t *testing.T) {
	t.Parallel()

	if searchQueryKey("SEED") != searchQueryKey("Seed") {
		t.Fatal("ASCII case changes must share a token key")
	}
	if got, want := ilikeContainsPattern(searchQueryKey("SEED")), "%seed%"; got != want {
		t.Fatalf("ILIKE pattern = %q, want the same lowercased pattern as the token key", got)
	}
	if searchQueryKey("シード") != "シード" {
		t.Fatal("Japanese queries must stay as-is; the API does not restrict to ASCII")
	}
}

func TestIlikeContainsPatternEscapesMetacharacters(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"Seed":     "%Seed%",
		"100%":     "%100!%%",
		"a_b":      "%a!_b%",
		"wow!":     "%wow!!%",
		"%_!":      "%!%!_!!%",
		"Seed 001": "%Seed 001%",
	}
	for input, want := range cases {
		if got := ilikeContainsPattern(input); got != want {
			t.Errorf("ilikeContainsPattern(%q) = %q, want %q", input, got, want)
		}
	}
}

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
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsBySearchTitleAscQuery)).
		WithArgs(tenantID, "%seed%", nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows(seriesID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(seriesID, "SERIESPUB", "Seed Series", "A seed synopsis", now, nil, nil, []byte(`[]`), []byte(`{}`)))

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
	token := pagination.Encode(pagination.Forward, "Alpha", "Beta", boundaryID.String())

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
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsBySearchTitleAscQuery)).
		WithArgs(tenantID, "%seed%", nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESALPHA", "Alpha Seed", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)).
			AddRow(ids[1], "SERIESBETA0", "Beta Seed", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)))

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
	wantToken := pagination.Encode(pagination.Forward, "seed", "Beta Seed", ids[1].String())
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
	token := pagination.Encode(pagination.Forward, "seed", "Beta Seed", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(1)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsBySearchTitleAscQuery)).
		WithArgs(tenantID, "%seed%", boundaryID, false, "Beta Seed", int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESZETA0", "Zeta Seed", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)))

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
	token := pagination.Encode(pagination.Forward, "seed", "Beta Seed", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(1)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsBySearchTitleAscQuery)).
		WithArgs(tenantID, "%seed%", boundaryID, false, "Beta Seed", int32(21)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESZETA0", "Zeta Seed", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)))

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
	token := pagination.Encode(pagination.Backward, "seed", "Zeta Seed", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	alphaID := uuid.Must(uuid.NewV7())
	betaID := uuid.Must(uuid.NewV7())
	// A backward page scans descending titles, so Zeta's predecessor Beta
	// comes first, then Alpha. pagination.Page flips that back to title asc.
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsBySearchTitleDescQuery)).
		WithArgs(tenantID, "%seed%", boundaryID, false, "Zeta Seed", int32(3)).
		WillReturnRows(seriesIDRows(betaID, alphaID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(alphaID, "SERIESALPHA", "Alpha Seed", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)).
			AddRow(betaID, "SERIESBETA0", "Beta Seed", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)))

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
			wantQuery: listPublishedSeriesIDsBySearchTitleAscQuery,
		},
		{
			name:      "backward",
			direction: pagination.Backward,
			wantQuery: listPublishedSeriesIDsBySearchTitleDescQuery,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC()
			boundaryID := uuid.Must(uuid.NewV7())
			token := pagination.Encode(test.direction, "seed", "Beta Seed", boundaryID.String())

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, "%seed%", boundaryID, false, "Beta Seed", int32(21)).
				WillReturnRows(seriesIDRows())

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
			cursor, err := pagination.Decode(recoveryToken)
			if err != nil {
				t.Fatalf("decode recovery token: %v", err)
			}
			wantKeys := []string{"seed", "Beta Seed", boundaryID.String(), seriesInclusiveKey}
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
	token := pagination.Encode(pagination.Forward, "seed", "Beta Seed", boundaryID.String(), seriesInclusiveKey)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsBySearchTitleAscQuery)).
		WithArgs(tenantID, "%seed%", boundaryID, true, "Beta Seed", int32(21)).
		WillReturnRows(seriesIDRows())

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
