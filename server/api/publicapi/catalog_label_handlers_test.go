package publicapi

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
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

const (
	listLabelsByTenantDescQuery = "-- name: ListLabelsByTenantDesc :many\n"
	listLabelsByTenantAscQuery  = "-- name: ListLabelsByTenantAsc :many\n"
)

func labelColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"})
}

// addLabelRow appends a label without an eye catch image, so the page needs no
// follow-up variant query.
func addLabelRow(rows *sqlmock.Rows, tenantID, id uuid.UUID, publicID, name string, createdAt time.Time) *sqlmock.Rows {
	return rows.AddRow(id, tenantID, publicID, name, createdAt, nil, nil)
}

func labelNames(labels []*publirattypesv1.Label) []string {
	names := make([]string, 0, len(labels))
	for _, label := range labels {
		names = append(names, label.Name)
	}
	return names
}

func newLabelListRequest(tenantID uuid.UUID) *connect.Request[publirav1.ListPublishedLabelsRequest] {
	return connect.NewRequest(&publirav1.ListPublishedLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
}

func TestCatalogListPublishedLabelsFirstPageReportsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}
	expectTenantLookup(mock, tenantID, "TENANT", now)

	// The handler over-fetches by one row; that extra row is what says another
	// page exists, and it must not reach the response.
	rows := labelColumns()
	for i, id := range ids {
		rows = addLabelRow(rows, tenantID, id, fmt.Sprintf("LABEL%03d", i), fmt.Sprintf("Label %d", i), now.Add(-time.Duration(i)*time.Minute))
	}
	mock.ExpectQuery(regexp.QuoteMeta(listLabelsByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sqlmock.AnyArg(), int32(3)).
		WillReturnRows(rows)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	req := newLabelListRequest(tenantID)
	req.Msg.Limit = 2
	resp, err := client.ListPublishedLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPublishedLabels: %v", err)
	}
	if got := labelNames(resp.Msg.Labels); !slices.Equal(got, []string{"Label 0", "Label 1"}) {
		t.Fatalf("labels = %v, want the first page only", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	next, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantNext := []string{now.Add(-time.Minute).Format(time.RFC3339Nano), ids[1].String()}
	if next.Direction != pagination.Forward || !slices.Equal(next.Keys, wantNext) {
		t.Fatalf("next_token = %+v, want forward keys %v", next, wantNext)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedLabelsFollowsPreviousTokenBackwards(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	olderID := uuid.Must(uuid.NewV7())
	newerID := uuid.Must(uuid.NewV7())
	olderAt := now.Add(-2 * time.Minute)
	newerAt := now.Add(-time.Minute)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	rows := addLabelRow(addLabelRow(labelColumns(), tenantID, olderID, "LABEL002", "Older", olderAt), tenantID, newerID, "LABEL001", "Newer", newerAt)
	mock.ExpectQuery(regexp.QuoteMeta(listLabelsByTenantAscQuery)).
		WithArgs(tenantID, uuid.NullUUID{UUID: boundaryID, Valid: true}, false, sqlmock.AnyArg(), int32(3)).
		WillReturnRows(rows)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	req := newLabelListRequest(tenantID)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.EncodeTimeUUID(pagination.Backward, boundaryAt, boundaryID)
	resp, err := client.ListPublishedLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPublishedLabels: %v", err)
	}
	if got := labelNames(resp.Msg.Labels); !slices.Equal(got, []string{"Newer", "Older"}) {
		t.Fatalf("labels = %v, want the backward page restored to descending order", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	next, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantNext := []string{olderAt.Format(time.RFC3339Nano), olderID.String()}
	if next.Direction != pagination.Forward || !slices.Equal(next.Keys, wantNext) {
		t.Fatalf("next_token = %+v, want forward keys %v", next, wantNext)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedLabelsEmptyPageKeepsAWayBack(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	mock.ExpectQuery(regexp.QuoteMeta(listLabelsByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{UUID: boundaryID, Valid: true}, false, sqlmock.AnyArg(), defaultLabelPageSize+1).
		WillReturnRows(labelColumns())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	req := newLabelListRequest(tenantID)
	req.Msg.Token = pagination.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID)
	resp, err := client.ListPublishedLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPublishedLabels: %v", err)
	}
	if len(resp.Msg.Labels) != 0 {
		t.Fatalf("labels count = %d, want 0", len(resp.Msg.Labels))
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on an emptied page", resp.Msg.NextToken)
	}
	previous, err := pagination.Decode(resp.Msg.PreviousToken)
	if err != nil {
		t.Fatalf("decode previous_token: %v", err)
	}
	wantKeys := []string{boundaryAt.Format(time.RFC3339Nano), boundaryID.String(), "inclusive"}
	if previous.Direction != pagination.Backward || !slices.Equal(previous.Keys, wantKeys) {
		t.Fatalf("previous_token = %+v, want backward recovery keys %v", previous, wantKeys)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedLabelsRejectsBrokenToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	req := newLabelListRequest(tenantID)
	req.Msg.Token = "not-a-token"
	_, err := client.ListPublishedLabels(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListPublishedLabels code = %v, want invalid_argument", connect.CodeOf(err))
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedLabelsVariantLookupErrorIsReturned(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	imageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	rows := sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"}).
		AddRow(labelID, tenantID, "LABEL001", "Label", now, imageID, now)
	mock.ExpectQuery(regexp.QuoteMeta(listLabelsByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sqlmock.AnyArg(), defaultLabelPageSize+1).
		WillReturnRows(rows)
	mock.ExpectQuery(regexp.QuoteMeta("-- name: ListLabelImageVariantsByImageIDs :many\n")).
		WillReturnError(errors.New(`pq: relation "label_image_variants" does not exist`))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListPublishedLabels(context.Background(), newLabelListRequest(tenantID))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListPublishedLabels code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}

	assertPublicExpectations(t, mock)
}

func labelDetailColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"public_id",
		"name",
		"eye_catch_image_id",
		"eye_catch_image_updated_at",
		"published_series_count",
	})
}

func TestCatalogGetPublishedLabelDetailSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedLabelByPublicIDQuery)).
		WithArgs(tenantID, "LABEL000001").
		WillReturnRows(labelDetailColumns().
			AddRow(labelID, "LABEL000001", "Weekly Jump", nil, nil, int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByLabelTitleAscQuery)).
		WithArgs(labelID, tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows(seriesID))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(seriesID, "SERIESPUB", "Public Series", "Public Synopsis", now, nil, nil, []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "LABEL000001",
	}))
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail: %v", err)
	}
	if resp.Msg.Label == nil || resp.Msg.Label.PublicId != "LABEL000001" {
		t.Fatalf("label = %+v, want LABEL000001", resp.Msg.Label)
	}
	if resp.Msg.Label.Name != "Weekly Jump" {
		t.Fatalf("name = %q, want Weekly Jump", resp.Msg.Label.Name)
	}
	if resp.Msg.Label.PublishedSeriesCount != 1 {
		t.Fatalf("published_series_count = %d, want 1", resp.Msg.Label.PublishedSeriesCount)
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

func TestCatalogGetPublishedLabelDetailReturnsLabelWithNoSeries(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedLabelByPublicIDQuery)).
		WithArgs(tenantID, "LABELEMPTY1").
		WillReturnRows(labelDetailColumns().
			AddRow(labelID, "LABELEMPTY1", "Empty Label", nil, nil, int32(0)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByLabelTitleAscQuery)).
		WithArgs(labelID, tenantID, nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "LABELEMPTY1",
	}))
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail: %v", err)
	}
	if resp.Msg.Label == nil || resp.Msg.Label.PublicId != "LABELEMPTY1" {
		t.Fatalf("label = %+v, want LABELEMPTY1", resp.Msg.Label)
	}
	if len(resp.Msg.Series) != 0 {
		t.Fatalf("series count = %d, want 0", len(resp.Msg.Series))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedLabelDetailNotFound(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedLabelByPublicIDQuery)).
		WithArgs(tenantID, "MISSING00001").
		WillReturnRows(labelDetailColumns())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "MISSING00001",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("error = %v, want not_found", err)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedLabelDetailFirstPageReportsNextToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	ids := newSeriesIDs(3)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedLabelByPublicIDQuery)).
		WithArgs(tenantID, "LABEL000001").
		WillReturnRows(labelDetailColumns().
			AddRow(labelID, "LABEL000001", "Weekly Jump", nil, nil, int32(3)))
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedSeriesIDsByLabelTitleAscQuery)).
		WithArgs(labelID, tenantID, nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(listActiveSeriesByIDsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESALPHA", "Alpha", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)).
			AddRow(ids[1], "SERIESBETA0", "Beta", nil, now, nil, nil, []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "LABEL000001",
		Limit:    2,
	}))
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail: %v", err)
	}
	if got := len(resp.Msg.Series); got != 2 {
		t.Fatalf("series count = %d, want the over-fetched row dropped", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	wantToken := pagination.Encode(pagination.Forward, "title_asc", "Beta", ids[1].String())
	if resp.Msg.NextToken != wantToken {
		t.Fatalf("next_token = %q, want the last returned title cursor", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedLabelDetailRejectsInvalidToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedLabelByPublicIDQuery)).
		WithArgs(tenantID, "LABEL000001").
		WillReturnRows(labelDetailColumns().
			AddRow(labelID, "LABEL000001", "Weekly Jump", nil, nil, int32(1)))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "LABEL000001",
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
