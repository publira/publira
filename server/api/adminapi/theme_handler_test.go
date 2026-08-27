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
		"icon_image_id",
		"logo_image_id",
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
		"icon_image_id",
		"icon_image_updated_at",
		"logo_image_id",
		"logo_image_updated_at",
		"updated_at",
	}
}

func tenantThemeUpsertRow(tenantID uuid.UUID, primaryColor, secondaryColor, accentColor string, icon, logo uuid.NullUUID, now time.Time) []driver.Value {
	return []driver.Value{
		tenantID,
		primaryColor,
		secondaryColor,
		accentColor,
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
		icon,
		logo,
	}
}

func tenantThemeSelectRow(tenantID uuid.UUID, primaryColor, secondaryColor, accentColor string, icon, logo uuid.NullUUID, now time.Time) []driver.Value {
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
		icon,
		brandingImageUpdatedAt(icon, now),
		logo,
		brandingImageUpdatedAt(logo, now),
		now,
	}
}

// A branding image's updated_at comes from tenant_images, so it is set exactly
// when the theme points at an image.
func brandingImageUpdatedAt(imageID uuid.NullUUID, now time.Time) sql.NullTime {
	return sql.NullTime{Time: now, Valid: imageID.Valid}
}

// expectTenantImageVariants queues the variant read every theme response makes
// when the theme points at at least one branding image. Tenant images are
// stored as a single variant, so each image contributes one row.
func expectTenantImageVariants(mock sqlmock.Sqlmock, icon, logo uuid.NullUUID) {
	if !icon.Valid && !logo.Valid {
		return
	}
	rows := sqlmock.NewRows([]string{
		"tenant_image_id", "variant_type", "label", "content_type", "file_size_bytes", "width", "height",
	})
	if icon.Valid {
		rows.AddRow(icon.UUID, "icon", "original", "image/png", int64(1024), int32(64), int32(64))
	}
	if logo.Valid {
		rows.AddRow(logo.UUID, "logo", "original", "image/png", int64(2048), int32(320), int32(80))
	}
	mock.ExpectQuery(regexp.QuoteMeta(listTenantImageVariantsByImageIDsQuery)).
		WillReturnRows(rows)
}

// expectTenantThemeRead queues both statements a theme response is built from:
// the theme row, and the variants of the images it points at.
func expectTenantThemeRead(mock sqlmock.Sqlmock, tenantID uuid.UUID, icon, logo uuid.NullUUID, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", icon, logo, now)...))
	expectTenantImageVariants(mock, icon, logo)
}

// brandingImageURL is the served URL of the single variant a branding image is
// stored as, or "" when the slot is empty.
func brandingImageURL(variants []*publirattypesv1.TenantImageVariant) string {
	if len(variants) == 0 {
		return ""
	}
	return variants[0].Url
}

func TestGetTenantThemeReturnsConfiguredTheme(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	icon := uuid.NullUUID{UUID: uuid.MustParse("99999999-9999-4999-8999-999999999999"), Valid: true}
	logo := uuid.NullUUID{UUID: uuid.MustParse("88888888-8888-4888-8888-888888888888"), Valid: true}
	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#123456", "#abcdef", "#654321", icon, logo, now)...))
	expectTenantImageVariants(mock, icon, logo)

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
	if got := brandingImageURL(resp.Msg.Theme.IconImageVariants); got != "/images/tenants/99999999-9999-4999-8999-999999999999/icon" {
		t.Fatalf("icon variant url = %q, want /images/tenants/99999999-9999-4999-8999-999999999999", got)
	}
	if got := brandingImageURL(resp.Msg.Theme.LogoImageVariants); got != "/images/tenants/88888888-8888-4888-8888-888888888888/logo" {
		t.Fatalf("logo variant url = %q, want /images/tenants/88888888-8888-4888-8888-888888888888", got)
	}
	if resp.Msg.Theme.LogoImageUpdatedAt == "" {
		t.Fatal("logo_image_updated_at is empty, want the stored image's timestamp")
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
			AddRow(tenantThemeSelectRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", uuid.NullUUID{}, uuid.NullUUID{}, now)...))

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
	if len(resp.Msg.Theme.IconImageVariants) != 0 {
		t.Fatalf("icon variants = %d, want none", len(resp.Msg.Theme.IconImageVariants))
	}
	if len(resp.Msg.Theme.LogoImageVariants) != 0 {
		t.Fatalf("logo variants = %d, want none", len(resp.Msg.Theme.LogoImageVariants))
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

func TestThemeRevalidateTags(t *testing.T) {
	if tags := themeRevalidateTags(" tenant-id "); len(tags) != 1 || tags[0] != "tenant:tenant-id:theme" {
		t.Fatalf("themeRevalidateTags() = %v, want [tenant:tenant-id:theme]", tags)
	}
}

func TestThemeBrandingRevalidateTags(t *testing.T) {
	tags := themeBrandingRevalidateTags(" tenant-id ")
	if len(tags) != 2 || tags[0] != "tenant:tenant-id:theme" || tags[1] != "tenant:tenant-id:site" {
		t.Fatalf("themeBrandingRevalidateTags() = %v, want [tenant:tenant-id:theme tenant:tenant-id:site]", tags)
	}
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
		).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", uuid.NullUUID{}, uuid.NullUUID{}, now)...))
	expectTenantThemeRead(mock, tenantID, uuid.NullUUID{}, uuid.NullUUID{}, now)

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

func TestUploadTenantIconStoresImageAndPointsThemeAtIt(t *testing.T) {
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
			AddRow(tenantThemeSelectRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", uuid.NullUUID{UUID: previousImageID, Valid: true}, uuid.NullUUID{}, now)...))
	mock.ExpectQuery(regexp.QuoteMeta(createTenantImageQuery)).
		WithArgs(sqlmock.AnyArg(), tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "updated_at", "created_at"}).
			AddRow(storedImageID, tenantID, now, now))
	mock.ExpectQuery(regexp.QuoteMeta(createTenantImageVariantQuery)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "tenant_image_id", "label", "variant_type", "storage_provider",
			"object_key", "content_type", "file_size_bytes", "width", "height", "created_at",
		}).AddRow(
			uuid.Must(uuid.NewV7()), tenantID, storedImageID,
			"original", "icon", "s3", "tenants/TENANT001/icons/icon.png", "image/png",
			int64(1024), int32(64), int32(64), now,
		))
	mock.ExpectQuery(regexp.QuoteMeta(setTenantThemeIconImageQuery)).
		WithArgs(tenantID, uuid.NullUUID{UUID: storedImageID, Valid: true}).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", uuid.NullUUID{UUID: storedImageID, Valid: true}, uuid.NullUUID{}, now)...))
	mock.ExpectExec(regexp.QuoteMeta(deleteTenantImageQuery)).
		WithArgs(previousImageID, tenantID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectTenantThemeRead(mock, tenantID, uuid.NullUUID{UUID: storedImageID, Valid: true}, uuid.NullUUID{}, now)
	mock.ExpectCommit()

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UploadTenantIconRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		IconData:        testSquarePNG(t, 64),
		IconContentType: "image/png",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.UploadTenantIcon(context.Background(), req)
	if err != nil {
		t.Fatalf("UploadTenantIcon: %v", err)
	}
	want := "/images/tenants/" + storedImageID.String() + "/icon"
	if got := brandingImageURL(resp.Msg.Theme.IconImageVariants); got != want {
		t.Fatalf("icon variant url = %q, want %q", got, want)
	}
	assertExpectations(t, mock)
}

func TestUploadTenantIconRejectsUndersizedImage(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UploadTenantIconRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		IconData:        testSquarePNG(t, 16),
		IconContentType: "image/png",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	_, err := client.UploadTenantIcon(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UploadTenantIcon code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}

func TestDeleteTenantIconClearsReferenceAndDropsImage(t *testing.T) {
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
			AddRow(tenantThemeSelectRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", uuid.NullUUID{UUID: currentImageID, Valid: true}, uuid.NullUUID{}, now)...))
	mock.ExpectQuery(regexp.QuoteMeta(setTenantThemeIconImageQuery)).
		WithArgs(tenantID, uuid.NullUUID{}).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", uuid.NullUUID{}, uuid.NullUUID{}, now)...))
	mock.ExpectExec(regexp.QuoteMeta(deleteTenantImageQuery)).
		WithArgs(currentImageID, tenantID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectTenantThemeRead(mock, tenantID, uuid.NullUUID{}, uuid.NullUUID{}, now)
	mock.ExpectCommit()

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.DeleteTenantIconRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.DeleteTenantIcon(context.Background(), req)
	if err != nil {
		t.Fatalf("DeleteTenantIcon: %v", err)
	}
	if len(resp.Msg.Theme.IconImageVariants) != 0 {
		t.Fatalf("icon variants = %d, want none", len(resp.Msg.Theme.IconImageVariants))
	}
	assertExpectations(t, mock)
}

// testWideRectPNG builds a wordmark-shaped image: the logo path keeps the
// aspect ratio, so a non-square source is what distinguishes it from the
// icon path's center square crop.
func testWideRectPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 0x40, A: 0xff})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

func TestUploadTenantLogoStoresImageAndPointsThemeAtIt(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	previousImageID := uuid.MustParse("44444444-4444-4444-8444-444444444444")
	storedImageID := uuid.MustParse("55555555-5555-4555-8555-555555555555")
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
			AddRow(tenantThemeSelectRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", uuid.NullUUID{}, uuid.NullUUID{UUID: previousImageID, Valid: true}, now)...))
	mock.ExpectQuery(regexp.QuoteMeta(createTenantImageQuery)).
		WithArgs(sqlmock.AnyArg(), tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "updated_at", "created_at"}).
			AddRow(storedImageID, tenantID, now, now))
	mock.ExpectQuery(regexp.QuoteMeta(createTenantImageVariantQuery)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "tenant_image_id", "label", "variant_type", "storage_provider",
			"object_key", "content_type", "file_size_bytes", "width", "height", "created_at",
		}).AddRow(
			uuid.Must(uuid.NewV7()), tenantID, storedImageID,
			"original", "logo", "s3", "tenants/TENANT001/logos/logo.png", "image/png",
			int64(2048), int32(320), int32(80), now,
		))
	mock.ExpectQuery(regexp.QuoteMeta(setTenantThemeLogoImageQuery)).
		WithArgs(tenantID, uuid.NullUUID{UUID: storedImageID, Valid: true}).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", uuid.NullUUID{}, uuid.NullUUID{UUID: storedImageID, Valid: true}, now)...))
	mock.ExpectExec(regexp.QuoteMeta(deleteTenantImageQuery)).
		WithArgs(previousImageID, tenantID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectTenantThemeRead(mock, tenantID, uuid.NullUUID{}, uuid.NullUUID{UUID: storedImageID, Valid: true}, now)
	mock.ExpectCommit()

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UploadTenantLogoRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		LogoData:        testWideRectPNG(t, 320, 80),
		LogoContentType: "image/png",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.UploadTenantLogo(context.Background(), req)
	if err != nil {
		t.Fatalf("UploadTenantLogo: %v", err)
	}
	want := "/images/tenants/" + storedImageID.String() + "/logo"
	if got := brandingImageURL(resp.Msg.Theme.LogoImageVariants); got != want {
		t.Fatalf("logo variant url = %q, want %q", got, want)
	}
	assertExpectations(t, mock)
}

func TestUploadTenantLogoRejectsUndersizedImage(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UploadTenantLogoRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		LogoData:        testWideRectPNG(t, 320, 16),
		LogoContentType: "image/png",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	_, err := client.UploadTenantLogo(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UploadTenantLogo code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}

func TestDeleteTenantLogoClearsReferenceAndDropsImage(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	currentImageID := uuid.MustParse("66666666-6666-4666-8666-666666666666")
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
			AddRow(tenantThemeSelectRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", uuid.NullUUID{}, uuid.NullUUID{UUID: currentImageID, Valid: true}, now)...))
	mock.ExpectQuery(regexp.QuoteMeta(setTenantThemeLogoImageQuery)).
		WithArgs(tenantID, uuid.NullUUID{}).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#0f7c82", "#d96f4a", "#7aae90", uuid.NullUUID{}, uuid.NullUUID{}, now)...))
	mock.ExpectExec(regexp.QuoteMeta(deleteTenantImageQuery)).
		WithArgs(currentImageID, tenantID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectTenantThemeRead(mock, tenantID, uuid.NullUUID{}, uuid.NullUUID{}, now)
	mock.ExpectCommit()

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.DeleteTenantLogoRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.DeleteTenantLogo(context.Background(), req)
	if err != nil {
		t.Fatalf("DeleteTenantLogo: %v", err)
	}
	if len(resp.Msg.Theme.LogoImageVariants) != 0 {
		t.Fatalf("logo variants = %d, want none", len(resp.Msg.Theme.LogoImageVariants))
	}
	assertExpectations(t, mock)
}
