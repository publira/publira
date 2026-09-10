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
	return []string{"tenant_id", "copyright_text", "site_description", "created_at", "updated_at", "site_tagline", "comment_mode", "comment_auto_hide_report_threshold", "episode_rating_mode"}
}

func tenantConfigRow(tenantID uuid.UUID, now time.Time, mode string, threshold int32) *sqlmock.Rows {
	return sqlmock.NewRows(tenantConfigColumns()).
		AddRow(tenantID, nil, nil, now, now, nil, mode, threshold, "single")
}

func expectTenantConfigWithCommentSettings(
	mock sqlmock.Sqlmock,
	tenantID uuid.UUID,
	now time.Time,
	mode string,
	threshold int32,
) {
	mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(tenantConfigRow(tenantID, now, mode, threshold))
}

func TestGetTenantCommentSettingsReturnsTheStoredValues(t *testing.T) {
	tests := []struct {
		name          string
		mode          string
		threshold     int32
		want          publirattypesv1.CommentMode
		wantThreshold uint32
	}{
		{name: "disabled", mode: "disabled", threshold: 3, want: publirattypesv1.CommentMode_COMMENT_MODE_DISABLED, wantThreshold: 3},
		{name: "immediate", mode: "immediate", threshold: 5, want: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE, wantThreshold: 5},
		{name: "approval required", mode: "approval_required", threshold: 1, want: publirattypesv1.CommentMode_COMMENT_MODE_APPROVAL_REQUIRED, wantThreshold: 1},
		{name: "automatic removal turned off", mode: "immediate", threshold: 0, want: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE, wantThreshold: 0},
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
			expectTenantConfigWithCommentSettings(mock, tenantID, now, tt.mode, tt.threshold)

			client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
			resp, err := client.GetTenantCommentSettings(context.Background(), newTenantSettingsRequest(&publiraadminv1.GetTenantCommentSettingsRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			}, sessionToken))
			if err != nil {
				t.Fatalf("GetTenantCommentSettings: %v", err)
			}
			if resp.Msg.CommentMode != tt.want {
				t.Fatalf("comment_mode = %v, want %v", resp.Msg.CommentMode, tt.want)
			}
			if resp.Msg.AutoHideReportThreshold != tt.wantThreshold {
				t.Fatalf("auto_hide_report_threshold = %d, want %d", resp.Msg.AutoHideReportThreshold, tt.wantThreshold)
			}
			assertExpectations(t, mock)
		})
	}
}

// A tenant with no config row has chosen nothing about commenting, which is the
// answer the columns' own defaults give too.
func TestGetTenantCommentSettingsReportsTheColumnDefaultsWithoutAConfigRow(t *testing.T) {
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
	resp, err := client.GetTenantCommentSettings(context.Background(), newTenantSettingsRequest(&publiraadminv1.GetTenantCommentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err != nil {
		t.Fatalf("GetTenantCommentSettings: %v", err)
	}
	if resp.Msg.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_DISABLED {
		t.Fatalf("comment_mode = %v, want COMMENT_MODE_DISABLED", resp.Msg.CommentMode)
	}
	if resp.Msg.AutoHideReportThreshold != defaultCommentAutoHideReportThreshold {
		t.Fatalf("auto_hide_report_threshold = %d, want %d", resp.Msg.AutoHideReportThreshold, defaultCommentAutoHideReportThreshold)
	}
	assertExpectations(t, mock)
}

// A stored mode this build cannot act on is reported rather than answered with a
// stand-in: the console would otherwise show a policy the posting path refuses.
func TestGetTenantCommentSettingsFailsOnAnUnsupportedStoredMode(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")
	expectTenantConfigWithCommentSettings(mock, tenantID, now, "members_only", 3)

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.GetTenantCommentSettings(context.Background(), newTenantSettingsRequest(&publiraadminv1.GetTenantCommentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err == nil {
		t.Fatal("GetTenantCommentSettings: expected error")
	}
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantCommentSettingsPersistsTheChosenValues(t *testing.T) {
	tests := []struct {
		name      string
		mode      publirattypesv1.CommentMode
		threshold uint32
		want      string
	}{
		{name: "disabled", mode: publirattypesv1.CommentMode_COMMENT_MODE_DISABLED, threshold: 3, want: "disabled"},
		{name: "immediate", mode: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE, threshold: 7, want: "immediate"},
		{name: "approval required", mode: publirattypesv1.CommentMode_COMMENT_MODE_APPROVAL_REQUIRED, threshold: 1, want: "approval_required"},
		{name: "automatic removal turned off", mode: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE, threshold: 0, want: "immediate"},
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
			mock.ExpectQuery(regexp.QuoteMeta(upsertTenantCommentSettingsQuery)).
				WithArgs(tenantID, tt.want, int32(tt.threshold)).
				WillReturnRows(tenantConfigRow(tenantID, now, tt.want, int32(tt.threshold)))

			client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
			resp, err := client.UpdateTenantCommentSettings(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantCommentSettingsRequest{
				AutoHideReportThreshold: tt.threshold,
				CommentMode:             tt.mode,
				Tenant:                  &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			}, sessionToken))
			if err != nil {
				t.Fatalf("UpdateTenantCommentSettings: %v", err)
			}
			if resp.Msg.CommentMode != tt.mode {
				t.Fatalf("comment_mode = %v, want %v", resp.Msg.CommentMode, tt.mode)
			}
			if resp.Msg.AutoHideReportThreshold != tt.threshold {
				t.Fatalf("auto_hide_report_threshold = %d, want %d", resp.Msg.AutoHideReportThreshold, tt.threshold)
			}
			assertExpectations(t, mock)
		})
	}
}

// A threshold above the ceiling is rejected rather than clamped: a tenant that
// mistyped one is told, instead of having a number they never chose saved as
// their policy.
func TestUpdateTenantCommentSettingsRejectsAThresholdAboveTheCeiling(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantCommentSettings(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantCommentSettingsRequest{
		AutoHideReportThreshold: maxCommentAutoHideReportThreshold + 1,
		CommentMode:             publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE,
		Tenant:                  &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err == nil {
		t.Fatal("UpdateTenantCommentSettings: expected error")
	}
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	// No write is expected: the stored value must survive a rejected request.
	assertExpectations(t, mock)
}

// An unset field names no mode. Turning commenting off is
// COMMENT_MODE_DISABLED, so reading the zero value as "off" would let a request
// that chose nothing overwrite a tenant's live setting.
func TestUpdateTenantCommentSettingsRejectsUnspecified(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantCommentSettings(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantCommentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err == nil {
		t.Fatal("UpdateTenantCommentSettings: expected error")
	}
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	// No write is expected: the stored value must survive a rejected request.
	assertExpectations(t, mock)
}

func TestUpdateTenantCommentSettingsRequiresTenantAdmin(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "editor")

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantCommentSettings(context.Background(), newTenantSettingsRequest(&publiraadminv1.UpdateTenantCommentSettingsRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		CommentMode: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE,
	}, sessionToken))
	if err == nil {
		t.Fatal("UpdateTenantCommentSettings: expected error")
	}
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantCommentSettingsRequiresSession(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT001", now)

	client := publiraadminv1connect.NewTenantSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantCommentSettings(context.Background(), connect.NewRequest(&publiraadminv1.UpdateTenantCommentSettingsRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		CommentMode: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE,
	}))
	if err == nil {
		t.Fatal("UpdateTenantCommentSettings: expected error")
	}
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	assertExpectations(t, mock)
}
