package adminapi

import (
	"context"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/gen/publira/types/v1"
)

func newTenantSettingsRequest[T any](msg *T, sessionToken string) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func TestGetTenantTimezoneReturnsConfiguredValue(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookupWithTimezone(mock, tenantID, "TENANT001", now, "America/Los_Angeles")
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetTenantTimezone(context.Background(), newTenantSettingsRequest(&publiraadminv1.GetTenantTimezoneRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err != nil {
		t.Fatalf("GetTenantTimezone: %v", err)
	}
	if resp.Msg.Timezone != "America/Los_Angeles" {
		t.Fatalf("timezone = %q, want America/Los_Angeles", resp.Msg.Timezone)
	}
	assertExpectations(t, mock)
}

func TestGetTenantTimezoneFallsBackToDefault(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookupWithTimezone(mock, tenantID, "TENANT001", now, "")
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetTenantTimezone(context.Background(), newTenantSettingsRequest(&publiraadminv1.GetTenantTimezoneRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err != nil {
		t.Fatalf("GetTenantTimezone: %v", err)
	}
	if resp.Msg.Timezone != "Asia/Tokyo" {
		t.Fatalf("timezone = %q, want Asia/Tokyo", resp.Msg.Timezone)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantTimezonePersistsIANAName(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta(updateTenantTimezoneQuery)).
		WithArgs("Europe/Berlin", tenantID).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example", "Tenant", nil, now, "active", nil, "Europe/Berlin", "ja"))

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	resp, err := client.UpdateTenantTimezone(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantTimezoneRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Timezone: "  Europe/Berlin  ",
	}, sessionToken))
	if err != nil {
		t.Fatalf("UpdateTenantTimezone: %v", err)
	}
	if resp.Msg.Timezone != "Europe/Berlin" {
		t.Fatalf("timezone = %q, want Europe/Berlin", resp.Msg.Timezone)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantTimezoneRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name     string
		timezone string
	}{
		{name: "empty", timezone: ""},
		{name: "blank", timezone: "   "},
		{name: "unknown zone", timezone: "Mars/Olympus_Mons"},
		{name: "utc offset", timezone: "+09:00"},
		{name: "process local zone", timezone: "Local"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ts, mock := newTestAdminServer(t)
			now := time.Now()
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
			expectTenantLookup(mock, tenantID, "TENANT001", now)
			expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

			client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
			_, err := client.UpdateTenantTimezone(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantTimezoneRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Timezone: tt.timezone,
			}, sessionToken))
			if err == nil {
				t.Fatal("UpdateTenantTimezone: expected error")
			}
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
			}
			// No UPDATE is expected: the stored value must survive a rejected request.
			assertExpectations(t, mock)
		})
	}
}

func TestUpdateTenantTimezoneRequiresTenantAdmin(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantTimezone(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantTimezoneRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Timezone: "Europe/Berlin",
	}, sessionToken))
	if err == nil {
		t.Fatal("UpdateTenantTimezone: expected error")
	}
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantTimezoneRequiresSession(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT001", now)

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantTimezone(context.Background(), connect.NewRequest(&publiraadminv1.UpdateTenantTimezoneRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Timezone: "Europe/Berlin",
	}))
	if err == nil {
		t.Fatal("UpdateTenantTimezone: expected error")
	}
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	assertExpectations(t, mock)
}

func TestGetTenantDefaultLocaleReturnsConfiguredValue(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookupWithDefaultLocale(mock, tenantID, "TENANT001", now, "en")
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetTenantDefaultLocale(context.Background(), newTenantSettingsRequest(&publiraadminv1.GetTenantDefaultLocaleRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err != nil {
		t.Fatalf("GetTenantDefaultLocale: %v", err)
	}
	if resp.Msg.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.DefaultLocale)
	}
	assertExpectations(t, mock)
}

// tenants.default_locale is NOT NULL with a non-blank CHECK and every write
// path validates it, so a row this cannot resolve is a data fault. It is
// reported instead of being answered with the platform's language or any other
// stand-in — the console would offer to save that back over the stored value.
func TestGetTenantDefaultLocaleFailsOnAnUnusableStoredValue(t *testing.T) {
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
			now := time.Now()
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
			expectTenantLookupWithDefaultLocale(mock, tenantID, "TENANT001", now, tt.stored)
			expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")

			client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
			_, err := client.GetTenantDefaultLocale(context.Background(), newTenantSettingsRequest(&publiraadminv1.GetTenantDefaultLocaleRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			}, sessionToken))
			if connect.CodeOf(err) != connect.CodeInternal {
				t.Fatalf("GetTenantDefaultLocale code = %v, want internal (err=%v)", connect.CodeOf(err), err)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestUpdateTenantDefaultLocalePersistsSupportedCode(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta(updateTenantDefaultLocaleQuery)).
		WithArgs("en", tenantID).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example", "Tenant", nil, now, "active", nil, "Asia/Tokyo", "en"))

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	resp, err := client.UpdateTenantDefaultLocale(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantDefaultLocaleRequest{
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		DefaultLocale: "  en  ",
	}, sessionToken))
	if err != nil {
		t.Fatalf("UpdateTenantDefaultLocale: %v", err)
	}
	if resp.Msg.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.DefaultLocale)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantDefaultLocaleRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name   string
		locale string
	}{
		{name: "empty", locale: ""},
		{name: "blank", locale: "   "},
		{name: "unknown code", locale: "fr"},
		{name: "wrong case", locale: "EN"},
		{name: "bcp47 region", locale: "en-US"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ts, mock := newTestAdminServer(t)
			now := time.Now()
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
			expectTenantLookup(mock, tenantID, "TENANT001", now)
			expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

			client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
			_, err := client.UpdateTenantDefaultLocale(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantDefaultLocaleRequest{
				Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				DefaultLocale: tt.locale,
			}, sessionToken))
			if err == nil {
				t.Fatal("UpdateTenantDefaultLocale: expected error")
			}
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
			}
			// No UPDATE is expected: the stored value must survive a rejected request.
			assertExpectations(t, mock)
		})
	}
}

func TestUpdateTenantDefaultLocaleRequiresTenantAdmin(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantDefaultLocale(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantDefaultLocaleRequest{
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		DefaultLocale: "en",
	}, sessionToken))
	if err == nil {
		t.Fatal("UpdateTenantDefaultLocale: expected error")
	}
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantDefaultLocaleRequiresSession(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT001", now)

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantDefaultLocale(context.Background(), connect.NewRequest(&publiraadminv1.UpdateTenantDefaultLocaleRequest{
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		DefaultLocale: "en",
	}))
	if err == nil {
		t.Fatal("UpdateTenantDefaultLocale: expected error")
	}
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	assertExpectations(t, mock)
}
