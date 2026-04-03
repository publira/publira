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

func TestListCreatorsSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := "session-token"

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id", "icon_image_updated_at", "icon_image_file_size_bytes", "icon_image_width", "icon_image_height"}).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, "CREATOR001", "Creator One", "profile", now, nil, nil, int64(0), int32(0), int32(0)))

	client := publiraadminv1connect.NewAdminCreatorServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ListCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	resp, err := client.ListCreators(context.Background(), req)
	if err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	if len(resp.Msg.Creators) != 1 {
		t.Fatalf("creators count = %d, want 1", len(resp.Msg.Creators))
	}
	if resp.Msg.Creators[0].PublicId != "CREATOR001" {
		t.Fatalf("creator public_id = %q, want CREATOR001", resp.Msg.Creators[0].PublicId)
	}
	assertExpectations(t, mock)
}

func TestCreateCreatorValidationAndSuccess(t *testing.T) {
	tests := []struct {
		name     string
		request  *publiraadminv1.CreateCreatorRequest
		setup    func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time)
		wantCode connect.Code
	}{
		{
			name: "invalid-name",
			request: &publiraadminv1.CreateCreatorRequest{
				Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				Name:   "   ",
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "success",
			request: &publiraadminv1.CreateCreatorRequest{
				Tenant:      &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				Name:        "Creator One",
				ProfileText: "profile",
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time) {
				mock.ExpectQuery("INSERT INTO creators").
					WithArgs(sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), "Creator One", sql.NullString{String: "profile", Valid: true}, uuid.NullUUID{}).
					WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id"}).
						AddRow(uuid.Must(uuid.NewV7()), tenantID, "CREATOR001", "Creator One", "profile", now, nil))
				mock.ExpectQuery("FROM creators").
					WithArgs(tenantID, "CREATOR001").
					WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id", "icon_image_updated_at", "icon_image_file_size_bytes", "icon_image_width", "icon_image_height"}).
						AddRow(uuid.Must(uuid.NewV7()), tenantID, "CREATOR001", "Creator One", "profile", now, nil, nil, int64(0), int32(0), int32(0)))
				expectAdminAuditLogInsert(mock)
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			sessionToken := "session-token"

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminCreatorServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(tc.request)
			req.Header().Set("X-Publira-Session-Id", sessionToken)

			resp, err := client.CreateCreator(context.Background(), req)
			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("CreateCreator: %v", err)
				}
				if resp.Msg.Creator == nil {
					t.Fatalf("creator is nil")
				}
				if resp.Msg.Creator.PublicId != "CREATOR001" {
					t.Fatalf("creator public_id = %q, want CREATOR001", resp.Msg.Creator.PublicId)
				}
			} else if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("CreateCreator code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestUpdateCreatorSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := "session-token"

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, "CREATOR001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id", "icon_image_updated_at", "icon_image_file_size_bytes", "icon_image_width", "icon_image_height"}).
			AddRow(creatorID, tenantID, "CREATOR001", "Before", "old", now, nil, nil, int64(0), int32(0), int32(0)))
	mock.ExpectExec("UPDATE creators").
		WithArgs(creatorID, "After", sql.NullString{String: "new", Valid: true}, uuid.NullUUID{}).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, "CREATOR001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id", "icon_image_updated_at", "icon_image_file_size_bytes", "icon_image_width", "icon_image_height"}).
			AddRow(creatorID, tenantID, "CREATOR001", "After", "new", now, nil, nil, int64(0), int32(0), int32(0)))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminCreatorServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateCreatorRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId:    "CREATOR001",
		Name:        "After",
		ProfileText: "new",
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	resp, err := client.UpdateCreator(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateCreator: %v", err)
	}
	if resp.Msg.Creator == nil {
		t.Fatalf("creator is nil")
	}
	if resp.Msg.Creator.Name != "After" {
		t.Fatalf("creator name = %q, want After", resp.Msg.Creator.Name)
	}
	assertExpectations(t, mock)
}

func TestListLabelsSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := "session-token"

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery("FROM labels").
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"}).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, "LABEL001", "Weekly", now, nil, nil))

	client := publiraadminv1connect.NewAdminLabelServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ListLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	resp, err := client.ListLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListLabels: %v", err)
	}
	if len(resp.Msg.Labels) != 1 {
		t.Fatalf("labels count = %d, want 1", len(resp.Msg.Labels))
	}
	if resp.Msg.Labels[0].PublicId != "LABEL001" {
		t.Fatalf("label public_id = %q, want LABEL001", resp.Msg.Labels[0].PublicId)
	}
	assertExpectations(t, mock)
}

func TestCreateLabelValidationAndSuccess(t *testing.T) {
	tests := []struct {
		name     string
		request  *publiraadminv1.CreateLabelRequest
		setup    func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time)
		wantCode connect.Code
	}{
		{
			name: "invalid-name",
			request: &publiraadminv1.CreateLabelRequest{
				Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				Name:   "   ",
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "success",
			request: &publiraadminv1.CreateLabelRequest{
				Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
				Name:   "Weekly",
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time) {
				mock.ExpectQuery("INSERT INTO labels").
					WithArgs(sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), "Weekly", uuid.NullUUID{}).
					WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id"}).
						AddRow(uuid.Must(uuid.NewV7()), tenantID, "LABEL001", "Weekly", now, nil))
				mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
					WithArgs(tenantID, "LABEL001").
					WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"}).
						AddRow(uuid.Must(uuid.NewV7()), tenantID, "LABEL001", "Weekly", now, nil, nil))
				expectAdminAuditLogInsert(mock)
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			sessionToken := "session-token"

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminLabelServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(tc.request)
			req.Header().Set("X-Publira-Session-Id", sessionToken)

			resp, err := client.CreateLabel(context.Background(), req)
			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("CreateLabel: %v", err)
				}
				if resp.Msg.Label == nil {
					t.Fatalf("label is nil")
				}
				if resp.Msg.Label.PublicId != "LABEL001" {
					t.Fatalf("label public_id = %q, want LABEL001", resp.Msg.Label.PublicId)
				}
			} else if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("CreateLabel code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestUpdateLabelSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := "session-token"

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
		WithArgs(tenantID, "LABEL001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"}).
			AddRow(labelID, tenantID, "LABEL001", "Before", now, nil, nil))
	mock.ExpectExec("UPDATE labels").
		WithArgs(labelID, "After", uuid.NullUUID{}).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
		WithArgs(tenantID, "LABEL001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"}).
			AddRow(labelID, tenantID, "LABEL001", "After", now, nil, nil))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminLabelServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateLabelRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId: "LABEL001",
		Name:     "After",
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	resp, err := client.UpdateLabel(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateLabel: %v", err)
	}
	if resp.Msg.Label == nil {
		t.Fatalf("label is nil")
	}
	if resp.Msg.Label.Name != "After" {
		t.Fatalf("label name = %q, want After", resp.Msg.Label.Name)
	}
	assertExpectations(t, mock)
}

func TestUpdateLabelRejectsClearAndImageTogether(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := "session-token"

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminLabelServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateLabelRequest{
		Tenant:                   &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		PublicId:                 "LABEL001",
		Name:                     "After",
		ClearEyeCatchImage:       true,
		EyeCatchImageData:        oneByOnePNG,
		EyeCatchImageContentType: "image/png",
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)

	_, err := client.UpdateLabel(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateLabel code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}
