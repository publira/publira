package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/platformconfig"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/tenanttz"
)

func (s *apiServer) GetTenant(
	ctx context.Context,
	req *connect.Request[publirav1.GetTenantRequest],
) (*connect.Response[publirav1.GetTenantResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)

	// Unlike the copy below, the locale is not optional: it decides which
	// language every string on the site is read in, so a stored value this
	// build cannot render is reported instead of silently becoming another.
	defaultLocale, err := locale.Resolve(tenant.DefaultLocale)
	if err != nil {
		return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
	}

	// Fetch tenant config (optional)
	config, err := queries.GetTenantConfigByTenantID(ctx, tenant.ID)
	copyrightText := ""
	siteDescription := ""
	siteTagline := ""
	// A tenant with no config row, and one whose config could not be read, have
	// chosen nothing about commenting. That is the column's own default too.
	commentMode := publirattypesv1.CommentMode_COMMENT_MODE_DISABLED
	// The same for the age rule, whose column defaults to asking for no proof.
	// What this field decides is whether the sign-up form asks for a birth date
	// at all; every body a rated series holds is gated by GetEpisodeDetail,
	// which reads the rule itself and refuses the read rather than answering
	// around it.
	ageVerification := publirattypesv1.AgeVerification_AGE_VERIFICATION_NONE
	appStoreURL := ""
	googlePlayURL := ""
	// The column's default: the app sells through the external checkout.
	appPurchaseRoute := publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT
	var termsPage, privacyPage *publirav1.TenantLegalPage

	if err == nil {
		if config.CopyrightText.Valid {
			copyrightText = config.CopyrightText.String
		}
		if config.SiteDescription.Valid {
			siteDescription = config.SiteDescription.String
		}
		if config.SiteTagline.Valid {
			siteTagline = config.SiteTagline.String
		}
		appStoreURL = config.AppStoreUrl.String
		googlePlayURL = config.GooglePlayUrl.String
		appPurchaseRoute, err = protomapper.AppPurchaseRouteFromStored(config.AppPurchaseRoute)
		if err != nil {
			return nil, s.internalError(ctx, "tenant app purchase route is not a supported value", err, "tenant_id", tenant.ID.String())
		}
		commentMode, err = protomapper.CommentModeFromStored(config.CommentMode)
		if err != nil {
			return nil, s.internalError(ctx, "tenant comment mode is not a supported mode", err, "tenant_id", tenant.ID.String())
		}
		ageVerification, err = protomapper.AgeVerificationFromStored(config.AgeVerification)
		if err != nil {
			return nil, s.internalError(ctx, "tenant age verification is not a supported rule", err, "tenant_id", tenant.ID.String())
		}
		termsPage, privacyPage = s.publishedLegalPages(ctx, queries, tenant.ID)
	} else if err != sql.ErrNoRows {
		// Log error but don't fail the request
		_ = err
	}
	acceptsPayments := s.tenantAcceptsPayments(ctx, tenant.ID)
	var acceptsAppStorePayments, acceptsGooglePlayPayments bool
	if appPurchaseRoute == publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_STORE {
		acceptsAppStorePayments, acceptsGooglePlayPayments = s.tenantAcceptsStorePayments(ctx, tenant.ID)
	}

	var theme *publirattypesv1.TenantTheme
	themeRow, themeErr := queries.GetTenantThemeByTenantID(ctx, tenant.ID)
	if themeErr == nil {
		iconVariants, logoVariants := tenantBrandingImageVariants(ctx, queries, themeRow)
		theme = protomapper.TenantThemeFromGetRow(themeRow, iconVariants, logoVariants)
	} else if themeErr != sql.ErrNoRows {
		// Theme is branding only; keep GetTenant available even if theme load fails.
		_ = themeErr
	}

	return connect.NewResponse(&publirav1.GetTenantResponse{
		TenantPublicId:            tenant.PublicID,
		TenantName:                tenant.Name,
		TenantDomain:              tenant.Domain,
		CopyrightText:             copyrightText,
		SiteDescription:           siteDescription,
		SiteTagline:               siteTagline,
		Theme:                     theme,
		Timezone:                  tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries)),
		DefaultLocale:             defaultLocale,
		AcceptsPayments:           acceptsPayments,
		AgeVerification:           ageVerification,
		CommentMode:               commentMode,
		WebPushVapidPublicKey:     s.publishedWebPushPublicKey(ctx),
		AppStoreUrl:               appStoreURL,
		GooglePlayUrl:             googlePlayURL,
		TermsPage:                 termsPage,
		PrivacyPage:               privacyPage,
		AppPurchaseRoute:          appPurchaseRoute,
		AcceptsAppStorePayments:   acceptsAppStorePayments,
		AcceptsGooglePlayPayments: acceptsGooglePlayPayments,
	}), nil
}

// publishedLegalPages answers the terms and privacy pages the tenant names,
// leaving out one that is not published so the storefront never links to a
// page it cannot serve. A failed read answers neither, like the rest of the
// optional site copy.
func (s *apiServer) publishedLegalPages(ctx context.Context, queries Querier, tenantID uuid.UUID) (terms, privacy *publirav1.TenantLegalPage) {
	row, err := queries.GetTenantLegalPages(ctx, tenantID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			s.logger.WarnContext(ctx, "failed to read the tenant legal pages", "tenant_id", tenantID.String(), "error", err)
		}
		return nil, nil
	}
	if row.TermsPublished {
		terms = &publirav1.TenantLegalPage{
			Slug:      row.TermsSlug.String,
			Title:     row.TermsTitle.String,
			VersionId: row.TermsPublishedVersionID.UUID.String(),
		}
	}
	if row.PrivacyPublished {
		privacy = &publirav1.TenantLegalPage{
			Slug:      row.PrivacySlug.String,
			Title:     row.PrivacyTitle.String,
			VersionId: row.PrivacyPublishedVersionID.UUID.String(),
		}
	}
	return terms, privacy
}

// tenantAcceptsPayments deliberately fails closed. The public response only
// exposes whether Checkout can be offered; plaintext credentials remain inside
// paymentsettings while it verifies that the enabled settings can be decrypted.
func (s *apiServer) tenantAcceptsPayments(ctx context.Context, tenantID uuid.UUID) bool {
	_, secrets, err := s.paymentStore(ctx).LoadEnabledSecrets(ctx, tenantID)
	if err != nil {
		if paymentsettings.IsUnavailable(err) {
			return false
		}
		s.logger.WarnContext(ctx, "could not determine tenant payment availability", "tenant_id", tenantID, "error", err)
		return false
	}
	return strings.TrimSpace(secrets.SecretKey) != "" && strings.TrimSpace(secrets.WebhookSecret) != ""
}

// tenantAcceptsStorePayments answers which stores the tenant's app can charge
// through, on the same terms StartStorePurchase checks. It fails closed like
// tenantAcceptsPayments.
func (s *apiServer) tenantAcceptsStorePayments(ctx context.Context, tenantID uuid.UUID) (appStore, googlePlay bool) {
	config, err := s.appStores(ctx).Get(ctx, tenantID)
	if err != nil {
		s.logger.WarnContext(ctx, "could not determine tenant store payment availability", "tenant_id", tenantID, "error", err)
		return false, false
	}
	if config.Route != paymentsettings.RouteStore {
		return false, false
	}
	return config.AppStore.Ready, config.GooglePlay.Ready
}

// tenantBrandingImageVariants reads the variants of the theme's icon and
// logo. Branding is not worth failing GetTenant over — the same reason the
// theme read itself is tolerated above — so a failed lookup yields no variants
// and the colors still answer.
func tenantBrandingImageVariants(
	ctx context.Context,
	queries Querier,
	row dbmodels.GetTenantThemeByTenantIDRow,
) (iconVariants, logoVariants []*publirattypesv1.TenantImageVariant) {
	imageIDs := make([]uuid.UUID, 0, 2)
	if row.IconImageID.Valid {
		imageIDs = append(imageIDs, row.IconImageID.UUID)
	}
	if row.LogoImageID.Valid {
		imageIDs = append(imageIDs, row.LogoImageID.UUID)
	}
	if len(imageIDs) == 0 {
		return nil, nil
	}

	variantRows, err := queries.ListTenantImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, nil
	}
	byImageID := protomapper.TenantImageVariantsByImageID(variantRows)

	return byImageID[row.IconImageID.UUID], byImageID[row.LogoImageID.UUID]
}

// publishedWebPushPublicKey answers the key GetTenant publishes. A failed read
// publishes none rather than failing the site chrome over it.
func (s *apiServer) publishedWebPushPublicKey(ctx context.Context) string {
	publicKey, err := s.webPushKeys.PublicKey(ctx)
	if err != nil {
		s.logger.WarnContext(ctx, "failed to read the web push public key", "error", err)
		return ""
	}
	return publicKey
}
