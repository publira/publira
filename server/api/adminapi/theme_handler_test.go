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
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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
		"#f5f5f2",
		"#1f1d1a",
		"#fafaf8",
		"#1f1d1a",
		"#ffffff",
		"#1f1d1a",
		"#ffffff",
		"#1f1d1a",
		"#ffffff",
		"#ffffff",
		"#22407a",
		"#e8e8e3",
		"#5f5e59",
		"#d6d6d0",
		"#cfcfc8",
		"#2b4c8c",
		"#2a6b3f",
		"#ffffff",
		"#8a5a0b",
		"#ffffff",
		"#8f1d1d",
		"#ffffff",
		"#2f5d8a",
		"#ffffff",
		icon,
		logo,
	}
}

func tenantThemeSelectRow(tenantID uuid.UUID, primaryColor, secondaryColor, accentColor string, icon, logo uuid.NullUUID, now time.Time) []driver.Value {
	return []driver.Value{
		tenantID,
		"#f5f5f2",
		"#1f1d1a",
		"#fafaf8",
		"#1f1d1a",
		"#ffffff",
		"#1f1d1a",
		"#ffffff",
		"#1f1d1a",
		primaryColor,
		"#ffffff",
		secondaryColor,
		"#ffffff",
		accentColor,
		"#22407a",
		"#e8e8e3",
		"#5f5e59",
		"#d6d6d0",
		"#cfcfc8",
		"#2b4c8c",
		"#2a6b3f",
		"#ffffff",
		"#8a5a0b",
		"#ffffff",
		"#8f1d1d",
		"#ffffff",
		"#2f5d8a",
		"#ffffff",
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
			AddRow(tenantThemeSelectRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", icon, logo, now)...))
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
			AddRow(tenantThemeSelectRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", uuid.NullUUID{}, uuid.NullUUID{}, now)...))

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.GetTenantTheme(context.Background(), req)
	if err != nil {
		t.Fatalf("GetTenantTheme: %v", err)
	}
	if resp.Msg.Theme.PrimaryColor != "#2b4c8c" {
		t.Fatalf("primary_color = %q, want #2b4c8c", resp.Msg.Theme.PrimaryColor)
	}
	if resp.Msg.Theme.SecondaryColor != "#c63d17" {
		t.Fatalf("secondary_color = %q, want #c63d17", resp.Msg.Theme.SecondaryColor)
	}
	if resp.Msg.Theme.AccentColor != "#e3e9f5" {
		t.Fatalf("accent_color = %q, want #e3e9f5", resp.Msg.Theme.AccentColor)
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

func TestNormalizeTenantThemeRejectsInsufficientContrast(t *testing.T) {
	theme := &publirattypesv1.TenantTheme{
		PrimaryColor:               "#2b4c8c",
		SecondaryColor:             "#c63d17",
		AccentColor:                "#e3e9f5",
		BackgroundColor:            "#f5f5f2",
		ForegroundColor:            "#1f1d1a",
		SurfaceColor:               "#fafaf8",
		SurfaceForegroundColor:     "#1f1d1a",
		CardColor:                  "#ffffff",
		CardForegroundColor:        "#1f1d1a",
		PopoverColor:               "#ffffff",
		PopoverForegroundColor:     "#1f1d1a",
		PrimaryForegroundColor:     "#2b4c8c",
		SecondaryForegroundColor:   "#ffffff",
		AccentForegroundColor:      "#22407a",
		MutedColor:                 "#e8e8e3",
		MutedForegroundColor:       "#5f5e59",
		BorderColor:                "#d6d6d0",
		InputColor:                 "#cfcfc8",
		RingColor:                  "#2b4c8c",
		SuccessColor:               "#2a6b3f",
		SuccessForegroundColor:     "#ffffff",
		WarningColor:               "#8a5a0b",
		WarningForegroundColor:     "#ffffff",
		DestructiveColor:           "#8f1d1d",
		DestructiveForegroundColor: "#ffffff",
		InfoColor:                  "#2f5d8a",
		InfoForegroundColor:        "#ffffff",
	}

	_, err := normalizeTenantTheme(theme)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("normalizeTenantTheme code = %v, want invalid_argument", connect.CodeOf(err))
	}
	if !strings.Contains(err.Error(), "theme.primary_color and theme.primary_foreground_color") {
		t.Fatalf("normalizeTenantTheme error = %q, want named contrast pair", err)
	}
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
			"#f5f5f2",
			"#1f1d1a",
			"#fafaf8",
			"#1f1d1a",
			"#ffffff",
			"#1f1d1a",
			"#ffffff",
			"#1f1d1a",
			"#2b4c8c",
			"#ffffff",
			"#c63d17",
			"#ffffff",
			"#e3e9f5",
			"#22407a",
			"#e8e8e3",
			"#5f5e59",
			"#d6d6d0",
			"#cfcfc8",
			"#2b4c8c",
			"#2a6b3f",
			"#ffffff",
			"#8a5a0b",
			"#ffffff",
			"#8f1d1d",
			"#ffffff",
			"#2f5d8a",
			"#ffffff",
		).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", uuid.NullUUID{}, uuid.NullUUID{}, now)...))
	expectTenantThemeRead(mock, tenantID, uuid.NullUUID{}, uuid.NullUUID{}, now)

	client := publiraadminv1connect.NewTenantThemeServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpsertTenantThemeRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Theme: &publirattypesv1.TenantTheme{
			PrimaryColor:               "  #2B4C8C ",
			SecondaryColor:             "#C63D17",
			AccentColor:                "#E3E9F5",
			BackgroundColor:            "#F5F5F2",
			ForegroundColor:            "#1F1D1A",
			SurfaceColor:               "#FAFAF8",
			SurfaceForegroundColor:     "#1F1D1A",
			CardColor:                  "#FFFFFF",
			CardForegroundColor:        "#1F1D1A",
			PopoverColor:               "#FFFFFF",
			PopoverForegroundColor:     "#1F1D1A",
			PrimaryForegroundColor:     "#FFFFFF",
			SecondaryForegroundColor:   "#FFFFFF",
			AccentForegroundColor:      "#22407A",
			MutedColor:                 "#E8E8E3",
			MutedForegroundColor:       "#5F5E59",
			BorderColor:                "#D6D6D0",
			InputColor:                 "#CFCFC8",
			RingColor:                  "#2B4C8C",
			SuccessColor:               "#2A6B3F",
			SuccessForegroundColor:     "#FFFFFF",
			WarningColor:               "#8A5A0B",
			WarningForegroundColor:     "#FFFFFF",
			DestructiveColor:           "#8F1D1D",
			DestructiveForegroundColor: "#FFFFFF",
			InfoColor:                  "#2F5D8A",
			InfoForegroundColor:        "#FFFFFF",
		},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.UpsertTenantTheme(context.Background(), req)
	if err != nil {
		t.Fatalf("UpsertTenantTheme: %v", err)
	}
	if resp.Msg.Theme.PrimaryColor != "#2b4c8c" {
		t.Fatalf("primary_color = %q, want #2b4c8c", resp.Msg.Theme.PrimaryColor)
	}
	if resp.Msg.Theme.SecondaryColor != "#c63d17" {
		t.Fatalf("secondary_color = %q, want #c63d17", resp.Msg.Theme.SecondaryColor)
	}
	if resp.Msg.Theme.AccentColor != "#e3e9f5" {
		t.Fatalf("accent_color = %q, want #e3e9f5", resp.Msg.Theme.AccentColor)
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
			AddRow(tenantThemeSelectRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", uuid.NullUUID{UUID: previousImageID, Valid: true}, uuid.NullUUID{}, now)...))
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
			AddRow(tenantThemeUpsertRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", uuid.NullUUID{UUID: storedImageID, Valid: true}, uuid.NullUUID{}, now)...))
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
			AddRow(tenantThemeSelectRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", uuid.NullUUID{UUID: currentImageID, Valid: true}, uuid.NullUUID{}, now)...))
	mock.ExpectQuery(regexp.QuoteMeta(setTenantThemeIconImageQuery)).
		WithArgs(tenantID, uuid.NullUUID{}).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", uuid.NullUUID{}, uuid.NullUUID{}, now)...))
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
			AddRow(tenantThemeSelectRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", uuid.NullUUID{}, uuid.NullUUID{UUID: previousImageID, Valid: true}, now)...))
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
			AddRow(tenantThemeUpsertRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", uuid.NullUUID{}, uuid.NullUUID{UUID: storedImageID, Valid: true}, now)...))
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
			AddRow(tenantThemeSelectRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", uuid.NullUUID{}, uuid.NullUUID{UUID: currentImageID, Valid: true}, now)...))
	mock.ExpectQuery(regexp.QuoteMeta(setTenantThemeLogoImageQuery)).
		WithArgs(tenantID, uuid.NullUUID{}).
		WillReturnRows(sqlmock.NewRows(tenantThemeColumns()).
			AddRow(tenantThemeUpsertRow(tenantID, "#2b4c8c", "#c63d17", "#e3e9f5", uuid.NullUUID{}, uuid.NullUUID{}, now)...))
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
