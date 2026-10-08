package adminapi

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func expectAdminTenantByDomains(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time, defaultLocale string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetAdminTenantByDomains)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Tenant", nil, now, "active", "admin.tenant.example.com", "UTC", defaultLocale))
}

// Host resolution is the only tenant read the console makes without a session,
// so it is the one that can tell the browser which language the tenant saved.
func TestAdminGetTenantByDomainReturnsDefaultLocale(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	expectAdminTenantByDomains(mock, tenantID, time.Now(), "en")

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.GetTenantByDomain(context.Background(), &publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{
		Domains: []string{"admin.tenant.example.com"},
	})
	if err != nil {
		t.Fatalf("GetTenantByDomain: %v", err)
	}
	if resp.TenantId != tenantID.String() {
		t.Fatalf("tenant_id = %q, want %s", resp.TenantId, tenantID)
	}
	if resp.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.DefaultLocale)
	}
	assertExpectations(t, mock)
}

// A stored code this build serves no catalog for ends the request. Answering
// the tenant id alone would leave the console publishing nothing and the
// document naming no language, which hides the data fault behind a screen that
// looks like it worked.
func TestAdminGetTenantByDomainFailsOnAnUnusableStoredLocale(t *testing.T) {
	tests := []struct {
		name   string
		stored string
	}{
		{name: "blank", stored: ""},
		{name: "unsupported code", stored: "fr"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ts, mock := newTestAdminServer(t)
			expectAdminTenantByDomains(mock, uuid.Must(uuid.NewV7()), time.Now(), tt.stored)

			client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
			_, err := client.GetTenantByDomain(context.Background(), &publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{
				Domains: []string{"admin.tenant.example.com"},
			})
			if connect.CodeOf(err) != connect.CodeInternal {
				t.Fatalf("GetTenantByDomain code = %v, want internal (err=%v)", connect.CodeOf(err), err)
			}
			assertExpectations(t, mock)
		})
	}
}

// The password reset form answers a registered address exactly as it answers an
// unknown one, so it records the request the worker resolves and never asks
// whether the address has an account: sqlmock refuses any lookup it was not
// told to expect, and a lookup is what would let the time the form takes tell
// the two apart.
func TestAdminRequestPasswordResetRecordsTheRequestWithoutLookingUpTheAddress(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT001", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
		WithArgs(
			sqlmock.AnyArg(),
			uuid.NullUUID{UUID: tenantID, Valid: true},
			outbox.EventTypeAdminPasswordResetRequest,
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "event_type", "payload", "idempotency_key",
			"status", "attempts", "available_at", "last_error", "created_at", "updated_at", "progress_cursor",
		}).AddRow(
			uuid.Must(uuid.NewV7()), uuid.NullUUID{UUID: tenantID, Valid: true}, outbox.EventTypeAdminPasswordResetRequest, []byte("{}"),
			"key", outbox.StatusPending, int32(0), time.Now(), nil, time.Now(), time.Now(), nil,
		))

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.RequestPasswordReset(context.Background(), &publiraadminv1.AdminAuthServiceRequestPasswordResetRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Email:  "admin@tenant.example",
	})
	if err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	if !resp.Requested {
		t.Fatal("requested = false, want true")
	}
	assertExpectations(t, mock)
}

func newUpdateTenantConfigRequest(tenantID uuid.UUID) *publiraadminv1.AdminAuthServiceUpdateTenantConfigRequest {
	req := &publiraadminv1.AdminAuthServiceUpdateTenantConfigRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		CopyrightText:   "© Tenant",
		SiteDescription: "A tenant that exists only in a test",
		SiteTagline:     "Read on",
	}
	return req
}

func tenantSiteCopyRow(tenantID uuid.UUID, now time.Time) *sqlmock.Rows {
	return sqlmock.NewRows(tenantConfigColumns()).
		AddRow(tenantID, "© Tenant", "A tenant that exists only in a test", now, now, "Read on", "disabled", int32(3), "single", "none", "all", nil, nil, nil, nil, nil, "{}", nil, nil, "external_checkout")
}

// The public site reads the site copy through the cached tenant site entry, so
// the save records that entry's drop in its own transaction.
func TestUpdateTenantConfigRecordsItsInvalidationBeforeCommitting(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpdateTenantConfig)).
		WithArgs(tenantID, "© Tenant", "A tenant that exists only in a test", "Read on").
		WillReturnRows(tenantSiteCopyRow(tenantID, now))
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.UpdateTenantConfig(testutil.WithBearer(context.Background(), sessionToken), newUpdateTenantConfigRequest(tenantID))
	if err != nil {
		t.Fatalf("UpdateTenantConfig: %v", err)
	}
	if resp.CopyrightText != "© Tenant" || resp.SiteTagline != "Read on" {
		t.Fatalf("tenant config = %+v, want the values just written", resp)
	}
	revalidations.waitForTags(t, []string{"tenant:" + tenantID.String() + ":site"})
	assertExpectations(t, mock)
}

// A tenant saving its site copy for the first time has no config row yet; the
// row the save creates owes the same drop as an update would.
func TestUpdateTenantConfigRecordsItsInvalidationWhenItCreatesTheRow(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpdateTenantConfig)).
		WithArgs(tenantID, "© Tenant", "A tenant that exists only in a test", "Read on").
		WillReturnRows(sqlmock.NewRows(tenantConfigColumns()))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateTenantConfig)).
		WithArgs(tenantID, "© Tenant", "A tenant that exists only in a test", "Read on").
		WillReturnRows(tenantSiteCopyRow(tenantID, now))
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	if _, err := client.UpdateTenantConfig(testutil.WithBearer(context.Background(), sessionToken), newUpdateTenantConfigRequest(tenantID)); err != nil {
		t.Fatalf("UpdateTenantConfig: %v", err)
	}
	revalidations.waitForTags(t, []string{"tenant:" + tenantID.String() + ":site"})
	assertExpectations(t, mock)
}

// A save whose cache drop cannot be recorded is rolled back rather than
// committed with nothing owing the drop.
func TestUpdateTenantConfigRollsBackWhenItsInvalidationCannotBeRecorded(t *testing.T) {
	newRevalidateRecorder(t)
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpdateTenantConfig)).
		WithArgs(tenantID, "© Tenant", "A tenant that exists only in a test", "Read on").
		WillReturnRows(tenantSiteCopyRow(tenantID, now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
		WillReturnError(sql.ErrConnDone)
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	_, err := client.UpdateTenantConfig(testutil.WithBearer(context.Background(), sessionToken), newUpdateTenantConfigRequest(tenantID))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("UpdateTenantConfig code = %v, want internal", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}
