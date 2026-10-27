package publicapi

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
	"github.com/lib/pq"

	"github.com/publira/publira/server/internal/ageverification"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
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
		"serif_font_family",
		"sans_font_family",
		"icon_image_id",
		"icon_image_updated_at",
		"logo_image_id",
		"logo_image_updated_at",
		"sign_in_image_id",
		"sign_in_image_updated_at",
		"updated_at",
	}
}

func tenantThemeSelectRow(tenantID uuid.UUID, primaryColor string, now time.Time) []driver.Value {
	return tenantThemeSelectRowWithBrandingImages(tenantID, primaryColor, now, uuid.NullUUID{}, uuid.NullUUID{}, uuid.NullUUID{})
}

func tenantThemeSelectRowWithBrandingImages(
	tenantID uuid.UUID,
	primaryColor string,
	now time.Time,
	iconImageID uuid.NullUUID,
	logoImageID uuid.NullUUID,
	signInImageID uuid.NullUUID,
) []driver.Value {
	iconUpdatedAt := sql.NullTime{}
	if iconImageID.Valid {
		iconUpdatedAt = sql.NullTime{Time: now, Valid: true}
	}
	logoUpdatedAt := sql.NullTime{}
	if logoImageID.Valid {
		logoUpdatedAt = sql.NullTime{Time: now, Valid: true}
	}
	signInUpdatedAt := sql.NullTime{}
	if signInImageID.Valid {
		signInUpdatedAt = sql.NullTime{Time: now, Valid: true}
	}
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
		"",
		"",
		iconImageID,
		iconUpdatedAt,
		logoImageID,
		logoUpdatedAt,
		signInImageID,
		signInUpdatedAt,
		now,
	}
}

// expectNoDarkTheme answers the dark palette of a tenant that has saved none.
func expectNoDarkTheme(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantDarkThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
}

// expectNoBrandMarks answers the brand marks of a tenant that has uploaded
// none.
func expectNoBrandMarks(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublicTenantBrandMarks)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"kind", "image_id", "image_updated_at", "terms_url", "terms_accepted_at"}))
}

// expectSignInProvidersUnavailable answers the sign-in settings of a tenant
// that has saved none.
func expectSignInProvidersUnavailable(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantAppleSignInConfig)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantGoogleSignInConfig)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
}

// expectNoSignUpSettings answers the sign-up settings of a tenant that has
// saved none.
func expectNoSignUpSettings(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantSignUpSettings)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
}

// expectNoSiteCopy answers the site copy GetTenant reads for a tenant that has
// written none in any locale.
func expectNoSiteCopy(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigTranslationFor)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnError(sql.ErrNoRows)
}

// expectSiteCopy answers the site copy GetTenant reads for locale with the
// translation the database picked, which is in pickedLocale.
func expectSiteCopy(mock sqlmock.Sqlmock, tenantID uuid.UUID, locale, pickedLocale, copyright, description, tagline string) {
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigTranslationFor)).
		WithArgs(tenantID, locale).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "locale", "site_tagline", "site_description", "copyright_text", "created_at", "updated_at",
		}).AddRow(uuid.Must(uuid.NewV7()), tenantID, pickedLocale, tagline, description, copyright, now, now))
}

// expectPaymentsUnavailable answers the payment settings of a tenant that has
// saved none, and so sells in JPY.
func expectPaymentsUnavailable(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEnabledTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectTenantCurrency(mock, tenantID, "")
}

// expectTenantCurrency answers the payment settings GetTenant reads the
// currency from: a disabled Stripe row in currency, or none when currency is
// empty, which leaves the tenant on the platform's JPY.
func expectTenantCurrency(mock sqlmock.Sqlmock, tenantID uuid.UUID, currency string) {
	query := mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantPaymentConfigByTenantID)).WithArgs(tenantID)
	if currency == "" {
		query.WillReturnError(sql.ErrNoRows)
		mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPlatformDefaultCurrency)).
			WillReturnRows(sqlmock.NewRows([]string{"default_currency"}).AddRow("JPY"))
		return
	}
	now := time.Now()
	query.WillReturnRows(sqlmock.NewRows(publicPaymentColumns()).
		AddRow(tenantID, stripe.ID, false, now, now, []byte("{}"), []byte("{}"), currency))
}

func TestGetTenantIncludesTheme(t *testing.T) {
	_, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("GenerateVAPIDKeys: %v", err)
	}
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT001", now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantConfigColumns()).AddRow(
			tenantID,
			now,
			now,
			"disabled",
			int32(3),
			"single",
			ageverification.None,
			"all",
			nil,
			nil,
			nil,
			nil,
			nil,
			"{}",
			nil,
			nil,
			"external_checkout",
			"upload",
		))
	expectSiteCopy(mock, tenantID, "ja", "ja", "© Publira", "Site description", "Tagline")
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
	expectNoDarkTheme(mock, tenantID)
	expectNoBrandMarks(mock, tenantID)
	expectSignInProvidersUnavailable(mock, tenantID)
	expectNoSignUpSettings(mock, tenantID)
	expectPublishedWebPushPublicKey(mock, publicKey)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.TenantPublicId != "TENANT001" {
		t.Fatalf("tenant_public_id = %q, want TENANT001", resp.TenantPublicId)
	}
	if resp.CopyrightText != "© Publira" {
		t.Fatalf("copyright_text = %q, want © Publira", resp.CopyrightText)
	}
	if resp.Theme == nil {
		t.Fatal("theme is nil, want populated theme")
	}
	if resp.Theme.PrimaryColor != "#112233" {
		t.Fatalf("theme.primary_color = %q, want #112233", resp.Theme.PrimaryColor)
	}
	if resp.Theme.BackgroundColor != "#f5f5f2" {
		t.Fatalf("theme.background_color = %q, want #f5f5f2", resp.Theme.BackgroundColor)
	}
	if len(resp.Theme.SignInImageVariants) != 0 || resp.Theme.SignInImageUpdatedAt != "" {
		t.Fatalf("theme sign-in image = %d variants updated at %q, want none", len(resp.Theme.SignInImageVariants), resp.Theme.SignInImageUpdatedAt)
	}
	if resp.DarkTheme != nil {
		t.Fatalf("dark_theme = %+v, want nil for a tenant without one", resp.DarkTheme)
	}
	if resp.Timezone != "UTC" {
		t.Fatalf("timezone = %q, want UTC", resp.Timezone)
	}
	if resp.DefaultLocale != "ja" {
		t.Fatalf("default_locale = %q, want ja", resp.DefaultLocale)
	}
	if resp.WebPushVapidPublicKey != publicKey {
		t.Fatalf("web_push_vapid_public_key = %q, want %q", resp.WebPushVapidPublicKey, publicKey)
	}
	assertPublicExpectations(t, mock)
}

// The copy is read in the reader's locale, and what the database picks for it
// is answered as it is: a tenant that wrote its copy only in ja answers that
// copy to a reader in en.
func TestGetTenantReadsTheSiteCopyInTheReadersLocale(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectSiteCopy(mock, tenantID, "en", "ja", "© Hoshi Shobo", "Comics from Hoshi Shobo", "Read tonight")
	expectPaymentsUnavailable(mock, tenantID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoDarkTheme(mock, tenantID)
	expectNoBrandMarks(mock, tenantID)
	expectSignInProvidersUnavailable(mock, tenantID)
	expectNoSignUpSettings(mock, tenantID)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Locale: "en",
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.CopyrightText != "© Hoshi Shobo" || resp.SiteDescription != "Comics from Hoshi Shobo" || resp.SiteTagline != "Read tonight" {
		t.Fatalf("site copy = %q / %q / %q, want the copy the database picked", resp.CopyrightText, resp.SiteDescription, resp.SiteTagline)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantRefusesAnUnsupportedLocale(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT001", time.Now())

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	_, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Locale: "xx",
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("GetTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

// A failed read of the copy is not answered as a tenant that wrote none, which
// web-storefront would cache.
func TestGetTenantFailsWhenTheSiteCopyCannotBeRead(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT001", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigTranslationFor)).
		WithArgs(tenantID, "ja").
		WillReturnError(sql.ErrConnDone)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	_, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetTenant code = %v, want internal", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

// The theme carries the icon, the logo, and the sign-in image as variants, so a
// tenant with all three set exercises the one-statement variant read and the
// split by image id that a tenant without any never reaches.
func TestGetTenantIncludesBrandingImageVariants(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	iconImageID := uuid.Must(uuid.NewV7())
	logoImageID := uuid.Must(uuid.NewV7())
	signInImageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Second)
	expectTenantLookup(mock, tenantID, "TENANT001", now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoSiteCopy(mock, tenantID)
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRowWithBrandingImages(
				tenantID,
				"#112233",
				now,
				uuid.NullUUID{UUID: iconImageID, Valid: true},
				uuid.NullUUID{UUID: logoImageID, Valid: true},
				uuid.NullUUID{UUID: signInImageID, Valid: true},
			)...))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantImageVariantsByImageIDs)).
		WithArgs(pq.Array([]uuid.UUID{iconImageID, logoImageID, signInImageID})).
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_image_id", "variant_type", "label", "content_type", "file_size_bytes", "width", "height",
		}).
			AddRow(iconImageID, "icon", "original", "image/png", int64(2048), int32(512), int32(512)).
			AddRow(logoImageID, "logo", "original", "image/png", int64(4096), int32(1024), int32(256)).
			AddRow(signInImageID, "sign_in", "original", "image/jpeg", int64(8192), int32(1920), int32(2560)))
	expectNoDarkTheme(mock, tenantID)
	expectNoBrandMarks(mock, tenantID)
	expectSignInProvidersUnavailable(mock, tenantID)
	expectNoSignUpSettings(mock, tenantID)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}

	theme := resp.Theme
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
	if theme.SignInImageUpdatedAt != wantUpdatedAt {
		t.Fatalf("sign_in_image_updated_at = %q, want %q", theme.SignInImageUpdatedAt, wantUpdatedAt)
	}
	if len(theme.SignInImageVariants) != 1 {
		t.Fatalf("sign_in_image_variants = %d, want 1", len(theme.SignInImageVariants))
	}
	signIn := theme.SignInImageVariants[0]
	wantSignInURL := "/images/tenants/" + signInImageID.String() + "/sign_in"
	if signIn.Url != wantSignInURL {
		t.Fatalf("sign-in image url = %q, want %q", signIn.Url, wantSignInURL)
	}
	if signIn.VariantType != "sign_in" || signIn.ContentType != "image/jpeg" || signIn.Width != 1920 || signIn.Height != 2560 {
		t.Fatalf("sign-in image variant = %+v, want a sign_in image/jpeg 1920x2560", signIn)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantAnswersNoThemeWithoutAThemeRow(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoSiteCopy(mock, tenantID)
	expectPaymentsUnavailable(mock, tenantID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoDarkTheme(mock, tenantID)
	expectNoBrandMarks(mock, tenantID)
	expectSignInProvidersUnavailable(mock, tenantID)
	expectNoSignUpSettings(mock, tenantID)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Theme != nil {
		t.Fatalf("theme = %+v, want nil", resp.Theme)
	}
	if len(resp.BrandMarks) != 0 {
		t.Fatalf("brand_marks = %v, want none", resp.BrandMarks)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantAnswersTheBrandMarksWithoutWhoAcceptedThem(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	badgeImageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Second)
	acceptedAt := now.Add(-time.Hour)
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoSiteCopy(mock, tenantID)
	expectPaymentsUnavailable(mock, tenantID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoDarkTheme(mock, tenantID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublicTenantBrandMarks)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"kind", "image_id", "image_updated_at", "terms_url", "terms_accepted_at"}).
			AddRow("app_store_badge", badgeImageID, now, "https://example.com/badge-guidelines", acceptedAt))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantImageVariantsByImageIDs)).
		WithArgs(pq.Array([]uuid.UUID{badgeImageID})).
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_image_id", "variant_type", "label", "content_type", "file_size_bytes", "width", "height",
		}).AddRow(badgeImageID, "app_store_badge", "original", "image/png", int64(2048), int32(360), int32(120)))
	expectSignInProvidersUnavailable(mock, tenantID)
	expectNoSignUpSettings(mock, tenantID)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if len(resp.BrandMarks) != 1 {
		t.Fatalf("brand_marks = %v, want the App Store badge alone", resp.BrandMarks)
	}
	mark := resp.BrandMarks[0]
	if mark.Kind != publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_APP_STORE_BADGE {
		t.Fatalf("kind = %s, want APP_STORE_BADGE", mark.Kind)
	}
	if mark.TermsUrl != "https://example.com/badge-guidelines" || mark.TermsAcceptedAt != acceptedAt.Format(time.RFC3339) {
		t.Fatalf("terms = %q at %q, want the guideline URL at %s", mark.TermsUrl, mark.TermsAcceptedAt, acceptedAt.Format(time.RFC3339))
	}
	if mark.ImageUpdatedAt != now.Format(time.RFC3339) {
		t.Fatalf("image_updated_at = %q, want %q", mark.ImageUpdatedAt, now.Format(time.RFC3339))
	}
	wantURL := "/images/tenants/" + badgeImageID.String() + "/app_store_badge"
	if len(mark.ImageVariants) != 1 || mark.ImageVariants[0].Url != wantURL {
		t.Fatalf("image_variants = %v, want one at %s", mark.ImageVariants, wantURL)
	}
	assertPublicExpectations(t, mock)
}

// web-storefront caches whatever GetTenant answers, so a failed branding read
// answered as a tenant without a theme would be served as that tenant's brand.
func TestGetTenantFailsWhenTheBrandingCannotBeRead(t *testing.T) {
	iconImageID := uuid.Must(uuid.NewV7())
	readFailure := errors.New("connection reset by peer")
	tests := []struct {
		name        string
		wantLog     string
		expectTheme func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time)
	}{
		{
			name:    "theme",
			wantLog: "failed to read the tenant theme",
			expectTheme: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, _ time.Time) {
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
					WithArgs(tenantID).
					WillReturnError(readFailure)
			},
		},
		{
			name:    "dark theme",
			wantLog: "failed to read the tenant dark theme",
			expectTheme: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time) {
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
					WithArgs(tenantID).
					WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
						AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantDarkThemeByTenantID)).
					WithArgs(tenantID).
					WillReturnError(readFailure)
			},
		},
		{
			name:    "branding image variants",
			wantLog: "failed to read the tenant branding image variants",
			expectTheme: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time) {
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
					WithArgs(tenantID).
					WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
						AddRow(tenantThemeSelectRowWithBrandingImages(
							tenantID,
							"#112233",
							now,
							uuid.NullUUID{UUID: iconImageID, Valid: true},
							uuid.NullUUID{},
							uuid.NullUUID{},
						)...))
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantImageVariantsByImageIDs)).
					WithArgs(pq.Array([]uuid.UUID{iconImageID})).
					WillReturnError(readFailure)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newPublicPaymentServer(t, nil)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Second)
			expectTenantLookup(env.mock, tenantID, "TENANT001", now)
			env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
				WithArgs(tenantID).
				WillReturnError(sql.ErrNoRows)
			expectNoSiteCopy(env.mock, tenantID)
			expectPaymentsUnavailable(env.mock, tenantID)
			tt.expectTheme(env.mock, tenantID, now)

			client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(env.ts.Client(), env.ts.URL)))
			_, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			})
			if connect.CodeOf(err) != connect.CodeInternal {
				t.Fatalf("GetTenant error = %v, want CodeInternal", err)
			}
			logs := env.logs.String()
			if !strings.Contains(logs, tt.wantLog) || !strings.Contains(logs, readFailure.Error()) {
				t.Fatalf("logs = %q, want %q with the read error", logs, tt.wantLog)
			}
			assertPublicExpectations(t, env.mock)
		})
	}
}

func TestGetTenantReturnsConfiguredTimezone(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookupWithTimezone(mock, tenantID, "TENANT001", now, "America/Los_Angeles")

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoSiteCopy(mock, tenantID)
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
	expectNoDarkTheme(mock, tenantID)
	expectNoBrandMarks(mock, tenantID)
	expectSignInProvidersUnavailable(mock, tenantID)
	expectNoSignUpSettings(mock, tenantID)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Timezone != "America/Los_Angeles" {
		t.Fatalf("timezone = %q, want America/Los_Angeles", resp.Timezone)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantFallsBackToDefaultTimezone(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookupWithTimezone(mock, tenantID, "TENANT001", now, "")

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoSiteCopy(mock, tenantID)
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
	expectNoDarkTheme(mock, tenantID)
	expectNoBrandMarks(mock, tenantID)
	expectSignInProvidersUnavailable(mock, tenantID)
	expectNoSignUpSettings(mock, tenantID)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Timezone != "UTC" {
		t.Fatalf("timezone = %q, want UTC", resp.Timezone)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantReturnsConfiguredDefaultLocale(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookupWithDefaultLocale(mock, tenantID, "TENANT001", now, "en")

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoSiteCopy(mock, tenantID)
	expectPaymentsUnavailable(mock, tenantID)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
	expectNoDarkTheme(mock, tenantID)
	expectNoBrandMarks(mock, tenantID)
	expectSignInProvidersUnavailable(mock, tenantID)
	expectNoSignUpSettings(mock, tenantID)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.DefaultLocale)
	}
	if !slices.Equal(resp.SupportedLocales, locale.Supported) {
		t.Fatalf("supported_locales = %q, want %q", resp.SupportedLocales, locale.Supported)
	}
	assertPublicExpectations(t, mock)
}

// The branding reads below tolerate a missing row; the locale does not. It is
// resolved before any of them, so an unusable stored value fails the request
// rather than reaching the storefront as another language.
func TestGetTenantFailsOnAnUnusableStoredLocale(t *testing.T) {
	tests := []struct {
		name   string
		stored string
	}{
		{name: "blank", stored: ""},
		{name: "unsupported code", stored: "fr"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now()
			expectTenantLookupWithDefaultLocale(mock, tenantID, "TENANT001", now, tt.stored)

			client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			_, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			})
			if connect.CodeOf(err) != connect.CodeInternal {
				t.Fatalf("GetTenant code = %v, want internal (err=%v)", connect.CodeOf(err), err)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

func TestGetTenantReportsWhetherPaymentsCanBeAccepted(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Second)
	expectTenantLookup(env.mock, tenantID, "TENANT001", now)
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoSiteCopy(env.mock, tenantID)
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)
	expectTenantCurrency(env.mock, tenantID, "JPY")
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
	expectNoDarkTheme(env.mock, tenantID)
	expectNoBrandMarks(env.mock, tenantID)
	expectSignInProvidersUnavailable(env.mock, tenantID)
	expectNoSignUpSettings(env.mock, tenantID)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(env.ts.Client(), env.ts.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if !resp.AcceptsPayments {
		t.Fatal("accepts_payments = false, want true")
	}
	if resp.Currency != "JPY" {
		t.Fatalf("currency = %q, want JPY", resp.Currency)
	}
	assertPublicExpectations(t, env.mock)
}

func TestGetTenantDoesNotAcceptPaymentsWithUndecryptableSettings(t *testing.T) {
	env := newPublicPaymentServer(t, nil)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Second)
	expectTenantLookup(env.mock, tenantID, "TENANT001", now)
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoSiteCopy(env.mock, tenantID)
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEnabledTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(stripePaymentConfigRow(t, tenantID, "enc:invalid", "enc:invalid", "********", "********", now))
	expectTenantCurrency(env.mock, tenantID, "JPY")
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
	expectNoDarkTheme(env.mock, tenantID)
	expectNoBrandMarks(env.mock, tenantID)
	expectSignInProvidersUnavailable(env.mock, tenantID)
	expectNoSignUpSettings(env.mock, tenantID)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(env.ts.Client(), env.ts.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.AcceptsPayments {
		t.Fatal("accepts_payments = true, want false")
	}
	assertPublicExpectations(t, env.mock)
}

// The public site reads the mode to decide whether an episode page offers a
// comment section at all, so every stored value has to arrive as the enum the
// site branches on rather than as the column's text.
func TestGetTenantReportsTheTenantCommentMode(t *testing.T) {
	cases := []struct {
		name string
		mode string
		want publirattypesv1.CommentMode
	}{
		{name: "disabled", mode: "disabled", want: publirattypesv1.CommentMode_COMMENT_MODE_DISABLED},
		{name: "immediate", mode: "immediate", want: publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE},
		{name: "approval required", mode: "approval_required", want: publirattypesv1.CommentMode_COMMENT_MODE_APPROVAL_REQUIRED},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now()
			expectTenantLookup(mock, tenantID, "TENANT001", now)
			expectTenantConfigWithCommentMode(mock, tenantID, now, tc.mode)
			expectNoSiteCopy(mock, tenantID)
			expectPaymentsUnavailable(mock, tenantID)
			mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
				WithArgs(tenantID).
				WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
					AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
			expectNoDarkTheme(mock, tenantID)
			expectNoBrandMarks(mock, tenantID)
			expectSignInProvidersUnavailable(mock, tenantID)
			expectNoSignUpSettings(mock, tenantID)

			client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			})
			if err != nil {
				t.Fatalf("GetTenant: %v", err)
			}
			if resp.CommentMode != tc.want {
				t.Fatalf("comment_mode = %v, want %v", resp.CommentMode, tc.want)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

// A tenant that has saved nothing at all has chosen nothing about commenting,
// which is the same answer the column's own default carries.
func TestGetTenantReportsCommentingOffWithoutAConfigRow(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectNoSiteCopy(mock, tenantID)
	expectPaymentsUnavailable(mock, tenantID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
			AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
	expectNoDarkTheme(mock, tenantID)
	expectNoBrandMarks(mock, tenantID)
	expectSignInProvidersUnavailable(mock, tenantID)
	expectNoSignUpSettings(mock, tenantID)

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_DISABLED {
		t.Fatalf("comment_mode = %v, want COMMENT_MODE_DISABLED", resp.CommentMode)
	}
	assertPublicExpectations(t, mock)
}

// A stored mode this build cannot act on fails the read instead of being
// answered with a stand-in: PostEpisodeComment refuses the same value, so a
// guess would put a comment box on screen that no submission can pass.
func TestGetTenantFailsOnAnUnsupportedCommentMode(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectTenantConfigWithCommentMode(mock, tenantID, now, "members_only")

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	_, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetTenant error = %v, want CodeInternal", err)
	}
	assertPublicExpectations(t, mock)
}

func expectTenantConfigWithCommentMode(
	mock sqlmock.Sqlmock,
	tenantID uuid.UUID,
	now time.Time,
	mode string,
) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantConfigColumns()).AddRow(
			tenantID,
			now,
			now,
			mode,
			int32(3),
			"single",
			ageverification.None,
			"all",
			nil,
			nil,
			nil,
			nil,
			nil,
			"{}",
			nil,
			nil,
			"external_checkout",
			"upload",
		))
}

// The public site reads the rule to decide whether its sign-up form asks for a
// birth date at all, so the setting is answered here as well as in the console.
func TestGetTenantReportsTheTenantAgeVerification(t *testing.T) {
	cases := []struct {
		name   string
		stored string
		want   publirattypesv1.AgeVerification
	}{
		{name: "none", stored: ageverification.None, want: publirattypesv1.AgeVerification_AGE_VERIFICATION_NONE},
		{name: "r18", stored: ageverification.R18, want: publirattypesv1.AgeVerification_AGE_VERIFICATION_R18},
		{name: "r15 and r18", stored: ageverification.R15AndR18, want: publirattypesv1.AgeVerification_AGE_VERIFICATION_R15_AND_R18},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now()
			expectTenantLookup(mock, tenantID, "TENANT001", now)
			expectTenantAgeVerification(mock, tenantID, now, tc.stored)
			expectNoSiteCopy(mock, tenantID)
			expectPaymentsUnavailable(mock, tenantID)
			mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
				WithArgs(tenantID).
				WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
					AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
			expectNoDarkTheme(mock, tenantID)
			expectNoBrandMarks(mock, tenantID)
			expectSignInProvidersUnavailable(mock, tenantID)
			expectNoSignUpSettings(mock, tenantID)

			client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			})
			if err != nil {
				t.Fatalf("GetTenant: %v", err)
			}
			if resp.AgeVerification != tc.want {
				t.Fatalf("age_verification = %v, want %v", resp.AgeVerification, tc.want)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

// A stored rule this build cannot act on fails the read rather than answering
// with a rule the tenant never chose.
func TestGetTenantFailsOnAnUnsupportedAgeVerification(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectTenantAgeVerification(mock, tenantID, now, "everything")

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	_, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetTenant error = %v, want CodeInternal", err)
	}
	assertPublicExpectations(t, mock)
}

// The app reads the route before it offers a purchase, so the tenant read
// answers it, and a tenant that has saved nothing sells through the external
// checkout.
func TestGetTenantReportsTheAppPurchaseRoute(t *testing.T) {
	cases := []struct {
		name   string
		stored string
		want   publirattypesv1.AppPurchaseRoute
	}{
		{name: "no config row", want: publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT},
		{name: "external checkout", stored: "external_checkout", want: publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT},
		{name: "store", stored: "store", want: publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_STORE},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now()
			expectTenantLookup(mock, tenantID, "TENANT001", now)
			if tc.stored == "" {
				mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
					WithArgs(tenantID).
					WillReturnError(sql.ErrNoRows)
			} else {
				expectTenantConfigWithAppPurchaseRoute(mock, tenantID, now, tc.stored)
			}
			expectNoSiteCopy(mock, tenantID)
			expectPaymentsUnavailable(mock, tenantID)
			if tc.want == publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_STORE {
				expectStoreReadinessUnavailable(mock, tenantID, now)
			}
			mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantThemeByTenantID)).
				WithArgs(tenantID).
				WillReturnRows(sqlmock.NewRows(tenantThemeSelectColumns()).
					AddRow(tenantThemeSelectRow(tenantID, "#112233", now)...))
			expectNoDarkTheme(mock, tenantID)
			expectNoBrandMarks(mock, tenantID)
			expectSignInProvidersUnavailable(mock, tenantID)
			expectNoSignUpSettings(mock, tenantID)

			client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			})
			if err != nil {
				t.Fatalf("GetTenant: %v", err)
			}
			// A store read that fails answers no store rather than failing the
			// read, as accepts_payments does.
			if resp.AcceptsAppStorePayments || resp.AcceptsGooglePlayPayments {
				t.Fatalf("store payments = %v / %v, want false / false", resp.AcceptsAppStorePayments, resp.AcceptsGooglePlayPayments)
			}
			if resp.AppPurchaseRoute != tc.want {
				t.Fatalf("app_purchase_route = %v, want %v", resp.AppPurchaseRoute, tc.want)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

func TestGetTenantFailsOnAnUnsupportedAppPurchaseRoute(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectTenantConfigWithAppPurchaseRoute(mock, tenantID, now, "coins")

	client := publirav1connect.NewTenantServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	_, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetTenant error = %v, want CodeInternal", err)
	}
	assertPublicExpectations(t, mock)
}

// expectStoreReadinessUnavailable stands in for the credential reads of both
// stores failing after the route was read as store.
func expectStoreReadinessUnavailable(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time) {
	for range 2 {
		expectTenantConfigWithAppPurchaseRoute(mock, tenantID, now, "store")
		mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantAppStoreConfigByTenantID)).
			WithArgs(tenantID).
			WillReturnError(errors.New("connection reset"))
	}
}

func expectTenantConfigWithAppPurchaseRoute(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time, route string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantConfigColumns()).
			AddRow(tenantID, now, now, "disabled", int32(3), "single", ageverification.None, "all", nil, nil, nil, nil, nil, "{}", nil, nil, route, "upload"))
}
