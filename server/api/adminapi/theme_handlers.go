package adminapi

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

var hexColorCodePattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// WCAG AA requires 4.5:1 contrast for normal text. Theme foreground tokens
// are used for text, including compact labels, so the stricter text threshold
// protects each rendered pair rather than relying on a component's size.
const minimumThemeTextContrastRatio = 4.5

func validateHexColorCode(value string, fieldName string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if !hexColorCodePattern.MatchString(trimmed) {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New(fieldName+" must be a hex color code in #RRGGBB format"))
	}
	return strings.ToLower(trimmed), nil
}

func themeColorRelativeLuminance(color string) float64 {
	value, _ := strconv.ParseUint(color[1:], 16, 32)
	linearize := func(component uint64) float64 {
		normalized := float64(component) / 255
		if normalized <= 0.03928 {
			return normalized / 12.92
		}
		return math.Pow((normalized+0.055)/1.055, 2.4)
	}

	return 0.2126*linearize((value>>16)&0xff) +
		0.7152*linearize((value>>8)&0xff) +
		0.0722*linearize(value&0xff)
}

func themeColorContrastRatio(firstColor string, secondColor string) float64 {
	first := themeColorRelativeLuminance(firstColor)
	second := themeColorRelativeLuminance(secondColor)
	return (math.Max(first, second) + 0.05) / (math.Min(first, second) + 0.05)
}

func normalizeTenantTheme(theme *publirattypesv1.TenantTheme) (dbmodels.UpsertTenantThemeParams, error) {
	type colorField struct {
		value string
		name  string
	}
	fields := []colorField{
		{theme.PrimaryColor, "theme.primary_color"},
		{theme.SecondaryColor, "theme.secondary_color"},
		{theme.AccentColor, "theme.accent_color"},
		{theme.BackgroundColor, "theme.background_color"},
		{theme.ForegroundColor, "theme.foreground_color"},
		{theme.SurfaceColor, "theme.surface_color"},
		{theme.SurfaceForegroundColor, "theme.surface_foreground_color"},
		{theme.CardColor, "theme.card_color"},
		{theme.CardForegroundColor, "theme.card_foreground_color"},
		{theme.PopoverColor, "theme.popover_color"},
		{theme.PopoverForegroundColor, "theme.popover_foreground_color"},
		{theme.PrimaryForegroundColor, "theme.primary_foreground_color"},
		{theme.SecondaryForegroundColor, "theme.secondary_foreground_color"},
		{theme.AccentForegroundColor, "theme.accent_foreground_color"},
		{theme.MutedColor, "theme.muted_color"},
		{theme.MutedForegroundColor, "theme.muted_foreground_color"},
		{theme.BorderColor, "theme.border_color"},
		{theme.InputColor, "theme.input_color"},
		{theme.RingColor, "theme.ring_color"},
		{theme.SuccessColor, "theme.success_color"},
		{theme.SuccessForegroundColor, "theme.success_foreground_color"},
		{theme.WarningColor, "theme.warning_color"},
		{theme.WarningForegroundColor, "theme.warning_foreground_color"},
		{theme.DestructiveColor, "theme.destructive_color"},
		{theme.DestructiveForegroundColor, "theme.destructive_foreground_color"},
		{theme.InfoColor, "theme.info_color"},
		{theme.InfoForegroundColor, "theme.info_foreground_color"},
	}
	normalized := make([]string, len(fields))
	byName := make(map[string]string, len(fields))
	for i, f := range fields {
		v, err := validateHexColorCode(f.value, f.name)
		if err != nil {
			return dbmodels.UpsertTenantThemeParams{}, err
		}
		normalized[i] = v
		byName[f.name] = v
	}
	for _, pair := range []struct {
		background string
		foreground string
	}{
		{"theme.primary_color", "theme.primary_foreground_color"},
		{"theme.secondary_color", "theme.secondary_foreground_color"},
		{"theme.accent_color", "theme.accent_foreground_color"},
		{"theme.background_color", "theme.foreground_color"},
		{"theme.surface_color", "theme.surface_foreground_color"},
		{"theme.card_color", "theme.card_foreground_color"},
		{"theme.popover_color", "theme.popover_foreground_color"},
		{"theme.muted_color", "theme.muted_foreground_color"},
		{"theme.success_color", "theme.success_foreground_color"},
		{"theme.warning_color", "theme.warning_foreground_color"},
		{"theme.destructive_color", "theme.destructive_foreground_color"},
		{"theme.info_color", "theme.info_foreground_color"},
	} {
		ratio := themeColorContrastRatio(byName[pair.background], byName[pair.foreground])
		if ratio < minimumThemeTextContrastRatio {
			return dbmodels.UpsertTenantThemeParams{}, rpcerrors.NewFieldViolationError(
				connect.CodeInvalidArgument,
				fmt.Errorf("%s and %s must have a contrast ratio of at least %.1f:1 (got %.2f:1)", pair.background, pair.foreground, minimumThemeTextContrastRatio, ratio),
				pair.background,
			)
		}
	}
	return dbmodels.UpsertTenantThemeParams{
		PrimaryColor:               normalized[0],
		SecondaryColor:             normalized[1],
		AccentColor:                normalized[2],
		BackgroundColor:            normalized[3],
		ForegroundColor:            normalized[4],
		SurfaceColor:               normalized[5],
		SurfaceForegroundColor:     normalized[6],
		CardColor:                  normalized[7],
		CardForegroundColor:        normalized[8],
		PopoverColor:               normalized[9],
		PopoverForegroundColor:     normalized[10],
		PrimaryForegroundColor:     normalized[11],
		SecondaryForegroundColor:   normalized[12],
		AccentForegroundColor:      normalized[13],
		MutedColor:                 normalized[14],
		MutedForegroundColor:       normalized[15],
		BorderColor:                normalized[16],
		InputColor:                 normalized[17],
		RingColor:                  normalized[18],
		SuccessColor:               normalized[19],
		SuccessForegroundColor:     normalized[20],
		WarningColor:               normalized[21],
		WarningForegroundColor:     normalized[22],
		DestructiveColor:           normalized[23],
		DestructiveForegroundColor: normalized[24],
		InfoColor:                  normalized[25],
		InfoForegroundColor:        normalized[26],
	}, nil
}

func (s *adminServer) GetTenantTheme(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantThemeRequest],
) (*connect.Response[publiraadminv1.GetTenantThemeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	theme, err := s.tenantTheme(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.GetTenantThemeResponse{Theme: theme}), nil
}

// tenantTheme reads the theme with the variants of both branding images. Every
// theme RPC answers through it, including the writes, so a saved color and a
// replaced image come back in the same shape a plain read returns.
func (s *adminServer) tenantTheme(ctx context.Context, tenantID uuid.UUID) (*publirattypesv1.TenantTheme, error) {
	row, err := s.queriesFor(ctx).GetTenantThemeByTenantID(ctx, tenantID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant theme", err, "tenant_id", tenantID.String())
	}

	imageIDs := make([]uuid.UUID, 0, 2)
	if row.IconImageID.Valid {
		imageIDs = append(imageIDs, row.IconImageID.UUID)
	}
	if row.LogoImageID.Valid {
		imageIDs = append(imageIDs, row.LogoImageID.UUID)
	}
	if len(imageIDs) == 0 {
		return protomapper.TenantThemeFromGetRow(row, nil, nil), nil
	}

	variantRows, err := s.queriesFor(ctx).ListTenantImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list tenant image variants", err, "tenant_id", tenantID.String())
	}
	byImageID := protomapper.TenantImageVariantsByImageID(variantRows)

	return protomapper.TenantThemeFromGetRow(
		row,
		byImageID[row.IconImageID.UUID],
		byImageID[row.LogoImageID.UUID],
	), nil
}

func themeRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:theme", normalizedTenantID),
	}
}

// themeBrandingRevalidateTags includes site chrome as well as the stylesheet:
// an icon or logo update changes both the theme response and metadata/header
// that read getTenantSiteInfo.
func themeBrandingRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:theme", normalizedTenantID),
		fmt.Sprintf("tenant:%s:site", normalizedTenantID),
	}
}

func (s *adminServer) UpsertTenantTheme(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpsertTenantThemeRequest],
) (*connect.Response[publiraadminv1.UpsertTenantThemeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	if req.Msg.Theme == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("theme is required"))
	}

	params, err := normalizeTenantTheme(req.Msg.Theme)
	if err != nil {
		return nil, err
	}
	params.TenantID = tenant.ID

	if _, err := s.queriesFor(ctx).UpsertTenantTheme(ctx, params); err != nil {
		return nil, s.internalDBError(ctx, "failed to upsert tenant theme", err, "tenant_id", tenant.ID.String())
	}

	theme, err := s.tenantTheme(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	if s.reval != nil {
		tags := themeRevalidateTags(tenant.ID.String())
		if err := s.reval.RevalidateTags(ctx, tags); err != nil {
			s.logger.Warn("failed to request next revalidate after theme upsert",
				"tenant_id", tenant.ID.String(),
				"tenant_public_id", tenant.PublicID,
				"tenant_domain", tenant.Domain,
				"revalidate_tags", tags,
				"error", err,
			)
		}
	}

	return connect.NewResponse(&publiraadminv1.UpsertTenantThemeResponse{Theme: theme}), nil
}

// tenantBrandingImage is the part of a branding image write that differs
// between the icon and the logo: where its objects live, which theme column
// holds the image in use, and which query points the theme at a new one.
// Everything else — the lock, the store, the swap, and the delete of the image
// left behind — is the same for both.
type tenantBrandingImage struct {
	// name goes into the log messages, so a failed write says which of the two
	// images it was.
	name           string
	variantType    string
	objectPrefix   string
	currentImageID func(dbmodels.GetTenantThemeByTenantIDRow) uuid.NullUUID
	setImageID     func(context.Context, Querier, uuid.UUID, uuid.NullUUID) (dbmodels.TenantTheme, error)
}

var tenantIconImage = tenantBrandingImage{
	name:         "icon",
	variantType:  imageproc.TenantVariantTypeIcon,
	objectPrefix: "icons",
	currentImageID: func(row dbmodels.GetTenantThemeByTenantIDRow) uuid.NullUUID {
		return row.IconImageID
	},
	setImageID: func(ctx context.Context, q Querier, tenantID uuid.UUID, imageID uuid.NullUUID) (dbmodels.TenantTheme, error) {
		return q.SetTenantThemeIconImage(ctx, dbmodels.SetTenantThemeIconImageParams{
			TenantID:    tenantID,
			IconImageID: imageID,
		})
	},
}

var tenantLogoImage = tenantBrandingImage{
	name:         "logo",
	variantType:  imageproc.TenantVariantTypeLogo,
	objectPrefix: "logos",
	currentImageID: func(row dbmodels.GetTenantThemeByTenantIDRow) uuid.NullUUID {
		return row.LogoImageID
	},
	setImageID: func(ctx context.Context, q Querier, tenantID uuid.UUID, imageID uuid.NullUUID) (dbmodels.TenantTheme, error) {
		return q.SetTenantThemeLogoImage(ctx, dbmodels.SetTenantThemeLogoImageParams{
			TenantID:    tenantID,
			LogoImageID: imageID,
		})
	},
}

// storeTenantBrandingImage uploads the normalized image and returns the tenant
// image it was stored as. A replace stores a new image rather than overwriting
// the old object, so the served URL changes and no client keeps serving the
// previous one from its cache.
func (s *adminServer) storeTenantBrandingImage(ctx context.Context, tenant dbmodels.Tenant, image tenantBrandingImage, variant imageproc.Variant) (uuid.UUID, error) {
	if s.storage == nil {
		return uuid.Nil, connect.NewError(connect.CodeInternal, errors.New("storage provider is not configured"))
	}

	tenantImageID, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, connect.NewError(connect.CodeInternal, err)
	}
	createdImage, err := s.queriesFor(ctx).CreateTenantImage(ctx, dbmodels.CreateTenantImageParams{
		ID:       tenantImageID,
		TenantID: tenant.ID,
	})
	if err != nil {
		return uuid.Nil, s.internalDBError(ctx, "failed to create tenant image", err, "tenant_id", tenant.ID.String())
	}

	objectKey := fmt.Sprintf("tenants/%s/%s/%s-%s%s", tenant.PublicID, image.objectPrefix, createdImage.ID.String(), variant.Label, variant.Extension)
	uploaded, err := s.storage.Upload(ctx, storage.UploadRequest{
		ObjectKey:   objectKey,
		ContentType: variant.ContentType,
		Data:        variant.Data,
	})
	if err != nil {
		return uuid.Nil, storageUploadError(err)
	}

	variantID, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, connect.NewError(connect.CodeInternal, err)
	}
	if _, err := s.queriesFor(ctx).CreateTenantImageVariant(ctx, dbmodels.CreateTenantImageVariantParams{
		ID:              variantID,
		TenantID:        tenant.ID,
		TenantImageID:   createdImage.ID,
		Label:           variant.Label,
		VariantType:     image.variantType,
		StorageProvider: uploaded.Provider,
		ObjectKey:       uploaded.ObjectKey,
		ContentType:     variant.ContentType,
		FileSizeBytes:   uploaded.SizeBytes,
		Width:           int32(variant.Width),
		Height:          int32(variant.Height),
	}); err != nil {
		return uuid.Nil, s.internalDBError(ctx, "failed to create tenant image variant", err, "tenant_id", tenant.ID.String(), "tenant_image_id", createdImage.ID.String())
	}

	return createdImage.ID, nil
}

// applyTenantBrandingImage points the tenant theme at variant, or clears the
// slot when it is nil, and drops the tenant image the theme pointed at before.
// The writes share one tenant-scoped transaction, so a failure never leaves the
// theme referencing an image whose variant row was not written.
//
// The tenant row is locked before the image in use is read. Two concurrent
// changes would otherwise read the same previous image, and whichever commits
// last would leave the image the other stored behind with nothing pointing at
// it.
func (s *adminServer) applyTenantBrandingImage(ctx context.Context, tenant dbmodels.Tenant, image tenantBrandingImage, variant *imageproc.Variant) (*publirattypesv1.TenantTheme, error) {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant "+image.name+" transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	if _, err := s.queriesFor(txCtx).LockTenantForUpdate(txCtx, tenant.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock tenant for "+image.name+" change", err, "tenant_id", tenant.ID.String())
	}

	current, err := s.queriesFor(txCtx).GetTenantThemeByTenantID(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant theme", err, "tenant_id", tenant.ID.String())
	}

	imageID := uuid.NullUUID{}
	if variant != nil {
		storedImageID, storeErr := s.storeTenantBrandingImage(txCtx, tenant, image, *variant)
		if storeErr != nil {
			return nil, storeErr
		}
		imageID = uuid.NullUUID{UUID: storedImageID, Valid: true}
	}

	if _, err := image.setImageID(txCtx, s.queriesFor(txCtx), tenant.ID, imageID); err != nil {
		return nil, s.internalDBError(ctx, "failed to set tenant "+image.name, err, "tenant_id", tenant.ID.String())
	}

	if previous := image.currentImageID(current); previous.Valid {
		if err := s.queriesFor(txCtx).DeleteTenantImage(txCtx, dbmodels.DeleteTenantImageParams{
			ID:       previous.UUID,
			TenantID: tenant.ID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to delete replaced tenant "+image.name+" image", err, "tenant_id", tenant.ID.String(), "tenant_image_id", previous.UUID.String())
		}
	}

	// Read the theme back inside the transaction: the variants of the image just
	// stored are only visible there until the commit, and the response has to
	// carry them.
	theme, err := s.tenantTheme(txCtx, tenant.ID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant "+image.name+" change", err, "tenant_id", tenant.ID.String())
	}

	if s.reval != nil {
		tags := themeBrandingRevalidateTags(tenant.ID.String())
		if err := s.reval.RevalidateTags(ctx, tags); err != nil {
			s.logger.Warn("failed to request next revalidate after tenant "+image.name+" change",
				"tenant_id", tenant.ID.String(),
				"tenant_public_id", tenant.PublicID,
				"tenant_domain", tenant.Domain,
				"revalidate_tags", tags,
				"error", err,
			)
		}
	}

	return theme, nil
}

func (s *adminServer) UploadTenantIcon(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UploadTenantIconRequest],
) (*connect.Response[publiraadminv1.UploadTenantIconResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	variant, err := imageproc.BuildIcon(req.Msg.IconData, req.Msg.IconContentType)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "icon_data")
	}

	theme, err := s.applyTenantBrandingImage(ctx, tenant, tenantIconImage, &variant)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.UploadTenantIconResponse{Theme: theme}), nil
}

func (s *adminServer) DeleteTenantIcon(
	ctx context.Context,
	req *connect.Request[publiraadminv1.DeleteTenantIconRequest],
) (*connect.Response[publiraadminv1.DeleteTenantIconResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	theme, err := s.applyTenantBrandingImage(ctx, tenant, tenantIconImage, nil)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.DeleteTenantIconResponse{Theme: theme}), nil
}

func (s *adminServer) UploadTenantLogo(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UploadTenantLogoRequest],
) (*connect.Response[publiraadminv1.UploadTenantLogoResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	variant, err := imageproc.BuildLogo(req.Msg.LogoData, req.Msg.LogoContentType)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "logo_data")
	}

	theme, err := s.applyTenantBrandingImage(ctx, tenant, tenantLogoImage, &variant)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.UploadTenantLogoResponse{Theme: theme}), nil
}

func (s *adminServer) DeleteTenantLogo(
	ctx context.Context,
	req *connect.Request[publiraadminv1.DeleteTenantLogoRequest],
) (*connect.Response[publiraadminv1.DeleteTenantLogoResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	theme, err := s.applyTenantBrandingImage(ctx, tenant, tenantLogoImage, nil)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.DeleteTenantLogoResponse{Theme: theme}), nil
}
