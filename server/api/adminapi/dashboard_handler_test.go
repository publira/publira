package adminapi

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
)

const countPublishedSeriesForTenantQuery = "-- name: CountPublishedSeriesForTenant :one\n"

func TestGetDashboardDatabaseErrorIsHidden(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery(regexp.QuoteMeta(countPublishedSeriesForTenantQuery)).
		WithArgs(tenantID).
		WillReturnError(errors.New(`pq: relation "series" does not exist`))

	client := publiraadminv1connect.NewAdminDashboardServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetDashboardRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.GetDashboard(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetDashboard code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}

func TestGetDashboardPreservesContextCanceled(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery(regexp.QuoteMeta(countPublishedSeriesForTenantQuery)).
		WithArgs(tenantID).
		WillReturnError(context.Canceled)

	client := publiraadminv1connect.NewAdminDashboardServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetDashboardRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.GetDashboard(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeCanceled {
		t.Fatalf("GetDashboard code = %v, want %v", connect.CodeOf(err), connect.CodeCanceled)
	}
	assertExpectations(t, mock)
}
