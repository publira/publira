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

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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

func tenantConfigColumns() []string {
	return []string{"tenant_id", "copyright_text", "site_description", "created_at", "updated_at", "site_tagline", "comment_mode"}
}

func expectTenantConfigWithCommentMode(
	mock sqlmock.Sqlmock,
	tenantID uuid.UUID,
	now time.Time,
	mode string,
) {
	mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantConfigColumns()).
			AddRow(tenantID, nil, nil, now, now, nil, mode))
}

func TestGetTenantCommentModeReturnsTheStoredMode(t *testing.T) {
	tests := []struct {
		name string
		mode string
		want publirattypesv1.CommentMode
	}{
		{name: "disabled", mode: "disabled", want: publirattypesv1.CommentMode_COMMENT_MODE_DISABLED},
		{name: "immediate", mode: "immediate", want: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE},
		{name: "approval required", mode: "approval_required", want: publirattypesv1.CommentMode_COMMENT_MODE_APPROVAL_REQUIRED},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ts, mock := newTestAdminServer(t)
			now := time.Now()
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
			expectTenantLookup(mock, tenantID, "TENANT001", now)
			expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")
			expectTenantConfigWithCommentMode(mock, tenantID, now, tt.mode)

			client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
			resp, err := client.GetTenantCommentMode(context.Background(), newTenantSettingsRequest(&publiraadminv1.GetTenantCommentModeRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			}, sessionToken))
			if err != nil {
				t.Fatalf("GetTenantCommentMode: %v", err)
			}
			if resp.Msg.CommentMode != tt.want {
				t.Fatalf("comment_mode = %v, want %v", resp.Msg.CommentMode, tt.want)
			}
			assertExpectations(t, mock)
		})
	}
}

// A tenant with no config row has chosen nothing about commenting, which is the
// answer the column's own default gives too.
func TestGetTenantCommentModeReportsDisabledWithoutAConfigRow(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")
	mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetTenantCommentMode(context.Background(), newTenantSettingsRequest(&publiraadminv1.GetTenantCommentModeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err != nil {
		t.Fatalf("GetTenantCommentMode: %v", err)
	}
	if resp.Msg.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_DISABLED {
		t.Fatalf("comment_mode = %v, want COMMENT_MODE_DISABLED", resp.Msg.CommentMode)
	}
	assertExpectations(t, mock)
}

// A stored mode this build cannot act on is reported rather than answered with a
// stand-in: the console would otherwise show a policy the posting path refuses.
func TestGetTenantCommentModeFailsOnAnUnsupportedStoredMode(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")
	expectTenantConfigWithCommentMode(mock, tenantID, now, "members_only")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.GetTenantCommentMode(context.Background(), newTenantSettingsRequest(&publiraadminv1.GetTenantCommentModeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err == nil {
		t.Fatal("GetTenantCommentMode: expected error")
	}
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantCommentModePersistsTheChosenMode(t *testing.T) {
	tests := []struct {
		name string
		mode publirattypesv1.CommentMode
		want string
	}{
		{name: "disabled", mode: publirattypesv1.CommentMode_COMMENT_MODE_DISABLED, want: "disabled"},
		{name: "immediate", mode: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE, want: "immediate"},
		{name: "approval required", mode: publirattypesv1.CommentMode_COMMENT_MODE_APPROVAL_REQUIRED, want: "approval_required"},
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
			mock.ExpectQuery(regexp.QuoteMeta(upsertTenantCommentModeQuery)).
				WithArgs(tenantID, tt.want).
				WillReturnRows(sqlmock.NewRows(tenantConfigColumns()).
					AddRow(tenantID, nil, nil, now, now, nil, tt.want))

			client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
			resp, err := client.UpdateTenantCommentMode(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantCommentModeRequest{
				Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				CommentMode: tt.mode,
			}, sessionToken))
			if err != nil {
				t.Fatalf("UpdateTenantCommentMode: %v", err)
			}
			if resp.Msg.CommentMode != tt.mode {
				t.Fatalf("comment_mode = %v, want %v", resp.Msg.CommentMode, tt.mode)
			}
			assertExpectations(t, mock)
		})
	}
}

// An unset field names no mode. Turning commenting off is
// COMMENT_MODE_DISABLED, so reading the zero value as "off" would let a request
// that chose nothing overwrite a tenant's live setting.
func TestUpdateTenantCommentModeRejectsUnspecified(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantCommentMode(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantCommentModeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err == nil {
		t.Fatal("UpdateTenantCommentMode: expected error")
	}
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	// No write is expected: the stored value must survive a rejected request.
	assertExpectations(t, mock)
}

func TestUpdateTenantCommentModeRequiresTenantAdmin(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantCommentMode(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantCommentModeRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		CommentMode: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE,
	}, sessionToken))
	if err == nil {
		t.Fatal("UpdateTenantCommentMode: expected error")
	}
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantCommentModeRequiresSession(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT001", now)

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantCommentMode(context.Background(), connect.NewRequest(&publiraadminv1.UpdateTenantCommentModeRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		CommentMode: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE,
	}))
	if err == nil {
		t.Fatal("UpdateTenantCommentMode: expected error")
	}
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	assertExpectations(t, mock)
}
