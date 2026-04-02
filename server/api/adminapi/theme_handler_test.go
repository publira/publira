package adminapi

import (
	"context"
	"database/sql"
	"database/sql/driver"
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

func tenantThemeColumns() []string {
	return []string{
		"tenant_id",
		"primary_color",
		"secondary_color",
		"accent_color",
		"logo_url",
		"updated_at",
		"background_color",
		"foreground_color",
		"surface_color",
		"surface_foreground_color",
		"card_color",
		"card_foreground_color",
		"popover_color",
		"popover_foreground_color",
		"primary_foreground_color",
		"secondary_foreground_color",
		"accent_foreground_color",
		"muted_color",
		"muted_foreground_color",
		"border_color",
		"input_color",
		"ring_color",
		"success_color",
		"success_foreground_color",
		"warning_color",
		"warning_foreground_color",
		"destructive_color",
		"destructive_foreground_color",
		"info_color",
		"info_foreground_color",
	}
}

func tenantThemeSelectColumns() []string {
	return []string{
		"tenant_id",
		"background_color",
		"foreground_color",
		"surface_color",
		"surface_foreground_color",
		"card_color",
		"card_foreground_color",
		"popover_color",
		"popover_foreground_color",
		"primary_color",
		"primary_foreground_color",
		"secondary_color",
		"secondary_foreground_color",
		"accent_color",
		"accent_foreground_color",
		"muted_color",
		"muted_foreground_color",
		"border_color",
		"input_color",
		"ring_color",
		"success_color",
		"success_foreground_color",
		"warning_color",
		"warning_foreground_color",
		"destructive_color",
		"destructive_foreground_color",
		"info_color",
		"info_foreground_color",
		"logo_url",
		"updated_at",
	}
}

func tenantThemeUpsertRow(tenantID uuid.UUID, primaryColor, secondaryColor, accentColor string, logo sql.NullString, now time.Time) []driver.Value {
	return []driver.Value{
		tenantID,
		primaryColor,
		secondaryColor,
		accentColor,
		logo,
		now,
		"#f6f2e9",
		"#1e2b38",
		"#fbf8f2",
		"#1e2b38",
		"#fffdf8",
		"#1e2b38",
		"#fffdf8",
		"#1e2b38",
		"#f4fbfb",
		"#fff6f1",
		"#0f2a1f",
		"#e9e1d3",
		"#5c6773",
		"#d7ccba",
		"#e3d8c7",
		"#2d8d93",
		"#2f8f5b",
		"#f3fcf7",
		"#c4872a",
		"#fff8ea",
		"#b54444",
		"#fff4f4",
		"#3c78c2",
		"#f3f8ff",
	}
}

func tenantThemeSelectRow(tenantID uuid.UUID, primaryColor, secondaryColor, accentColor string, logo sql.NullString, now time.Time) []driver.Value {
	return []driver.Value{
		tenantID,
		"#f6f2e9",
		"#1e2b38",
		"#fbf8f2",
		"#1e2b38",
		"#fffdf8",
		"#1e2b38",
		"#fffdf8",
		"#1e2b38",
		primaryColor,
		"#f4fbfb",
		secondaryColor,
		"#fff6f1",
		accentColor,
		"#0f2a1f",
		"#e9e1d3",
		"#5c6773",
		"#d7ccba",
		"#e3d8c7",
		"#2d8d93",
		"#2f8f5b",
		"#f3fcf7",
		"#c4872a",
		"#fff8ea",
		"#b54444",
		"#fff4f4",
		"#3c78c2",
		"#f3f8ff",
		logo,
		now,
	}
}

func TestGetTenantThemeReturnsConfiguredTheme(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	logo := sql.NullString{String: "https://cdn.example.com/logo.png", Valid: true}
	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#123456", "#abcdef", "#654321", logo, now)...))

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT001"},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)
	resp, err := client.GetTenantTheme(context.Background(), req)
	if err != nil {
		t.Fatalf("GetTenantTheme: %v", err)
	}
	if resp.Msg.Theme.PrimaryColor != "#123456" {
		t.Fatalf("primary_color = %q, want #123456", resp.Msg.Theme.PrimaryColor)
	}
	if resp.Msg.Theme.SecondaryColor != "#abcdef" {
		t.Fatalf("secondary_color = %q, want #abcdef", resp.Msg.Theme.SecondaryColor)
	}
	if resp.Msg.Theme.AccentColor != "#654321" {
		t.Fatalf("accent_color = %q, want #654321", resp.Msg.Theme.AccentColor)
	}
	if resp.Msg.Theme.LogoUrl != "https://cdn.example.com/logo.png" {
		t.Fatalf("logo_url = %q, want https://cdn.example.com/logo.png", resp.Msg.Theme.LogoUrl)
	}
	assertExpectations(t, mock)
}

func TestGetTenantThemeReturnsDefaultsWhenUnset(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", sql.NullString{}, now)...))

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT001"},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)
	resp, err := client.GetTenantTheme(context.Background(), req)
	if err != nil {
		t.Fatalf("GetTenantTheme: %v", err)
	}
	if resp.Msg.Theme.PrimaryColor != "#0f7c82" {
		t.Fatalf("primary_color = %q, want #0f7c82", resp.Msg.Theme.PrimaryColor)
	}
	if resp.Msg.Theme.SecondaryColor != "#d96f4a" {
		t.Fatalf("secondary_color = %q, want #d96f4a", resp.Msg.Theme.SecondaryColor)
	}
	if resp.Msg.Theme.AccentColor != "#7aae90" {
		t.Fatalf("accent_color = %q, want #7aae90", resp.Msg.Theme.AccentColor)
	}
	if resp.Msg.Theme.LogoUrl != "" {
		t.Fatalf("logo_url = %q, want empty", resp.Msg.Theme.LogoUrl)
	}
	assertExpectations(t, mock)
}

func TestUpsertTenantThemeValidatesColorCode(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpsertTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT001"},
		Theme: &publirattypesv1.TenantTheme{
			PrimaryColor:   "invalid",
			SecondaryColor: "#112233",
			AccentColor:    "#445566",
		},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)
	_, err := client.UpsertTenantTheme(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpsertTenantTheme code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestUpsertTenantThemePersistsNormalizedTheme(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := "session-token"
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	logo := sql.NullString{String: "https://cdn.example.com/new-logo.png", Valid: true}
	mock.ExpectQuery(regexp.QuoteMeta(upsertTenantThemeQuery)).
		WithArgs(
			tenantID,
			"#f6f2e9",
			"#1e2b38",
			"#fbf8f2",
			"#1e2b38",
			"#fffdf8",
			"#1e2b38",
			"#fffdf8",
			"#1e2b38",
			"#0f7c82",
			"#f4fbfb",
			"#d96f4a",
			"#fff6f1",
			"#7aae90",
			"#0f2a1f",
			"#e9e1d3",
			"#5c6773",
			"#d7ccba",
			"#e3d8c7",
			"#2d8d93",
			"#2f8f5b",
			"#f3fcf7",
			"#c4872a",
			"#fff8ea",
			"#b54444",
			"#fff4f4",
			"#3c78c2",
			"#f3f8ff",
			logo,
		).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", logo, now)...))

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpsertTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT001"},
		Theme: &publirattypesv1.TenantTheme{
			PrimaryColor:   "  #0F7C82 ",
			SecondaryColor: "#D96F4A",
			AccentColor:    "#7AAE90",
			LogoUrl:        "https://cdn.example.com/new-logo.png",
		},
	})
	req.Header().Set("X-Publira-Session-Id", sessionToken)
	resp, err := client.UpsertTenantTheme(context.Background(), req)
	if err != nil {
		t.Fatalf("UpsertTenantTheme: %v", err)
	}
	if resp.Msg.Theme.PrimaryColor != "#0f7c82" {
		t.Fatalf("primary_color = %q, want #0f7c82", resp.Msg.Theme.PrimaryColor)
	}
	if resp.Msg.Theme.SecondaryColor != "#d96f4a" {
		t.Fatalf("secondary_color = %q, want #d96f4a", resp.Msg.Theme.SecondaryColor)
	}
	if resp.Msg.Theme.AccentColor != "#7aae90" {
		t.Fatalf("accent_color = %q, want #7aae90", resp.Msg.Theme.AccentColor)
	}
	if resp.Msg.Theme.LogoUrl != "https://cdn.example.com/new-logo.png" {
		t.Fatalf("logo_url = %q, want https://cdn.example.com/new-logo.png", resp.Msg.Theme.LogoUrl)
	}
	assertExpectations(t, mock)
}
