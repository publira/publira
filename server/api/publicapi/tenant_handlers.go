package publicapi

import (
	"context"
	"database/sql"
	"fmt"
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
		commentMode, err = commentModeFromConfig(config.CommentMode)
		if err != nil {
			return nil, s.internalError(ctx, "tenant comment mode is not a supported mode", err, "tenant_id", tenant.ID.String())
		}
	} else if err != sql.ErrNoRows {
		// Log error but don't fail the request
		_ = err
	}
	acceptsPayments := s.tenantAcceptsPayments(ctx, tenant.ID)

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
		TenantPublicId:  tenant.PublicID,
		TenantName:      tenant.Name,
		TenantDomain:    tenant.Domain,
		CopyrightText:   copyrightText,
		SiteDescription: siteDescription,
		SiteTagline:     siteTagline,
		Theme:           theme,
		Timezone:        tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries)),
		DefaultLocale:   defaultLocale,
		AcceptsPayments: acceptsPayments,
		CommentMode:     commentMode,
	}), nil
}

// commentModeFromConfig maps the stored tenant_config.comment_mode onto the
// value the public site branches on.
//
// An unrecognised mode is reported rather than answered with a stand-in, the
// way an unsupported default_locale is. PostEpisodeComment refuses that same
// value outright, so guessing one here would put a comment box on screen that
// every submission is guaranteed to reject.
func commentModeFromConfig(mode string) (publirattypesv1.CommentMode, error) {
	switch mode {
	case commentModeDisabled:
		return publirattypesv1.CommentMode_COMMENT_MODE_DISABLED, nil
	case commentModeImmediate:
		return publirattypesv1.CommentMode_COMMENT_MODE_IMMEDIATE, nil
	case commentModeApprovalRequired:
		return publirattypesv1.CommentMode_COMMENT_MODE_APPROVAL_REQUIRED, nil
	default:
		return publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED, fmt.Errorf("unsupported comment mode %q", mode)
	}
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
