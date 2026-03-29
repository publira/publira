package adminapi

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
)

func TestAdminSeriesRequiresSession(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListSeries(context.Background(), connect.NewRequest(&publiraadminv1.ListSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListSeries error code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	if err == nil || err.Error() != "unauthenticated: invalid session" {
		t.Fatalf("ListSeries error = %v, want unauthenticated invalid session", err)
	}
	assertExpectations(t, mock)
}

func TestAdminSeriesAllowsValidSession(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now()
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(listSeriesByTenantQuery)).
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "SERIES001", "Series Title", nil, nil, "Synopsis", nil, true, now))
	mock.ExpectQuery("FROM series_creators").
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "public_id", "name", "role", "display_order"}))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ListSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)
	resp, err := client.ListSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if len(resp.Msg.Series) != 1 {
		t.Fatalf("series count = %d, want 1", len(resp.Msg.Series))
	}
	if resp.Msg.Series[0].PublicId != "SERIES001" {
		t.Fatalf("series public_id = %q, want SERIES001", resp.Msg.Series[0].PublicId)
	}
	assertExpectations(t, mock)
}

func TestCreateSeriesRequiresTitle(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now()
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		Title:  "   ",
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

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
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
		WithArgs(tenantID, "LABEL001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, "LABEL001", "Weekly", now))

	mock.ExpectQuery("INSERT INTO series").
		WithArgs(sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), sqlmock.AnyArg(), "New Series").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "label_id", "public_id", "title", "created_at", "is_published", "published_at", "updated_at"}).
			AddRow(seriesID, tenantID, uuid.Must(uuid.NewV7()), "SERIESNEW001", "New Series", now, false, nil, now))

	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(seriesID, sql.NullString{String: "Synopsis", Valid: true}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "Synopsis", nil, nil, nil))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, true).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant:        &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		Title:         "New Series",
		Synopsis:      "Synopsis",
		LabelPublicId: "LABEL001",
		IsPublished:   true,
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

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

func TestUpdateSeriesRequiresTitle(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now()
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateSeriesRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId: "SERIES001",
		Title:    "\t",
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

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
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "SERIES001", "Before", nil, nil, "Old synopsis", nil, true, now))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesBaseQuery)).
		WithArgs(seriesID, "After", uuid.NullUUID{}).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(seriesID, sql.NullString{String: "New synopsis", Valid: true}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "New synopsis", nil, nil, nil))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, true).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM series_creators").
		WithArgs(seriesID).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "SERIES001", "After", nil, nil, "New synopsis", nil, true, now))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateSeriesRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId:    "SERIES001",
		Title:       "After",
		Synopsis:    "New synopsis",
		IsPublished: true,
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

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
	sessionToken := "session-token"

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery("INSERT INTO series").
		WithArgs(sqlmock.AnyArg(), tenantID, uuid.NullUUID{}, sqlmock.AnyArg(), "New Series").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "label_id", "public_id", "title", "created_at", "is_published", "published_at", "updated_at"}).
			AddRow(seriesID, tenantID, nil, "SERIESNEW001", "New Series", now, false, nil, now))

	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(seriesID, sql.NullString{String: "Synopsis", Valid: true}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "Synopsis", nil, nil, nil))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, true).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}).
			AddRow(creatorID1, tenantID, "CREATOR001", "Creator One", "", now).
			AddRow(creatorID2, tenantID, "CREATOR002", "Creator Two", "", now))

	mock.ExpectExec("INSERT INTO series_creators").
		WithArgs(seriesID, creatorID1, "creator", int32(0)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO series_creators").
		WithArgs(seriesID, creatorID2, "creator", int32(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateSeriesRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		Title:            "New Series",
		Synopsis:         "Synopsis",
		IsPublished:      true,
		CreatorPublicIds: []string{"CREATOR001", "CREATOR002"},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

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
	sessionToken := "session-token"

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "SERIES001", "Before", nil, nil, "Old synopsis", nil, true, now))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesBaseQuery)).
		WithArgs(seriesID, "After", uuid.NullUUID{}).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery("INSERT INTO series_listings").
		WithArgs(seriesID, sql.NullString{String: "New synopsis", Valid: true}, sql.NullInt32{}).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "New synopsis", nil, nil, nil))

	mock.ExpectExec(regexp.QuoteMeta(updateSeriesPublicationQuery)).
		WithArgs(seriesID, true).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectExec("DELETE FROM series_creators").
		WithArgs(seriesID).
		WillReturnResult(sqlmock.NewResult(0, 2))

	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}).
			AddRow(creatorID1, tenantID, "CREATOR001", "Creator One", "", now).
			AddRow(creatorID2, tenantID, "CREATOR002", "Creator Two", "", now))

	mock.ExpectExec("INSERT INTO series_creators").
		WithArgs(seriesID, creatorID1, "creator", int32(0)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO series_creators").
		WithArgs(seriesID, creatorID2, "creator", int32(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at"}).
			AddRow(seriesID, "SERIES001", "After", nil, nil, "New synopsis", nil, true, now))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateSeriesRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId:         "SERIES001",
		Title:            "After",
		Synopsis:         "New synopsis",
		IsPublished:      true,
		CreatorPublicIds: []string{"CREATOR001", "CREATOR002"},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

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
			rows: sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at"}).
				AddRow(uuid.Must(uuid.NewV7()), "SERIES001", "Series Title", nil, nil, "Synopsis", nil, true, time.Now()),
			wantSeriesID: "SERIES001",
		},
		{
			name:     "cross-tenant",
			publicID: "SERIES_OTHER_TENANT",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "not-found",
			publicID: "SERIES_MISSING",
			rows:     sqlmock.NewRows([]string{"id", "public_id", "title", "label_public_id", "label_name", "synopsis", "reading_period_hours", "is_published", "published_at"}),
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
			sessionToken := "session-token"

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
				Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				PublicId: tc.publicID,
			})
			req.Header().Set("X-Publira-Session-Id", sessionToken)

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
