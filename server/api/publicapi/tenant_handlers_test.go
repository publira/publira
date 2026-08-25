package publicapi

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
	"github.com/lib/pq"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/paymentsettings"
)

const (
	getTenantConfigByTenantIDQuery         = "-- name: GetTenantConfigByTenantID :one\nSELECT tenant_id, copyright_text, site_description, created_at, updated_at, site_tagline\nFROM tenant_config\nWHERE tenant_id = $1\nLIMIT 1\n"
	getTenantThemeByTenantIDQuery          = "-- name: GetTenantThemeByTenantID :one\nSELECT\n    t.id AS tenant_id,\n    COALESCE(tt.background_color, '#f6f2e9') AS background_color,\n    COALESCE(tt.foreground_color, '#1e2b38') AS foreground_color,\n    COALESCE(tt.surface_color, '#fbf8f2') AS surface_color,\n    COALESCE(tt.surface_foreground_color, '#1e2b38') AS surface_foreground_color,\n    COALESCE(tt.card_color, '#fffdf8') AS card_color,\n    COALESCE(tt.card_foreground_color, '#1e2b38') AS card_foreground_color,\n    COALESCE(tt.popover_color, '#fffdf8') AS popover_color,\n    COALESCE(tt.popover_foreground_color, '#1e2b38') AS popover_foreground_color,\n    COALESCE(tt.primary_color, '#0f7c82') AS primary_color,\n    COALESCE(tt.primary_foreground_color, '#f4fbfb') AS primary_foreground_color,\n    COALESCE(tt.secondary_color, '#d96f4a') AS secondary_color,\n    COALESCE(tt.secondary_foreground_color, '#fff6f1') AS secondary_foreground_color,\n    COALESCE(tt.accent_color, '#7aae90') AS accent_color,\n    COALESCE(tt.accent_foreground_color, '#0f2a1f') AS accent_foreground_color,\n    COALESCE(tt.muted_color, '#e9e1d3') AS muted_color,\n    COALESCE(tt.muted_foreground_color, '#5c6773') AS muted_foreground_color,\n    COALESCE(tt.border_color, '#d7ccba') AS border_color,\n    COALESCE(tt.input_color, '#e3d8c7') AS input_color,\n    COALESCE(tt.ring_color, '#2d8d93') AS ring_color,\n    COALESCE(tt.success_color, '#2f8f5b') AS success_color,\n    COALESCE(tt.success_foreground_color, '#f3fcf7') AS success_foreground_color,\n    COALESCE(tt.warning_color, '#c4872a') AS warning_color,\n    COALESCE(tt.warning_foreground_color, '#fff8ea') AS warning_foreground_color,\n    COALESCE(tt.destructive_color, '#b54444') AS destructive_color,\n    COALESCE(tt.destructive_foreground_color, '#fff4f4') AS destructive_foreground_color,\n    COALESCE(tt.info_color, '#3c78c2') AS info_color,\n    COALESCE(tt.info_foreground_color, '#f3f8ff') AS info_foreground_color,\n    tt.icon_image_id,\n    fi.updated_at AS icon_image_updated_at,\n    tt.logo_image_id,\n    li.updated_at AS logo_image_updated_at,\n    COALESCE(tt.updated_at, NOW()) AS updated_at\nFROM tenants t\nLEFT JOIN tenant_themes tt ON tt.tenant_id = t.id\nLEFT JOIN tenant_images fi ON fi.id = tt.icon_image_id\nLEFT JOIN tenant_images li ON li.id = tt.logo_image_id\nWHERE t.id = $1\n"
	listTenantImageVariantsByImageIDsQuery = "-- name: ListTenantImageVariantsByImageIDs :many\nSELECT tenant_image_id,\n    variant_type,\n    label,\n    content_type,\n    file_size_bytes,\n    width,\n    height\nFROM tenant_image_variants\nWHERE tenant_image_id = ANY($1::uuid [])\nORDER BY tenant_image_id,\n    variant_type\n"
)

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

func tenantThemeSelectRow(tenantID uuid.UUID, primaryColor string, now time.Time) []driver.Value {
	return tenantThemeSelectRowWithBrandingImages(tenantID, primaryColor, now, uuid.NullUUID{}, uuid.NullUUID{})
}

func tenantThemeSelectRowWithBrandingImages(
	tenantID uuid.UUID,
	primaryColor string,
	now time.Time,
	iconImageID uuid.NullUUID,
	logoImageID uuid.NullUUID,
) []driver.Value {
	iconUpdatedAt := sql.NullTime{}
	if iconImageID.Valid {
		iconUpdatedAt = sql.NullTime{Time: now, Valid: true}
	}
	logoUpdatedAt := sql.NullTime{}
	if logoImageID.Valid {
		logoUpdatedAt = sql.NullTime{Time: now, Valid: true}
	}
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
		iconImageID,
		iconUpdatedAt,
		logoImageID,
		logoUpdatedAt,
		now,
	}
}

func expectPaymentsUnavailable(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(getEnabledTenantPaymentConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
}

func TestGetTenantIncludesTheme(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT001", now)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_id", "copyright_text", "site_description", "created_at", "updated_at", "site_tagline",
		}).AddRow(
			tenantID,
			sql.NullString{String: "© Publira", Valid: true},
			sql.NullString{String: "Site description", Valid: true},
			now,
			now,
			sql.NullString{String: "Tagline", Valid: true},
		))
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))

	client := publirav1connect.NewTenantServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.TenantPublicId != "TENANT001" {
		t.Fatalf("tenant_public_id = %q, want TENANT001", resp.Msg.TenantPublicId)
	}
	if resp.Msg.CopyrightText != "© Publira" {
		t.Fatalf("copyright_text = %q, want © Publira", resp.Msg.CopyrightText)
	}
	if resp.Msg.Theme == nil {
		t.Fatal("theme is nil, want populated theme")
	}
	if resp.Msg.Theme.PrimaryColor != "#112233" {
		t.Fatalf("theme.primary_color = %q, want #112233", resp.Msg.Theme.PrimaryColor)
	}
	if resp.Msg.Theme.BackgroundColor != "#f6f2e9" {
		t.Fatalf("theme.background_color = %q, want #f6f2e9", resp.Msg.Theme.BackgroundColor)
	}
	if resp.Msg.Timezone != "Asia/Tokyo" {
		t.Fatalf("timezone = %q, want Asia/Tokyo", resp.Msg.Timezone)
	}
	if resp.Msg.DefaultLocale != "ja" {
		t.Fatalf("default_locale = %q, want ja", resp.Msg.DefaultLocale)
	}
	assertPublicExpectations(t, mock)
}

// The theme carries the icon and the logo as variants, so a tenant with both
// set exercises the one-statement variant read and the split by image id that a
// tenant without either never reaches.
func TestGetTenantIncludesBrandingImageVariants(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	iconImageID := uuid.Must(uuid.NewV7())
	logoImageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Second)
	expectTenantLookup(mock, tenantID, "TENANT001", now)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRowWithBrandingImages(
				tenantID,
				"#112233",
				now,
				uuid.NullUUID{UUID: iconImageID, Valid: true},
				uuid.NullUUID{UUID: logoImageID, Valid: true},
			)...))

	mock.ExpectQuery(regexp.QuoteMeta(listTenantImageVariantsByImageIDsQuery)).
		WithArgs(pq.Array([]uuid.UUID{iconImageID, logoImageID})).
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_image_id", "variant_type", "label", "content_type", "file_size_bytes", "width", "height",
		}).
			AddRow(iconImageID, "icon", "original", "image/png", int64(2048), int32(512), int32(512)).
			AddRow(logoImageID, "logo", "original", "image/png", int64(4096), int32(1024), int32(256)))

	client := publirav1connect.NewTenantServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}

	theme := resp.Msg.Theme
	if theme == nil {
		t.Fatal("theme is nil, want populated theme")
	}
	wantUpdatedAt := now.Format(time.RFC3339)
	if theme.IconImageUpdatedAt != wantUpdatedAt {
		t.Fatalf("icon_image_updated_at = %q, want %q", theme.IconImageUpdatedAt, wantUpdatedAt)
	}
	if theme.LogoImageUpdatedAt != wantUpdatedAt {
		t.Fatalf("logo_image_updated_at = %q, want %q", theme.LogoImageUpdatedAt, wantUpdatedAt)
	}
	if len(theme.IconImageVariants) != 1 {
		t.Fatalf("icon_image_variants = %d, want 1", len(theme.IconImageVariants))
	}
	if len(theme.LogoImageVariants) != 1 {
		t.Fatalf("logo_image_variants = %d, want 1", len(theme.LogoImageVariants))
	}
	icon := theme.IconImageVariants[0]
	wantIconURL := "/images/tenants/" + iconImageID.String() + "/icon"
	if icon.Url != wantIconURL {
		t.Fatalf("icon url = %q, want %q", icon.Url, wantIconURL)
	}
	if icon.VariantType != "icon" || icon.Width != 512 || icon.Height != 512 {
		t.Fatalf("icon variant = %+v, want icon 512x512", icon)
	}
	logo := theme.LogoImageVariants[0]
	wantLogoURL := "/images/tenants/" + logoImageID.String() + "/logo"
	if logo.Url != wantLogoURL {
		t.Fatalf("logo url = %q, want %q", logo.Url, wantLogoURL)
	}
	if logo.VariantType != "logo" || logo.Width != 1024 || logo.Height != 256 {
		t.Fatalf("logo variant = %+v, want logo 1024x256", logo)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantReturnsConfiguredTimezone(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookupWithTimezone(mock, tenantID, "TENANT001", now, "America/Los_Angeles")

	mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))

	client := publirav1connect.NewTenantServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.Timezone != "America/Los_Angeles" {
		t.Fatalf("timezone = %q, want America/Los_Angeles", resp.Msg.Timezone)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantFallsBackToDefaultTimezone(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookupWithTimezone(mock, tenantID, "TENANT001", now, "")

	mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))

	client := publirav1connect.NewTenantServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.Timezone != "Asia/Tokyo" {
		t.Fatalf("timezone = %q, want Asia/Tokyo", resp.Msg.Timezone)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantReturnsConfiguredDefaultLocale(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookupWithDefaultLocale(mock, tenantID, "TENANT001", now, "en")

	mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))

	client := publirav1connect.NewTenantServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.DefaultLocale)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantFallsBackToPlatformDefaultLocale(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookupWithDefaultLocale(mock, tenantID, "TENANT001", now, "")

	mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
	expectPlatformConfigLookup(mock, "Asia/Tokyo", "en", now)

	client := publirav1connect.NewTenantServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.DefaultLocale)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantFallsBackToDefaultLocale(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookupWithDefaultLocale(mock, tenantID, "TENANT001", now, "")

	mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformConfigQuery)).WillReturnError(sql.ErrNoRows)

	client := publirav1connect.NewTenantServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.DefaultLocale == "" {
		t.Fatal("default_locale is empty, want a resolved locale")
	}
	if resp.Msg.DefaultLocale != "ja" {
		t.Fatalf("default_locale = %q, want ja", resp.Msg.DefaultLocale)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantReportsWhetherPaymentsCanBeAccepted(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Second)
	expectTenantLookup(env.mock, tenantID, "TENANT001", now)
	env.mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)
	env.mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))

	client := publirav1connect.NewTenantServiceClient(env.ts.Client(), env.ts.URL)
	resp, err := client.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if !resp.Msg.AcceptsPayments {
		t.Fatal("accepts_payments = false, want true")
	}
	assertPublicExpectations(t, env.mock)
}

func TestGetTenantDoesNotAcceptPaymentsWithUndecryptableSettings(t *testing.T) {
	env := newPublicPaymentServer(t, nil)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Second)
	expectTenantLookup(env.mock, tenantID, "TENANT001", now)
	env.mock.ExpectQuery(regexp.QuoteMeta(getTenantConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	env.mock.ExpectQuery(regexp.QuoteMeta(getEnabledTenantPaymentConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(publicPaymentColumns()).AddRow(
			tenantID,
			paymentsettings.ProviderStripe,
			true,
			sql.NullString{String: "enc:invalid", Valid: true},
			sql.NullString{String: "enc:invalid", Valid: true},
			sql.NullString{String: "********", Valid: true},
			sql.NullString{String: "********", Valid: true},
			now,
			now,
		))
	env.mock.ExpectQuery(regexp.QuoteMeta(getTenantThemeByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))

	client := publirav1connect.NewTenantServiceClient(env.ts.Client(), env.ts.URL)
	resp, err := client.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.AcceptsPayments {
		t.Fatal("accepts_payments = true, want false")
	}
	assertPublicExpectations(t, env.mock)
}
