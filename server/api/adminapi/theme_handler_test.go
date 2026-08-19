package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"image"
	"image/color"
	"image/png"
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
		"favicon_image_id",
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
		"favicon_image_id",
		"updated_at",
	}
}

func tenantThemeUpsertRow(tenantID uuid.UUID, primaryColor, secondaryColor, accentColor string, logo sql.NullString, favicon uuid.NullUUID, now time.Time) []driver.Value {
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
		favicon,
	}
}

func tenantThemeSelectRow(tenantID uuid.UUID, primaryColor, secondaryColor, accentColor string, logo sql.NullString, favicon uuid.NullUUID, now time.Time) []driver.Value {
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
		favicon,
		now,
	}
}

func TestGetTenantThemeReturnsConfiguredTheme(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	logo := sql.NullString{String: "https://cdn.example.com/logo.png", Valid: true}
	favicon := uuid.NullUUID{UUID: uuid.MustParse("99999999-9999-4999-8999-999999999999"), Valid: true}
	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#123456", "#abcdef", "#654321", logo, favicon, now)...))

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
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
	if resp.Msg.Theme.FaviconUrl != "/images/tenants/99999999-9999-4999-8999-999999999999" {
		t.Fatalf("favicon_url = %q, want /images/tenants/99999999-9999-4999-8999-999999999999", resp.Msg.Theme.FaviconUrl)
	}
	assertExpectations(t, mock)
}

func TestGetTenantThemeReturnsDefaultsWhenUnset(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", sql.NullString{}, uuid.NullUUID{}, now)...))

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
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
	if resp.Msg.Theme.FaviconUrl != "" {
		t.Fatalf("favicon_url = %q, want empty", resp.Msg.Theme.FaviconUrl)
	}
	assertExpectations(t, mock)
}

func TestGetTenantThemeDatabaseErrorIsHidden(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(errors.New(`pq: relation "tenant_themes" does not exist`))

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	_, err := client.GetTenantTheme(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetTenantTheme code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}

func TestUpsertTenantThemeValidatesColorCode(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpsertTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Theme: &publirattypesv1.TenantTheme{
			PrimaryColor:   "invalid",
			SecondaryColor: "#112233",
			AccentColor:    "#445566",
		},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
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
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
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
			AddRow(tenantThemeUpsertRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", logo, uuid.NullUUID{}, now)...))

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpsertTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Theme: &publirattypesv1.TenantTheme{
			PrimaryColor:               "  #0F7C82 ",
			SecondaryColor:             "#D96F4A",
			AccentColor:                "#7AAE90",
			BackgroundColor:            "#F6F2E9",
			ForegroundColor:            "#1E2B38",
			SurfaceColor:               "#FBF8F2",
			SurfaceForegroundColor:     "#1E2B38",
			CardColor:                  "#FFFDF8",
			CardForegroundColor:        "#1E2B38",
			PopoverColor:               "#FFFDF8",
			PopoverForegroundColor:     "#1E2B38",
			PrimaryForegroundColor:     "#F4FBFB",
			SecondaryForegroundColor:   "#FFF6F1",
			AccentForegroundColor:      "#0F2A1F",
			MutedColor:                 "#E9E1D3",
			MutedForegroundColor:       "#5C6773",
			BorderColor:                "#D7CCBA",
			InputColor:                 "#E3D8C7",
			RingColor:                  "#2D8D93",
			SuccessColor:               "#2F8F5B",
			SuccessForegroundColor:     "#F3FCF7",
			WarningColor:               "#C4872A",
			WarningForegroundColor:     "#FFF8EA",
			DestructiveColor:           "#B54444",
			DestructiveForegroundColor: "#FFF4F4",
			InfoColor:                  "#3C78C2",
			InfoForegroundColor:        "#F3F8FF",
			LogoUrl:                    "https://cdn.example.com/new-logo.png",
		},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
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

func testSquarePNG(t *testing.T, size int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 0x40, A: 0xff})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

func TestUploadTenantFaviconStoresImageAndPointsThemeAtIt(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	previousImageID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	storedImageID := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(lockTenantForUpdateQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(tenantID))
	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", sql.NullString{}, uuid.NullUUID{UUID: previousImageID, Valid: true}, now)...))
	mock.ExpectQuery(regexp.QuoteMeta(createTenantImageQuery)).
		WithArgs(sqlmock.AnyArg(), tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "updated_at", "created_at"}).
			AddRow(storedImageID, tenantID, now, now))
	mock.ExpectQuery(regexp.QuoteMeta(createTenantImageVariantQuery)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "tenant_image_id", "label", "storage_provider",
			"object_key", "content_type", "file_size_bytes", "width", "height", "created_at",
		}).AddRow(
			uuid.Must(uuid.NewV7()), tenantID, storedImageID,
			"original", "s3", "tenants/TENANT001/favicons/favicon.png", "image/png",
			int64(1024), int32(64), int32(64), now,
		))
	mock.ExpectQuery(regexp.QuoteMeta(setTenantThemeFaviconImageQuery)).
		WithArgs(tenantID, uuid.NullUUID{UUID: storedImageID, Valid: true}).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", sql.NullString{}, uuid.NullUUID{UUID: storedImageID, Valid: true}, now)...))
	mock.ExpectExec(regexp.QuoteMeta(deleteTenantImageQuery)).
		WithArgs(previousImageID, tenantID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UploadTenantFaviconRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		FaviconData:        testSquarePNG(t, 64),
		FaviconContentType: "image/png",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.UploadTenantFavicon(context.Background(), req)
	if err != nil {
		t.Fatalf("UploadTenantFavicon: %v", err)
	}
	want := "/images/tenants/" + storedImageID.String()
	if resp.Msg.Theme.FaviconUrl != want {
		t.Fatalf("favicon_url = %q, want %q", resp.Msg.Theme.FaviconUrl, want)
	}
	assertExpectations(t, mock)
}

func TestUploadTenantFaviconRejectsUndersizedImage(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UploadTenantFaviconRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		FaviconData:        testSquarePNG(t, 16),
		FaviconContentType: "image/png",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	_, err := client.UploadTenantFavicon(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UploadTenantFavicon code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}

func TestDeleteTenantFaviconClearsReferenceAndDropsImage(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	currentImageID := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(lockTenantForUpdateQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(tenantID))
	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", sql.NullString{}, uuid.NullUUID{UUID: currentImageID, Valid: true}, now)...))
	mock.ExpectQuery(regexp.QuoteMeta(setTenantThemeFaviconImageQuery)).
		WithArgs(tenantID, uuid.NullUUID{}).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", sql.NullString{}, uuid.NullUUID{}, now)...))
	mock.ExpectExec(regexp.QuoteMeta(deleteTenantImageQuery)).
		WithArgs(currentImageID, tenantID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.DeleteTenantFaviconRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.DeleteTenantFavicon(context.Background(), req)
	if err != nil {
		t.Fatalf("DeleteTenantFavicon: %v", err)
	}
	if resp.Msg.Theme.FaviconUrl != "" {
		t.Fatalf("favicon_url = %q, want empty", resp.Msg.Theme.FaviconUrl)
	}
	assertExpectations(t, mock)
}
