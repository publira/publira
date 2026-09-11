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

func creatorListColumns() *sqlmock.Rows {
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

func creatorListRows(ids []uuid.UUID, names []string) *sqlmock.Rows {
	rows := creatorListColumns()
	for i, id := range ids {
		rows.AddRow(id, fmt.Sprintf("CREATOR%05d", i), names[i], "Writes things", nil, nil, int64(0), int32(1))
	}
	return rows
}

func TestCatalogListPublishedCreatorsSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	iconID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorIDsByNameAscQuery)).
		WithArgs(tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows(creatorID))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorsByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(creatorListColumns().
			AddRow(creatorID, "CREATOR00001", "Aoi Sakura", "Draws things", iconID, now, int64(2048), int32(2)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators: %v", err)
	}
	if len(resp.Msg.Creators) != 1 {
		t.Fatalf("creators count = %d, want 1", len(resp.Msg.Creators))
	}
	creator := resp.Msg.Creators[0]
	if creator.PublicId != "CREATOR00001" {
		t.Fatalf("public_id = %q, want CREATOR00001", creator.PublicId)
	}
	if creator.Name != "Aoi Sakura" {
		t.Fatalf("name = %q, want Aoi Sakura", creator.Name)
	}
	if creator.ProfileText != "Draws things" {
		t.Fatalf("profile_text = %q, want Draws things", creator.ProfileText)
	}
	if creator.PublishedSeriesCount != 2 {
		t.Fatalf("published_series_count = %d, want 2", creator.PublishedSeriesCount)
	}
	if creator.IconImageUrl != fmt.Sprintf("/images/creators/%s", iconID) {
		t.Fatalf("icon_image_url = %q, want /images/creators/%s", creator.IconImageUrl, iconID)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty when every row fits in one page", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedCreatorsFirstPageReportsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(3)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorIDsByNameAscQuery)).
		WithArgs(tenantID, nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorsByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(creatorListRows(ids[:2], []string{"Akira", "Mika"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators: %v", err)
	}
	if got := len(resp.Msg.Creators); got != 2 {
		t.Fatalf("creators count = %d, want the over-fetched row dropped", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token for the next page")
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedCreatorsDropsCreatorsWhoseSeriesWentUnpublished(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	keptID := uuid.Must(uuid.NewV7())
	droppedID := uuid.Must(uuid.NewV7())
	extraID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorIDsByNameAscQuery)).
		WithArgs(tenantID, nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(keptID, droppedID, extraID))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorsByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(creatorListColumns().
			AddRow(keptID, "CREATORK0001", "Akira", nil, nil, nil, int64(0), int32(1)).
			AddRow(droppedID, "CREATORD0001", "Dropped", nil, nil, nil, int64(0), int32(0)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators: %v", err)
	}
	if got := len(resp.Msg.Creators); got != 1 || resp.Msg.Creators[0].PublicId != "CREATORK0001" {
		t.Fatalf("creators = %+v, want only Akira after the unpublished row dropped", resp.Msg.Creators)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token built from the remaining row")
	}
	wantToken := pagination.Encode(pagination.Forward, "Akira", keptID.String())
	if resp.Msg.NextToken != wantToken {
		t.Fatalf("next_token = %q, want the remaining creator's cursor, not the dropped row", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedCreatorsFollowsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "Mika", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(1)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorIDsByNameAscQuery)).
		WithArgs(tenantID, boundaryID, false, "Mika", int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorsByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(creatorListRows(ids, []string{"Yuki"}))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators: %v", err)
	}
	if got := len(resp.Msg.Creators); got != 1 {
		t.Fatalf("creators count = %d, want 1", got)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedCreatorsFollowsPreviousTokenBackwards(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorIDsByNameDescQuery)).
		WithArgs(tenantID, boundaryID, false, "Yuki", int32(3)).
		WillReturnRows(seriesIDRows(mikaID, akiraID))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorsByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(creatorListColumns().
			AddRow(akiraID, "CREATORAKIRA", "Akira", nil, nil, nil, int64(0), int32(1)).
			AddRow(mikaID, "CREATORMIKA0", "Mika", nil, nil, nil, int64(0), int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators: %v", err)
	}

	got := make([]string, 0, len(resp.Msg.Creators))
	for _, creator := range resp.Msg.Creators {
		got = append(got, creator.Name)
	}
	if !slices.Equal(got, []string{"Akira", "Mika"}) {
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

func TestCatalogListPublishedCreatorsEmptyPageKeepsAWayBack(t *testing.T) {
	for _, test := range []struct {
		name      string
		direction pagination.Direction
		wantQuery string
		wantPrev  bool
	}{
		{
			name:      "forward",
			direction: pagination.Forward,
			wantQuery: listPublishedCreatorIDsByNameAscQuery,
			wantPrev:  true,
		},
		{
			name:      "backward",
			direction: pagination.Backward,
			wantQuery: listPublishedCreatorIDsByNameDescQuery,
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
			resp, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Token:  token,
			}))
			if err != nil {
				t.Fatalf("ListPublishedCreators: %v", err)
			}
			if len(resp.Msg.Creators) != 0 {
				t.Fatalf("creators = %+v, want empty", resp.Msg.Creators)
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

func TestCatalogListPublishedCreatorsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "Mika", boundaryID.String(), creatorInclusiveKey)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorIDsByNameAscQuery)).
		WithArgs(tenantID, boundaryID, true, "Mika", int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators: %v", err)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty after a failed recovery", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedCreatorsRejectsBrokenToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
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

func TestCatalogListPublishedCreatorsRejectsUnknownFourthKey(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	token := pagination.Encode(pagination.Forward, "Mika", uuid.Must(uuid.NewV7()).String(), "nope")

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedCreatorsLimitOutOfRangeUsesDefault(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedCreatorIDsByNameAscQuery)).
		WithArgs(tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  101,
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators: %v", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedCreatorDetailSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
		WithArgs(tenantID, "CREATOR00001").
		WillReturnRows(creatorListColumns().
			AddRow(creatorID, "CREATOR00001", "Aoi Sakura", "Draws things", nil, nil, int64(0), int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleAscQuery)).
		WithArgs(creatorID, tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows(seriesID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(seriesID, "SERIESPUB", "Public Series", "Public Synopsis", "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "CREATOR00001",
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail: %v", err)
	}
	if resp.Msg.Creator == nil || resp.Msg.Creator.PublicId != "CREATOR00001" {
		t.Fatalf("creator = %+v, want CREATOR00001", resp.Msg.Creator)
	}
	if resp.Msg.Creator.PublishedSeriesCount != 1 {
		t.Fatalf("published_series_count = %d, want 1", resp.Msg.Creator.PublishedSeriesCount)
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

func TestCatalogGetPublishedCreatorDetailFirstPageReportsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(3)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
		WithArgs(tenantID, "CREATOR00001").
		WillReturnRows(creatorListColumns().
			AddRow(creatorID, "CREATOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(3)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleAscQuery)).
		WithArgs(creatorID, tenantID, nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESALPHA", "Alpha", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)).
			AddRow(ids[1], "SERIESBETA0", "Beta", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "CREATOR00001",
		Limit:    2,
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail: %v", err)
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

func TestCatalogGetPublishedCreatorDetailFollowsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "title_asc", "Beta", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(1)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
		WithArgs(tenantID, "CREATOR00001").
		WillReturnRows(creatorListColumns().
			AddRow(creatorID, "CREATOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(3)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleAscQuery)).
		WithArgs(creatorID, tenantID, boundaryID, false, "Beta", int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESZETA0", "Zeta", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "CREATOR00001",
		Limit:    2,
		Token:    token,
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail: %v", err)
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

func TestCatalogGetPublishedCreatorDetailFollowsPreviousTokenBackwards(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Backward, "title_asc", "Zeta", boundaryID.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	alphaID := uuid.Must(uuid.NewV7())
	betaID := uuid.Must(uuid.NewV7())
	// A backward page scans descending titles, so Zeta's predecessor Beta
	// comes first, then Alpha. pagination.Page flips that back to title asc.
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
		WithArgs(tenantID, "CREATOR00001").
		WillReturnRows(creatorListColumns().
			AddRow(creatorID, "CREATOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(3)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleDescQuery)).
		WithArgs(creatorID, tenantID, boundaryID, false, "Zeta", int32(3)).
		WillReturnRows(seriesIDRows(betaID, alphaID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(alphaID, "SERIESALPHA", "Alpha", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)).
			AddRow(betaID, "SERIESBETA0", "Beta", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "CREATOR00001",
		Limit:    2,
		Token:    token,
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail: %v", err)
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

func TestCatalogGetPublishedCreatorDetailEmptyPageKeepsAWayBack(t *testing.T) {
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
			creatorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC()
			boundaryID := uuid.Must(uuid.NewV7())
			token := pagination.Encode(test.direction, "title_asc", "Beta", boundaryID.String())

			expectTenantLookup(mock, tenantID, "TENANT", now)
			mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
				WithArgs(tenantID, "CREATOR00001").
				WillReturnRows(creatorListColumns().
					AddRow(creatorID, "CREATOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(1)))
			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(creatorID, tenantID, boundaryID, false, "Beta", int32(21)).
				WillReturnRows(seriesIDRows())

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			resp, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				PublicId: "CREATOR00001",
				Token:    token,
			}))
			if err != nil {
				t.Fatalf("GetPublishedCreatorDetail: %v", err)
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

func TestCatalogGetPublishedCreatorDetailEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "title_asc", "Beta", boundaryID.String(), seriesInclusiveKey)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
		WithArgs(tenantID, "CREATOR00001").
		WillReturnRows(creatorListColumns().
			AddRow(creatorID, "CREATOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleAscQuery)).
		WithArgs(creatorID, tenantID, boundaryID, true, "Beta", int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "CREATOR00001",
		Token:    token,
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail: %v", err)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty after a failed recovery", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedCreatorDetailRejectsBrokenToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
		WithArgs(tenantID, "CREATOR00001").
		WillReturnRows(creatorListColumns().
			AddRow(creatorID, "CREATOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "CREATOR00001",
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

func TestCatalogGetPublishedCreatorDetailRejectsTokenFromAnotherOrder(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	token := pagination.Encode(pagination.Forward, "published_at_desc", time.Now().UTC().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
		WithArgs(tenantID, "CREATOR00001").
		WillReturnRows(creatorListColumns().
			AddRow(creatorID, "CREATOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "CREATOR00001",
		Token:    token,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument when the token was built for another order", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedCreatorDetailLimitOutOfRangeUsesDefault(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
		WithArgs(tenantID, "CREATOR00001").
		WillReturnRows(creatorListColumns().
			AddRow(creatorID, "CREATOR00001", "Aoi Sakura", nil, nil, nil, int64(0), int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByCreatorTitleAscQuery)).
		WithArgs(creatorID, tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "CREATOR00001",
		Limit:    101,
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail: %v", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedCreatorDetailNotFound(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
		WithArgs(tenantID, "MISSING00001").
		WillReturnError(sql.ErrNoRows)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "MISSING00001",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("error = %v, want not_found", err)
	}
	if err.Error() != "not_found: creator not found" {
		t.Fatalf("error = %q, want creator not found", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedCreatorDetailDatabaseErrorIsHidden(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedCreatorByPublicIDQuery)).
		WithArgs(tenantID, "CREATOR00001").
		WillReturnError(errors.New(`pq: relation "creators" does not exist`))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "CREATOR00001",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetPublishedCreatorDetail code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertPublicExpectations(t, mock)
}

func TestListPublishedCreatorQueriesHavePublicationGuards(t *testing.T) {
	queries := map[string]string{
		"listPublishedCreatorIDsByNameAsc":         listPublishedCreatorIDsByNameAscQuery,
		"listPublishedCreatorIDsByNameDesc":        listPublishedCreatorIDsByNameDescQuery,
		"listPublishedCreatorIDsBySearchNameAsc":   listPublishedCreatorIDsBySearchNameAscQuery,
		"listPublishedCreatorIDsBySearchNameDesc":  listPublishedCreatorIDsBySearchNameDescQuery,
		"listPublishedCreatorsByIDs":               listPublishedCreatorsByIDsQuery,
		"getPublishedCreatorByPublicID":            getPublishedCreatorByPublicIDQuery,
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
		"listPublishedCreatorIDsByNameAsc",
		"listPublishedCreatorIDsByNameDesc",
		"listPublishedCreatorIDsBySearchNameAsc",
		"listPublishedCreatorIDsBySearchNameDesc",
		"listPublishedCreatorsByIDs",
		"getPublishedCreatorByPublicID",
	} {
		if !strings.Contains(compactSQL(queries[name]), creatorPublishedJoin) {
			t.Fatalf("%s does not use the shared creator→published-series join", name)
		}
	}
}

func compactSQL(query string) string {
	return strings.Join(strings.Fields(query), " ")
}
