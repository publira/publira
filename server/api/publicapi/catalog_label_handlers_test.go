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
