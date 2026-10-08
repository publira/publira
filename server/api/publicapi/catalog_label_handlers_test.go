package publicapi

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
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
)

func labelColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at", "published_series_count"})
}

// addLabelRow appends a label without an eye catch image, so the page needs no
// follow-up variant query.
func addLabelRow(rows *sqlmock.Rows, id uuid.UUID, publicID, name string, createdAt time.Time) *sqlmock.Rows {
	return rows.AddRow(id, publicID, name, createdAt, nil, nil, int32(0))
}

func labelNames(labels []*publirav1.PublishedLabel) []string {
	names := make([]string, 0, len(labels))
	for _, label := range labels {
		names = append(names, label.Name)
	}
	return names
}

func newLabelListRequest(tenantID uuid.UUID) *publirav1.ListPublishedLabelsRequest {
	return &publirav1.ListPublishedLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
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
		rows = addLabelRow(rows, id, fmt.Sprintf("LABEL%03d", i), fmt.Sprintf("Label %d", i), now.Add(-time.Duration(i)*time.Minute))
	}
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsDesc)).
		WithArgs("web", tenantID, false, uuid.NullUUID{}, false, sqlmock.AnyArg(), int32(3)).
		WillReturnRows(rows)

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := newLabelListRequest(tenantID)
	req.Limit = 2
	resp, err := client.ListPublishedLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPublishedLabels: %v", err)
	}
	if got := labelNames(resp.Labels); !slices.Equal(got, []string{"Label 0", "Label 1"}) {
		t.Fatalf("labels = %v, want the first page only", got)
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.PreviousToken)
	}
	next, err := pagination.Decode(resp.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantNext := []string{"surface:web", now.Add(-time.Minute).Format(time.RFC3339Nano), ids[1].String()}
	if next.Direction != pagination.Forward || !slices.Equal(next.Keys, wantNext) {
		t.Fatalf("next_token = %+v, want forward keys %v", next, wantNext)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedLabelsCarriesPublishedSeriesCount(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	rows := labelColumns().
		AddRow(uuid.Must(uuid.NewV7()), "LABEL001", "Busy", now, nil, nil, int32(4)).
		AddRow(uuid.Must(uuid.NewV7()), "LABEL002", "Empty", now.Add(-time.Minute), nil, nil, int32(0))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsDesc)).
		WithArgs("web", tenantID, false, uuid.NullUUID{}, false, sqlmock.AnyArg(), defaultLabelPageSize+1).
		WillReturnRows(rows)

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.ListPublishedLabels(context.Background(), newLabelListRequest(tenantID))
	if err != nil {
		t.Fatalf("ListPublishedLabels: %v", err)
	}
	got := make([]int32, 0, len(resp.Labels))
	for _, label := range resp.Labels {
		got = append(got, label.PublishedSeriesCount)
	}
	if !slices.Equal(got, []int32{4, 0}) {
		t.Fatalf("published_series_count = %v, want [4 0]", got)
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

	rows := addLabelRow(addLabelRow(labelColumns(), olderID, "LABEL002", "Older", olderAt), newerID, "LABEL001", "Newer", newerAt)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsAsc)).
		WithArgs("web", tenantID, false, uuid.NullUUID{UUID: boundaryID, Valid: true}, false, sqlmock.AnyArg(), int32(3)).
		WillReturnRows(rows)

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := newLabelListRequest(tenantID)
	req.Limit = 2
	req.Token = onWeb(pagination.EncodeTimeUUID(pagination.Backward, boundaryAt, boundaryID))
	resp, err := client.ListPublishedLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPublishedLabels: %v", err)
	}
	if got := labelNames(resp.Labels); !slices.Equal(got, []string{"Newer", "Older"}) {
		t.Fatalf("labels = %v, want the backward page restored to descending order", got)
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.PreviousToken)
	}
	next, err := pagination.Decode(resp.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantNext := []string{"surface:web", olderAt.Format(time.RFC3339Nano), olderID.String()}
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsDesc)).
		WithArgs("web", tenantID, false, uuid.NullUUID{UUID: boundaryID, Valid: true}, false, sqlmock.AnyArg(), defaultLabelPageSize+1).
		WillReturnRows(labelColumns())

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := newLabelListRequest(tenantID)
	req.Token = onWeb(pagination.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID))
	resp, err := client.ListPublishedLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPublishedLabels: %v", err)
	}
	if len(resp.Labels) != 0 {
		t.Fatalf("labels count = %d, want 0", len(resp.Labels))
	}
	if resp.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on an emptied page", resp.NextToken)
	}
	previous, err := pagination.Decode(resp.PreviousToken)
	if err != nil {
		t.Fatalf("decode previous_token: %v", err)
	}
	wantKeys := []string{"surface:web", boundaryAt.Format(time.RFC3339Nano), boundaryID.String(), "inclusive"}
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

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := newLabelListRequest(tenantID)
	req.Token = "not-a-token"
	_, err := client.ListPublishedLabels(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListPublishedLabels code = %v, want invalid_argument", connect.CodeOf(err))
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedLabelsReadsTheAppSurface(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	rows := addLabelRow(addLabelRow(labelColumns(), labelID, "LABEL001", "App Label", now), uuid.Must(uuid.NewV7()), "LABEL002", "Older", now.Add(-time.Minute))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsDesc)).
		WithArgs("app", tenantID, false, uuid.NullUUID{}, false, sqlmock.AnyArg(), int32(2)).
		WillReturnRows(rows)

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := newLabelListRequest(tenantID)
	req.Limit = 1
	req.Surface = publirattypesv1.ClientSurface_CLIENT_SURFACE_APP
	resp, err := client.ListPublishedLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPublishedLabels: %v", err)
	}
	next, err := pagination.Decode(resp.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantNext := []string{"surface:app", now.Format(time.RFC3339Nano), labelID.String()}
	if !slices.Equal(next.Keys, wantNext) {
		t.Fatalf("next_token keys = %v, want %v bound to the app", next.Keys, wantNext)
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedLabelsRejectsATokenFromAnotherSurface(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := newLabelListRequest(tenantID)
	req.Surface = publirattypesv1.ClientSurface_CLIENT_SURFACE_APP
	req.Token = onWeb(pagination.EncodeTimeUUID(pagination.Forward, now, uuid.Must(uuid.NewV7())))
	_, err := client.ListPublishedLabels(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListPublishedLabels code = %v, want invalid_argument", connect.CodeOf(err))
	}

	assertPublicExpectations(t, mock)
}

func TestCatalogListPublishedLabelsBindsTheTokenToHasPublishedSeries(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	rows := addLabelRow(addLabelRow(labelColumns(), labelID, "LABEL001", "Busy", now), uuid.Must(uuid.NewV7()), "LABEL002", "Older", now.Add(-time.Minute))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsDesc)).
		WithArgs("web", tenantID, true, uuid.NullUUID{}, false, sqlmock.AnyArg(), int32(2)).
		WillReturnRows(rows)

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := newLabelListRequest(tenantID)
	req.Limit = 1
	req.HasPublishedSeries = true
	resp, err := client.ListPublishedLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPublishedLabels: %v", err)
	}
	next, err := pagination.Decode(resp.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantNext := []string{"surface:web", "created_at_desc+has_published_series", now.Format(time.RFC3339Nano), labelID.String()}
	if next.Direction != pagination.Forward || !slices.Equal(next.Keys, wantNext) {
		t.Fatalf("next_token = %+v, want forward keys %v", next, wantNext)
	}

	assertPublicExpectations(t, mock)
}

// The filter decides which labels the list holds, so a token from one value of
// it points into a list the other value does not have.
func TestCatalogListPublishedLabelsRejectsATokenFromTheOtherFilter(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	tests := []struct {
		name               string
		hasPublishedSeries bool
		token              string
	}{
		{
			name:               "an unfiltered token on the filtered list",
			hasPublishedSeries: true,
			token:              onWeb(pagination.EncodeTimeUUID(pagination.Forward, now, boundaryID)),
		},
		{
			name:               "a filtered token on the unfiltered list",
			hasPublishedSeries: false,
			token:              onWeb(labelListKey(true).EncodeTimeUUID(pagination.Forward, now, boundaryID)),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			expectTenantLookup(mock, tenantID, "TENANT", now)

			client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			req := newLabelListRequest(tenantID)
			req.HasPublishedSeries = tc.hasPublishedSeries
			req.Token = tc.token
			_, err := client.ListPublishedLabels(context.Background(), req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("ListPublishedLabels code = %v, want invalid_argument", connect.CodeOf(err))
			}

			assertPublicExpectations(t, mock)
		})
	}
}

func TestCatalogListPublishedLabelsVariantLookupErrorIsReturned(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	imageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	rows := labelColumns().AddRow(labelID, "LABEL001", "Label", now, imageID, now, int32(0))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedLabelsDesc)).
		WithArgs("web", tenantID, false, uuid.NullUUID{}, false, sqlmock.AnyArg(), defaultLabelPageSize+1).
		WillReturnRows(rows)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListLabelImageVariantsByImageIDs)).
		WillReturnError(errors.New(`pq: relation "label_image_variants" does not exist`))

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedLabelByPublicID)).
		WithArgs("web", tenantID, "LABEL000001").
		WillReturnRows(labelDetailColumns().
			AddRow(labelID, "LABEL000001", "Weekly Jump", nil, nil, int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedSeriesIDsByLabelTitleAsc)).
		WithArgs(labelID, tenantID, "web", nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows(seriesID))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(seriesID, "SERIESPUB", "Public Series", "Public Synopsis", "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetPublishedLabelDetail(context.Background(), &publirav1.GetPublishedLabelDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "LABEL000001",
	})
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail: %v", err)
	}
	if resp.Label == nil || resp.Label.PublicId != "LABEL000001" {
		t.Fatalf("label = %+v, want LABEL000001", resp.Label)
	}
	if resp.Label.Name != "Weekly Jump" {
		t.Fatalf("name = %q, want Weekly Jump", resp.Label.Name)
	}
	if resp.Label.PublishedSeriesCount != 1 {
		t.Fatalf("published_series_count = %d, want 1", resp.Label.PublishedSeriesCount)
	}
	if len(resp.Series) != 1 || resp.Series[0].PublicId != "SERIESPUB" {
		t.Fatalf("series = %+v, want SERIESPUB", resp.Series)
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.PreviousToken)
	}
	if resp.NextToken != "" {
		t.Fatalf("next_token = %q, want empty when every series fits in one page", resp.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedLabelDetailReturnsLabelWithNoSeries(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedLabelByPublicID)).
		WithArgs("web", tenantID, "LABELEMPTY1").
		WillReturnRows(labelDetailColumns().
			AddRow(labelID, "LABELEMPTY1", "Empty Label", nil, nil, int32(0)))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedSeriesIDsByLabelTitleAsc)).
		WithArgs(labelID, tenantID, "web", nil, false, nil, int32(21)).
		WillReturnRows(seriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetPublishedLabelDetail(context.Background(), &publirav1.GetPublishedLabelDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "LABELEMPTY1",
	})
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail: %v", err)
	}
	if resp.Label == nil || resp.Label.PublicId != "LABELEMPTY1" {
		t.Fatalf("label = %+v, want LABELEMPTY1", resp.Label)
	}
	if len(resp.Series) != 0 {
		t.Fatalf("series count = %d, want 0", len(resp.Series))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedLabelDetailNotFound(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedLabelByPublicID)).
		WithArgs("web", tenantID, "MISSING00001").
		WillReturnRows(labelDetailColumns())

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	_, err := client.GetPublishedLabelDetail(context.Background(), &publirav1.GetPublishedLabelDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "MISSING00001",
	})
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedLabelByPublicID)).
		WithArgs("web", tenantID, "LABEL000001").
		WillReturnRows(labelDetailColumns().
			AddRow(labelID, "LABEL000001", "Weekly Jump", nil, nil, int32(3)))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedSeriesIDsByLabelTitleAsc)).
		WithArgs(labelID, tenantID, "web", nil, false, nil, int32(3)).
		WillReturnRows(seriesIDRows(ids...))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(seriesDetailColumns().
			AddRow(ids[0], "SERIESALPHA", "Alpha", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)).
			AddRow(ids[1], "SERIESBETA0", "Beta", nil, "ongoing", []byte("{}"), "all", now, nil, nil, int32(0), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`)))

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetPublishedLabelDetail(context.Background(), &publirav1.GetPublishedLabelDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "LABEL000001",
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail: %v", err)
	}
	if got := len(resp.Series); got != 2 {
		t.Fatalf("series count = %d, want the over-fetched row dropped", got)
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.PreviousToken)
	}
	wantToken := webToken(pagination.Forward, "title_asc", "Beta", ids[1].String())
	if resp.NextToken != wantToken {
		t.Fatalf("next_token = %q, want the last returned title cursor", resp.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogGetPublishedLabelDetailRejectsInvalidToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedLabelByPublicID)).
		WithArgs("web", tenantID, "LABEL000001").
		WillReturnRows(labelDetailColumns().
			AddRow(labelID, "LABEL000001", "Weekly Jump", nil, nil, int32(1)))

	client := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	_, err := client.GetPublishedLabelDetail(context.Background(), &publirav1.GetPublishedLabelDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "LABEL000001",
		Token:    "not-a-token",
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid_argument", err)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("error = %q, want token internals hidden", err)
	}
	assertPublicExpectations(t, mock)
}
