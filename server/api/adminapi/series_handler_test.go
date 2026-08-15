package adminapi

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publicid"
)

func seriesColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"public_id",
		"title",
		"label_public_id",
		"label_name",
		"synopsis",
		"reading_period_hours",
		"is_published",
		"published_at",
		"created_at",
		"eye_catch_image_id",
		"eye_catch_image_updated_at",
		"eye_catch_image_file_size_bytes",
	})
}

func addSeriesRow(
	rows *sqlmock.Rows,
	id uuid.UUID,
	publicID, title string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(id, publicID, title, nil, nil, "Synopsis", nil, true, createdAt, createdAt, nil, nil, int64(0))
}

// Every non-empty page reads the creators of the series it returned.
func expectSeriesCreatorsLookup(mock sqlmock.Sqlmock) {
	mock.ExpectQuery("FROM series_creators").
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "public_id", "name", "role", "display_order"}))
}

func newSeriesClient(
	t *testing.T,
	tenantID, userID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminSeriesServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	return publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newListSeriesRequest(tenantID uuid.UUID, sessionToken string) *connect.Request[publiraadminv1.ListSeriesRequest] {
	req := connect.NewRequest(&publiraadminv1.ListSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func seriesPublicIDs(items []*publirattypesv1.Series) []string {
	publicIDs := make([]string, 0, len(items))
	for _, item := range items {
		publicIDs = append(publicIDs, item.PublicId)
	}
	return publicIDs
}

func TestAdminSeriesRequiresSession(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListSeries(context.Background(), connect.NewRequest(&publiraadminv1.ListSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListSeries error code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	if err == nil || err.Error() != "unauthenticated: invalid token" {
		t.Fatalf("ListSeries error = %v, want unauthenticated invalid token", err)
	}
	assertExpectations(t, mock)
}

func TestAdminSeriesAllowsValidSession(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newSeriesClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listSeriesByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addSeriesRow(seriesColumns(), seriesID, "SERIES001", "Series Title", now))
	expectSeriesCreatorsLookup(mock)

	resp, err := client.ListSeries(context.Background(), newListSeriesRequest(tenantID, sessionToken))
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if len(resp.Msg.Series) != 1 {
		t.Fatalf("series count = %d, want 1", len(resp.Msg.Series))
	}
	if resp.Msg.Series[0].PublicId != "SERIES001" {
		t.Fatalf("series public_id = %q, want SERIES001", resp.Msg.Series[0].PublicId)
	}
	if !resp.Msg.Series[0].IsPublished {
		t.Fatalf("series is_published = %v, want true", resp.Msg.Series[0].IsPublished)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListSeriesFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newSeriesClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(listSeriesByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addSeriesRow(
			addSeriesRow(
				addSeriesRow(seriesColumns(), ids[0], "SERIES001", "First", now),
				ids[1], "SERIES002", "Second", now.Add(-time.Minute),
			),
			ids[2], "SERIES003", "Third", now.Add(-2*time.Minute),
		))
	expectSeriesCreatorsLookup(mock)

	req := newListSeriesRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	resp, err := client.ListSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if len(resp.Msg.Series) != 2 {
		t.Fatalf("series count = %d, want the over-fetched row dropped", len(resp.Msg.Series))
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantKeys := []string{now.Add(-time.Minute).Format(time.RFC3339Nano), ids[1].String()}
	if cursor.Direction != pagination.Forward || !slices.Equal(cursor.Keys, wantKeys) {
		t.Fatalf("next_token = %+v, want forward keys %v", cursor, wantKeys)
	}
	assertExpectations(t, mock)
}

// The last page is reachable by following next_token, without an offset.
func TestListSeriesFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	client, mock, sessionToken := newSeriesClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listSeriesByTenantDescQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addSeriesRow(seriesColumns(), uuid.Must(uuid.NewV7()), "SERIES003", "Last", now.Add(-2*time.Minute)))
	expectSeriesCreatorsLookup(mock)

	req := newListSeriesRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Forward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if !slices.Equal(seriesPublicIDs(resp.Msg.Series), []string{"SERIES003"}) {
		t.Fatalf("public_ids = %v, want the page after the boundary row", seriesPublicIDs(resp.Msg.Series))
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListSeriesFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	client, mock, sessionToken := newSeriesClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listSeriesByTenantAscQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addSeriesRow(
			addSeriesRow(seriesColumns(), uuid.Must(uuid.NewV7()), "SERIES002", "Older", now.Add(-2*time.Minute)),
			uuid.Must(uuid.NewV7()), "SERIES001", "Newer", now.Add(-time.Minute),
		))
	expectSeriesCreatorsLookup(mock)

	req := newListSeriesRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Backward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if !slices.Equal(seriesPublicIDs(resp.Msg.Series), []string{"SERIES001", "SERIES002"}) {
		t.Fatalf("public_ids = %v, want backward page restored to descending order", seriesPublicIDs(resp.Msg.Series))
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertExpectations(t, mock)
}

func TestListSeriesEmptyPageKeepsAWayBack(t *testing.T) {
	tests := []struct {
		name                string
		direction           pagination.Direction
		wantQuery           string
		wantRecoveryQuery   string
		wantRecoveredSeries []string
	}{
		{
			name:                "forward",
			direction:           pagination.Forward,
			wantQuery:           listSeriesByTenantDescQuery,
			wantRecoveryQuery:   listSeriesByTenantAscQuery,
			wantRecoveredSeries: []string{"SERIES001", "SERIES002"},
		},
		{
			name:                "backward",
			direction:           pagination.Backward,
			wantQuery:           listSeriesByTenantAscQuery,
			wantRecoveryQuery:   listSeriesByTenantDescQuery,
			wantRecoveredSeries: []string{"SERIES002", "SERIES003"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newSeriesClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, false, now, int32(21)).
				WillReturnRows(seriesColumns())

			req := newListSeriesRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.Encode(test.direction, now.Format(time.RFC3339Nano), boundaryID.String())
			resp, err := client.ListSeries(context.Background(), req)
			if err != nil {
				t.Fatalf("ListSeries: %v", err)
			}
			recoveryToken := resp.Msg.PreviousToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.Msg.NextToken
				recoveryDirection = pagination.Forward
			}
			wantRecoveryToken := pagination.EncodeTimeUUIDRecovery(recoveryDirection, now, boundaryID)
			if recoveryToken != wantRecoveryToken {
				t.Fatalf("recovery token = %q, want %q", recoveryToken, wantRecoveryToken)
			}

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			recoveryRows := addSeriesRow(seriesColumns(), boundaryID, "SERIES002", "Boundary", now)
			if test.direction == pagination.Forward {
				recoveryRows = addSeriesRow(recoveryRows, uuid.Must(uuid.NewV7()), "SERIES001", "Newer", now.Add(time.Minute))
			} else {
				recoveryRows = addSeriesRow(recoveryRows, uuid.Must(uuid.NewV7()), "SERIES003", "Older", now.Add(-time.Minute))
			}
			mock.ExpectQuery(regexp.QuoteMeta(test.wantRecoveryQuery)).
				WithArgs(tenantID, boundaryID, true, now, int32(21)).
				WillReturnRows(recoveryRows)
			expectSeriesCreatorsLookup(mock)

			recoveryReq := newListSeriesRequest(tenantID, sessionToken)
			recoveryReq.Msg.Token = recoveryToken
			recovered, err := client.ListSeries(context.Background(), recoveryReq)
			if err != nil {
				t.Fatalf("ListSeries recovery: %v", err)
			}
			if !slices.Equal(seriesPublicIDs(recovered.Msg.Series), test.wantRecoveredSeries) {
				t.Fatalf("recovered public_ids = %v, want %v", seriesPublicIDs(recovered.Msg.Series), test.wantRecoveredSeries)
			}
			assertExpectations(t, mock)
		})
	}
}

// Recovery happens once. When the boundary row itself is gone the recovery
// query is empty too, and both tokens stay empty so the client falls back to
// the first page instead of bouncing between empty pages.
func TestListSeriesEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		wantQuery string
	}{
		{
			name:      "recovering backward",
			direction: pagination.Backward,
			wantQuery: listSeriesByTenantAscQuery,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: listSeriesByTenantDescQuery,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newSeriesClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, true, now, int32(21)).
				WillReturnRows(seriesColumns())

			req := newListSeriesRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.EncodeTimeUUIDRecovery(test.direction, now, boundaryID)
			resp, err := client.ListSeries(context.Background(), req)
			if err != nil {
				t.Fatalf("ListSeries: %v", err)
			}
			if len(resp.Msg.Series) != 0 {
				t.Fatalf("series = %d rows, want an empty page", len(resp.Msg.Series))
			}
			if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
				t.Fatalf(
					"previous_token = %q / next_token = %q, want both empty once recovery also came back empty",
					resp.Msg.PreviousToken, resp.Msg.NextToken,
				)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestListSeriesInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newSeriesClient(t, tenantID, userID, now)

	req := newListSeriesRequest(tenantID, sessionToken)
	req.Msg.Token = "not-a-valid-token"
	_, err := client.ListSeries(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListSeries code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("ListSeries error = %v, want invalid_argument token is invalid", err)
	}
	assertExpectations(t, mock)
}

func TestCreateSeriesRequiresTitle(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now()
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:  "   ",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.CreateSeries(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}

func TestCreateSeriesSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	labelID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
		WithArgs(tenantID, "LABEL001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"}).
			AddRow(labelID, tenantID, "LABEL001", "Weekly", now, nil, nil))

	mock.ExpectBegin()
	expectCreateSeriesBaseInsert(mock, seriesID, tenantID, "New Series", "SERIESNEW001", now, uuid.NullUUID{UUID: labelID, Valid: true})
	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(tenantID, seriesID, sql.NullString{String: "Synopsis", Valid: true}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at", "tenant_id"}).
			AddRow(seriesID, "Synopsis", nil, nil, nil, tenantID))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIESNEW001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}).
			AddRow(seriesID, "SERIESNEW001", "New Series", "LABEL001", "Weekly", "Synopsis", nil, true, now, nil, nil, int64(0)))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:         "New Series",
		Synopsis:      "Synopsis",
		LabelPublicId: "LABEL001",
		IsPublished:   true,
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.CreateSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if resp.Msg.Series == nil {
		t.Fatalf("series is nil")
	}
	if resp.Msg.Series.Title != "New Series" {
		t.Fatalf("series title = %q, want New Series", resp.Msg.Series.Title)
	}
	assertExpectations(t, mock)
}

// A public_id collision never reaches the client: the insert is retried with a
// freshly generated ID, and only a conflict on another constraint would surface.
func TestCreateSeriesRetriesDuplicatePublicID(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	attempted := &publicIDArgument{}
	mock.ExpectBegin()
	expectPublicIDAttempt(mock)
	mock.ExpectQuery("INSERT INTO series").
		WithArgs(sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), attempted, "New Series").
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "series_public_id_key"})
	expectPublicIDAttemptRolledBack(mock)
	expectPublicIDAttempt(mock)
	mock.ExpectQuery("INSERT INTO series").
		WithArgs(sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), attempted, "New Series").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "label_id", "public_id", "title", "created_at", "is_published", "published_at", "updated_at", "eye_catch_image_id"}).
			AddRow(seriesID, tenantID, nil, "4ERDqTx5YB8m", "New Series", now, false, nil, now, nil))
	expectPublicIDAttemptReleased(mock)

	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(tenantID, seriesID, sql.NullString{}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at", "tenant_id"}).
			AddRow(seriesID, nil, nil, nil, nil, tenantID))
	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "4ERDqTx5YB8m").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}).
			AddRow(seriesID, "4ERDqTx5YB8m", "New Series", nil, nil, nil, nil, false, nil, nil, nil, int64(0)))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:  "New Series",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.CreateSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if resp.Msg.Series.PublicId != "4ERDqTx5YB8m" {
		t.Fatalf("series public_id = %q, want 4ERDqTx5YB8m", resp.Msg.Series.PublicId)
	}
	if len(attempted.values) != 2 {
		t.Fatalf("public_id attempts = %v, want 2", attempted.values)
	}
	if attempted.values[0] == attempted.values[1] {
		t.Fatalf("retry reused public_id %q", attempted.values[0])
	}
	for _, value := range attempted.values {
		if !publicid.Valid(value) {
			t.Fatalf("generated public_id %q is not 12 Base58 characters", value)
		}
	}
	assertExpectations(t, mock)
}

// publicIDArgument matches any string argument and records what was passed, so
// a test can assert on the public IDs the handler generated.
type publicIDArgument struct {
	values []string
}

func (a *publicIDArgument) Match(v driver.Value) bool {
	value, ok := v.(string)
	if !ok {
		return false
	}
	a.values = append(a.values, value)

	return true
}

func TestUpdateSeriesRequiresTitle(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now()
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateSeriesRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "SERIES001",
		Title:    "\t",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.UpdateSeries(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateSeries code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}

func TestUpdateSeriesSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}).
			AddRow(seriesID, "SERIES001", "Before", nil, nil, "Old synopsis", nil, true, now, nil, nil, int64(0)))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(updateSeriesBaseQuery)).
		WithArgs(seriesID, "After", uuid.NullUUID{}).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(tenantID, seriesID, sql.NullString{String: "New synopsis", Valid: true}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at", "tenant_id"}).
			AddRow(seriesID, "New synopsis", nil, nil, nil, tenantID))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM series_creators").
		WithArgs(seriesID).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}).
			AddRow(seriesID, "SERIES001", "After", nil, nil, "New synopsis", nil, true, now, nil, nil, int64(0)))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateSeriesRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId:    "SERIES001",
		Title:       "After",
		Synopsis:    "New synopsis",
		IsPublished: true,
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.UpdateSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if resp.Msg.Series == nil {
		t.Fatalf("series is nil")
	}
	if resp.Msg.Series.Title != "After" {
		t.Fatalf("series title = %q, want After", resp.Msg.Series.Title)
	}
	if !resp.Msg.Series.IsPublished {
		t.Fatalf("series is_published = %v, want true", resp.Msg.Series.IsPublished)
	}
	assertExpectations(t, mock)
}

func TestCreateSeriesWithCreatorsSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	creatorID1 := uuid.Must(uuid.NewV7())
	creatorID2 := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}).
			AddRow(creatorID1, tenantID, "CREATOR001", "Creator One", "", now).
			AddRow(creatorID2, tenantID, "CREATOR002", "Creator Two", "", now))

	mock.ExpectBegin()
	expectCreateSeriesBaseInsert(mock, seriesID, tenantID, "New Series", "SERIESNEW001", now, uuid.NullUUID{})
	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(tenantID, seriesID, sql.NullString{String: "Synopsis", Valid: true}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at", "tenant_id"}).
			AddRow(seriesID, "Synopsis", nil, nil, nil, tenantID))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectExec("INSERT INTO series_creators").
		WithArgs(tenantID, seriesID, creatorID1, "creator", int32(0)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO series_creators").
		WithArgs(tenantID, seriesID, creatorID2, "creator", int32(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIESNEW001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}).
			AddRow(seriesID, "SERIESNEW001", "New Series", nil, nil, "Synopsis", nil, true, now, nil, nil, int64(0)))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:            "New Series",
		Synopsis:         "Synopsis",
		IsPublished:      true,
		CreatorPublicIds: []string{"CREATOR001", "CREATOR002"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.CreateSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if len(resp.Msg.Series.Creators) != 2 {
		t.Fatalf("creator count = %d, want 2", len(resp.Msg.Series.Creators))
	}
	if resp.Msg.Series.Creators[0].PublicId != "CREATOR001" {
		t.Fatalf("creator[0].public_id = %q, want CREATOR001", resp.Msg.Series.Creators[0].PublicId)
	}
	assertExpectations(t, mock)
}

func TestUpdateSeriesWithCreatorsSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	creatorID1 := uuid.Must(uuid.NewV7())
	creatorID2 := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}).
			AddRow(seriesID, "SERIES001", "Before", nil, nil, "Old synopsis", nil, true, now, nil, nil, int64(0)))

	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}).
			AddRow(creatorID1, tenantID, "CREATOR001", "Creator One", "", now).
			AddRow(creatorID2, tenantID, "CREATOR002", "Creator Two", "", now))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(updateSeriesBaseQuery)).
		WithArgs(seriesID, "After", uuid.NullUUID{}).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(tenantID, seriesID, sql.NullString{String: "New synopsis", Valid: true}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at", "tenant_id"}).
			AddRow(seriesID, "New synopsis", nil, nil, nil, tenantID))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectExec("DELETE FROM series_creators").
		WithArgs(seriesID).
		WillReturnResult(sqlmock.NewResult(0, 2))

	mock.ExpectExec("INSERT INTO series_creators").
		WithArgs(tenantID, seriesID, creatorID1, "creator", int32(0)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO series_creators").
		WithArgs(tenantID, seriesID, creatorID2, "creator", int32(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}).
			AddRow(seriesID, "SERIES001", "After", nil, nil, "New synopsis", nil, true, now, nil, nil, int64(0)))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateSeriesRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId:         "SERIES001",
		Title:            "After",
		Synopsis:         "New synopsis",
		IsPublished:      true,
		CreatorPublicIds: []string{"CREATOR001", "CREATOR002"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.UpdateSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if len(resp.Msg.Series.Creators) != 2 {
		t.Fatalf("creator count = %d, want 2", len(resp.Msg.Series.Creators))
	}
	if resp.Msg.Series.Creators[1].PublicId != "CREATOR002" {
		t.Fatalf("creator[1].public_id = %q, want CREATOR002", resp.Msg.Series.Creators[1].PublicId)
	}
	assertExpectations(t, mock)
}

func TestCreateSeriesUnknownCreatorDoesNotBeginTransaction(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:            "New Series",
		CreatorPublicIds: []string{"NOSUCHCREATOR"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.CreateSeries(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeInvalidArgument, err)
	}
	if err == nil || err.Error() != "invalid_argument: creator not found" {
		t.Fatalf("CreateSeries error = %v, want invalid_argument creator not found", err)
	}
	assertExpectations(t, mock)
}

func TestUpdateSeriesUnknownCreatorDoesNotBeginTransaction(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}).
			AddRow(seriesID, "SERIES001", "Before", nil, nil, "Old synopsis", nil, true, now, nil, nil, int64(0)))
	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateSeriesRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId:         "SERIES001",
		Title:            "After",
		CreatorPublicIds: []string{"NOSUCHCREATOR"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.UpdateSeries(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateSeries code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeInvalidArgument, err)
	}
	if err == nil || err.Error() != "invalid_argument: creator not found" {
		t.Fatalf("UpdateSeries error = %v, want invalid_argument creator not found", err)
	}
	assertExpectations(t, mock)
}

func TestCreateSeriesRollsBackWhenListingInsertFails(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectBegin()
	expectCreateSeriesBaseInsert(mock, seriesID, tenantID, "New Series", "SERIESNEW001", now, uuid.NullUUID{})
	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(tenantID, seriesID, sql.NullString{}, sql.NullInt32{}).
		WillReturnError(sql.ErrConnDone)
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:  "New Series",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.CreateSeries(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("CreateSeries code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeInternal, err)
	}
	assertExpectations(t, mock)
}

func TestAdminGetSeriesTenantBoundary(t *testing.T) {
	tests := []struct {
		name         string
		publicID     string
		rows         *sqlmock.Rows
		wantCode     connect.Code
		wantSeriesID string
	}{
		{
			name:     "normal",
			publicID: "SERIES001",
			rows: sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}).
				AddRow(uuid.Must(uuid.NewV7()), "SERIES001", "Series Title", nil, nil, "Synopsis", nil, true, time.Now(), nil, nil, int64(0)),
			wantSeriesID: "SERIES001",
		},
		{
			name:     "cross-tenant",
			publicID: "SERIES_OTHER_TENANT",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "not-found",
			publicID: "SERIES_MISSING",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at", "eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes"}),
			wantCode: connect.CodeNotFound,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now()
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
				WithArgs(tenantID, tc.publicID).
				WillReturnRows(tc.rows)
			if tc.wantCode == 0 {
				mock.ExpectQuery("FROM series_creators").
					WithArgs(sqlmock.AnyArg()).
					WillReturnRows(sqlmock.NewRows([]string{"series_id", "public_id", "name", "role", "display_order"}))
			}

			client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(&publiraadminv1.GetSeriesRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				PublicId: tc.publicID,
			})
			req.Header().Set("Authorization", "Bearer "+sessionToken)

			resp, err := client.GetSeries(context.Background(), req)
			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("GetSeries: %v", err)
				}
				if resp.Msg.Series == nil {
					t.Fatalf("series is nil")
				}
				if resp.Msg.Series.PublicId != tc.wantSeriesID {
					t.Fatalf("series public_id = %q, want %q", resp.Msg.Series.PublicId, tc.wantSeriesID)
				}
			} else {
				if connect.CodeOf(err) != tc.wantCode {
					t.Fatalf("GetSeries code = %v, want %v", connect.CodeOf(err), tc.wantCode)
				}
			}
			assertExpectations(t, mock)
		})
	}
}
