package adminapi

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func TestGetDashboardDatabaseErrorIsHidden(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CountPublishedSeriesForTenant)).
		WithArgs(tenantID).
		WillReturnError(errors.New(`pq: relation "series" does not exist`))

	client := publiraadminv1connect.NewAdminDashboardServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.GetDashboardRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}

	_, err := client.GetDashboard(testutil.WithBearer(context.Background(), sessionToken), req)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CountPublishedSeriesForTenant)).
		WithArgs(tenantID).
		WillReturnError(context.Canceled)

	client := publiraadminv1connect.NewAdminDashboardServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.GetDashboardRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}

	_, err := client.GetDashboard(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeCanceled {
		t.Fatalf("GetDashboard code = %v, want %v", connect.CodeOf(err), connect.CodeCanceled)
	}
	assertExpectations(t, mock)
}
