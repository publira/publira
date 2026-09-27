package adminapi

import (
	"context"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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

	client := publiraadminv1connect.NewAdminAuthServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetTenantByDomain(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{
		Domains: []string{"admin.tenant.example.com"},
	}))
	if err != nil {
		t.Fatalf("GetTenantByDomain: %v", err)
	}
	if resp.Msg.TenantId != tenantID.String() {
		t.Fatalf("tenant_id = %q, want %s", resp.Msg.TenantId, tenantID)
	}
	if resp.Msg.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.DefaultLocale)
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

			client := publiraadminv1connect.NewAdminAuthServiceClient(ts.Client(), ts.URL)
			_, err := client.GetTenantByDomain(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{
				Domains: []string{"admin.tenant.example.com"},
			}))
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

	client := publiraadminv1connect.NewAdminAuthServiceClient(ts.Client(), ts.URL)
	resp, err := client.RequestPasswordReset(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceRequestPasswordResetRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Email:  "admin@tenant.example",
	}))
	if err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("requested = false, want true")
	}
	assertExpectations(t, mock)
}
