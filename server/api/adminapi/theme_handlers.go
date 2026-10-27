package adminapi

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/ownerimages"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

var hexColorCodePattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

const maximumTenantThemeFontFamilyLength = 512

// An unquoted CSS family name is a sequence of CSS identifiers. Escapes are
// deliberately not accepted: the stored value is written into a stylesheet
// verbatim, and accepting a smaller grammar keeps that boundary auditable.
var unquotedFontFamilyPattern = regexp.MustCompile(`^[\p{L}_-][\p{L}\p{N}_\-\p{Zs}]*$`)

// WCAG AA requires 4.5:1 contrast for normal text. Theme foreground tokens
// are used for text, including compact labels, so the stricter text threshold
// protects each rendered pair rather than relying on a component's size.
const minimumThemeTextContrastRatio = 4.5

func validateHexColorCode(value string, fieldName string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if !hexColorCodePattern.MatchString(trimmed) {
		return "", connect.NewError(connect.CodeInvalidArgument, fieldName+" must be a hex color code in #RRGGBB format")
	}
	return strings.ToLower(trimmed), nil
}

func validateTenantThemeFontFamily(value string, fieldName string) (string, error) {
	trimmed := strings.TrimSpace(value)
	invalid := func() (string, error) {
		return "", rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			errors.New(fieldName+" must be a CSS font-family list"),
			fieldName,
		)
	}
	if trimmed == "" {
		return "", nil
	}
	if len(trimmed) > maximumTenantThemeFontFamilyLength {
		return invalid()
	}

	var families []string
	var family strings.Builder
	var quote rune
	for _, char := range trimmed {
		if unicode.IsControl(char) || strings.ContainsRune(";{}()/\\<>@", char) {
			return invalid()
		}
		switch char {
		case '\'', '"':
			switch quote {
			case 0:
				quote = char
			case char:
				quote = 0
			}
		case ',':
			if quote == 0 {
				families = append(families, strings.TrimSpace(family.String()))
				family.Reset()
				continue
			}
		}
		family.WriteRune(char)
	}
	if quote != 0 {
		return invalid()
	}
	families = append(families, strings.TrimSpace(family.String()))

	for _, family := range families {
		if family == "" {
			return invalid()
		}
		if first := family[0]; first == '\'' || first == '"' {
			if len(family) < 3 || family[len(family)-1] != first || strings.TrimSpace(family[1:len(family)-1]) == "" {
				return invalid()
			}
			continue
		}
		if !unquotedFontFamilyPattern.MatchString(family) {
			return invalid()
		}
	}

	return trimmed, nil
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

// themeColors is what the light palette (TenantTheme) and the dark one
// (TenantThemePalette) have in common: the same colors under the same names.
type themeColors interface {
	GetPrimaryColor() string
	GetSecondaryColor() string
	GetAccentColor() string
	GetBackgroundColor() string
	GetForegroundColor() string
	GetSurfaceColor() string
	GetSurfaceForegroundColor() string
	GetCardColor() string
	GetCardForegroundColor() string
	GetPopoverColor() string
	GetPopoverForegroundColor() string
	GetPrimaryForegroundColor() string
	GetSecondaryForegroundColor() string
	GetAccentForegroundColor() string
	GetMutedColor() string
	GetMutedForegroundColor() string
	GetBorderColor() string
	GetInputColor() string
	GetRingColor() string
	GetSuccessColor() string
	GetSuccessForegroundColor() string
	GetWarningColor() string
	GetWarningForegroundColor() string
	GetDestructiveColor() string
	GetDestructiveForegroundColor() string
	GetInfoColor() string
	GetInfoForegroundColor() string
}

// normalizeThemeColors validates a palette and returns its colors lowercased,
// in the order of themeColors. A violation names the field under prefix, the
// request field the palette arrived in.
func normalizeThemeColors(colors themeColors, prefix string) ([]string, error) {
	type colorField struct {
		value string
		name  string
	}
	fields := []colorField{
		{colors.GetPrimaryColor(), "primary_color"},
		{colors.GetSecondaryColor(), "secondary_color"},
		{colors.GetAccentColor(), "accent_color"},
		{colors.GetBackgroundColor(), "background_color"},
		{colors.GetForegroundColor(), "foreground_color"},
		{colors.GetSurfaceColor(), "surface_color"},
		{colors.GetSurfaceForegroundColor(), "surface_foreground_color"},
		{colors.GetCardColor(), "card_color"},
		{colors.GetCardForegroundColor(), "card_foreground_color"},
		{colors.GetPopoverColor(), "popover_color"},
		{colors.GetPopoverForegroundColor(), "popover_foreground_color"},
		{colors.GetPrimaryForegroundColor(), "primary_foreground_color"},
		{colors.GetSecondaryForegroundColor(), "secondary_foreground_color"},
		{colors.GetAccentForegroundColor(), "accent_foreground_color"},
		{colors.GetMutedColor(), "muted_color"},
		{colors.GetMutedForegroundColor(), "muted_foreground_color"},
		{colors.GetBorderColor(), "border_color"},
		{colors.GetInputColor(), "input_color"},
		{colors.GetRingColor(), "ring_color"},
		{colors.GetSuccessColor(), "success_color"},
		{colors.GetSuccessForegroundColor(), "success_foreground_color"},
		{colors.GetWarningColor(), "warning_color"},
		{colors.GetWarningForegroundColor(), "warning_foreground_color"},
		{colors.GetDestructiveColor(), "destructive_color"},
		{colors.GetDestructiveForegroundColor(), "destructive_foreground_color"},
		{colors.GetInfoColor(), "info_color"},
		{colors.GetInfoForegroundColor(), "info_foreground_color"},
	}
	normalized := make([]string, len(fields))
	byName := make(map[string]string, len(fields))
	for i, f := range fields {
		v, err := validateHexColorCode(f.value, prefix+"."+f.name)
		if err != nil {
			return nil, err
		}
		normalized[i] = v
		byName[f.name] = v
	}
	for _, pair := range []struct {
		background string
		foreground string
	}{
		{"primary_color", "primary_foreground_color"},
		{"secondary_color", "secondary_foreground_color"},
		{"accent_color", "accent_foreground_color"},
		{"background_color", "foreground_color"},
		{"surface_color", "surface_foreground_color"},
		{"card_color", "card_foreground_color"},
		{"popover_color", "popover_foreground_color"},
		{"muted_color", "muted_foreground_color"},
		{"success_color", "success_foreground_color"},
		{"warning_color", "warning_foreground_color"},
		{"destructive_color", "destructive_foreground_color"},
		{"info_color", "info_foreground_color"},
	} {
		ratio := themeColorContrastRatio(byName[pair.background], byName[pair.foreground])
		if ratio < minimumThemeTextContrastRatio {
			background := prefix + "." + pair.background
			foreground := prefix + "." + pair.foreground
			return nil, rpcerrors.NewFieldViolationError(
				connect.CodeInvalidArgument,
				fmt.Errorf("%s and %s must have a contrast ratio of at least %.1f:1 (got %.2f:1)", background, foreground, minimumThemeTextContrastRatio, ratio),
				background,
			)
		}
	}
	return normalized, nil
}

func normalizeTenantTheme(theme *publirattypesv1.TenantTheme) (dbmodels.UpsertTenantThemeParams, error) {
	normalized, err := normalizeThemeColors(theme, "theme")
	if err != nil {
		return dbmodels.UpsertTenantThemeParams{}, err
	}
	serifFontFamily, err := validateTenantThemeFontFamily(theme.SerifFontFamily, "theme.serif_font_family")
	if err != nil {
		return dbmodels.UpsertTenantThemeParams{}, err
	}
	sansFontFamily, err := validateTenantThemeFontFamily(theme.SansFontFamily, "theme.sans_font_family")
	if err != nil {
		return dbmodels.UpsertTenantThemeParams{}, err
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
		SerifFontFamily:            serifFontFamily,
		SansFontFamily:             sansFontFamily,
	}, nil
}

func (s *adminServer) GetTenantTheme(
	ctx context.Context,
	req *publiraadminv1.GetTenantThemeRequest,
) (*publiraadminv1.GetTenantThemeResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}

	theme, err := s.tenantTheme(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	return &publiraadminv1.GetTenantThemeResponse{Theme: theme}, nil
}

// tenantTheme reads the theme with the variants of its branding images. Every
// theme RPC answers through it, including the writes, so a saved color and a
// replaced image come back in the same shape a plain read returns.
func (s *adminServer) tenantTheme(ctx context.Context, tenantID uuid.UUID) (*publirattypesv1.TenantTheme, error) {
	row, err := s.queriesFor(ctx).GetTenantThemeByTenantID(ctx, tenantID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant theme", err, "tenant_id", tenantID.String())
	}

	imageIDs := make([]uuid.UUID, 0, 3)
	for _, imageID := range []uuid.NullUUID{row.IconImageID, row.LogoImageID, row.SignInImageID} {
		if imageID.Valid {
			imageIDs = append(imageIDs, imageID.UUID)
		}
	}
	if len(imageIDs) == 0 {
		return protomapper.TenantThemeFromGetRow(row, nil, nil, nil), nil
	}

	variantRows, err := s.queriesFor(ctx).ListTenantImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list tenant image variants", err, "tenant_id", tenantID.String())
	}
	byImageID := protomapper.TenantImageVariantsByImageID(protomapper.HostRelative, variantRows)

	return protomapper.TenantThemeFromGetRow(
		row,
		byImageID[row.IconImageID.UUID],
		byImageID[row.LogoImageID.UUID],
		byImageID[row.SignInImageID.UUID],
	), nil
}

func themeRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:theme", normalizedTenantID),
	}
}

// themeBrandingRevalidateTags includes site chrome as well as the stylesheet:
// a branding image update changes both the theme response and the metadata,
// header, and sign-in panel that read getTenantSiteInfo.
func themeBrandingRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:theme", normalizedTenantID),
		fmt.Sprintf("tenant:%s:site", normalizedTenantID),
	}
}

func (s *adminServer) UpsertTenantTheme(
	ctx context.Context,
	req *publiraadminv1.UpsertTenantThemeRequest,
) (*publiraadminv1.UpsertTenantThemeResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if req.Theme == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "theme is required")
	}

	params, err := normalizeTenantTheme(req.Theme)
	if err != nil {
		return nil, err
	}
	params.TenantID = tenant.ID

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		if _, err := s.queriesFor(txCtx).LockTenantForUpdate(txCtx, tenant.ID); err != nil {
			return nil, s.internalDBError(ctx, "failed to lock tenant for theme change", err, "tenant_id", tenant.ID.String())
		}
		current, err := s.queriesFor(txCtx).GetTenantThemeByTenantID(txCtx, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to get tenant theme", err, "tenant_id", tenant.ID.String())
		}
		if tenantThemeParamsFromRow(current) == params {
			return nil, nil
		}
		if _, err := s.queriesFor(txCtx).UpsertTenantTheme(txCtx, params); err != nil {
			return nil, s.internalDBError(ctx, "failed to upsert tenant theme", err, "tenant_id", tenant.ID.String())
		}
		if err := s.writeTenantSettingAudit(txCtx, tenant, session, "tenant_theme_updated", "tenant_branding"); err != nil {
			return nil, err
		}
		return themeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}

	theme, err := s.tenantTheme(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	return &publiraadminv1.UpsertTenantThemeResponse{Theme: theme}, nil
}

// tenantThemeParamsFromRow is the save that would store the theme row as it is
// read, defaults included, so comparing a save against it tells whether the
// save changes anything the console shows.
func tenantThemeParamsFromRow(row dbmodels.GetTenantThemeByTenantIDRow) dbmodels.UpsertTenantThemeParams {
	return dbmodels.UpsertTenantThemeParams{
		TenantID:                   row.TenantID,
		BackgroundColor:            row.BackgroundColor,
		ForegroundColor:            row.ForegroundColor,
		SurfaceColor:               row.SurfaceColor,
		SurfaceForegroundColor:     row.SurfaceForegroundColor,
		CardColor:                  row.CardColor,
		CardForegroundColor:        row.CardForegroundColor,
		PopoverColor:               row.PopoverColor,
		PopoverForegroundColor:     row.PopoverForegroundColor,
		PrimaryColor:               row.PrimaryColor,
		PrimaryForegroundColor:     row.PrimaryForegroundColor,
		SecondaryColor:             row.SecondaryColor,
		SecondaryForegroundColor:   row.SecondaryForegroundColor,
		AccentColor:                row.AccentColor,
		AccentForegroundColor:      row.AccentForegroundColor,
		MutedColor:                 row.MutedColor,
		MutedForegroundColor:       row.MutedForegroundColor,
		BorderColor:                row.BorderColor,
		InputColor:                 row.InputColor,
		RingColor:                  row.RingColor,
		SuccessColor:               row.SuccessColor,
		SuccessForegroundColor:     row.SuccessForegroundColor,
		WarningColor:               row.WarningColor,
		WarningForegroundColor:     row.WarningForegroundColor,
		DestructiveColor:           row.DestructiveColor,
		DestructiveForegroundColor: row.DestructiveForegroundColor,
		InfoColor:                  row.InfoColor,
		InfoForegroundColor:        row.InfoForegroundColor,
		SerifFontFamily:            row.SerifFontFamily,
		SansFontFamily:             row.SansFontFamily,
	}
}

// tenantBrandingImage is the part of a branding image write that differs
// between the icon, the logo, and the sign-in image: where its objects live,
// which theme column holds the image in use, and which query points the theme
// at a new one. Everything else — the lock, the store, the swap, and the delete
// of the image left behind — is the same for all of them.
type tenantBrandingImage struct {
	// name goes into the log messages, so a failed write says which of the
	// images it was.
	name   string
	images ownerimages.Owner[Querier]
	// uploadedAction and deletedAction are what the audit log records the
	// change as.
	uploadedAction string
	deletedAction  string
	currentImageID func(dbmodels.GetTenantThemeByTenantIDRow) uuid.NullUUID
	setImageID     func(context.Context, Querier, uuid.UUID, uuid.NullUUID) (dbmodels.TenantTheme, error)
}

var tenantIconImage = tenantBrandingImage{
	name:           "icon",
	images:         tenantBrandingImagesIn("icons"),
	uploadedAction: "tenant_icon_uploaded",
	deletedAction:  "tenant_icon_deleted",
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
	name:           "logo",
	images:         tenantBrandingImagesIn("logos"),
	uploadedAction: "tenant_logo_uploaded",
	deletedAction:  "tenant_logo_deleted",
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

var tenantSignInImage = tenantBrandingImage{
	name:           "sign-in image",
	images:         tenantBrandingImagesIn("sign-in-images"),
	uploadedAction: "tenant_sign_in_image_uploaded",
	deletedAction:  "tenant_sign_in_image_deleted",
	currentImageID: func(row dbmodels.GetTenantThemeByTenantIDRow) uuid.NullUUID {
		return row.SignInImageID
	},
	setImageID: func(ctx context.Context, q Querier, tenantID uuid.UUID, imageID uuid.NullUUID) (dbmodels.TenantTheme, error) {
		return q.SetTenantThemeSignInImage(ctx, dbmodels.SetTenantThemeSignInImageParams{
			TenantID:      tenantID,
			SignInImageID: imageID,
		})
	},
}

// applyTenantBrandingImage points the tenant theme at variant, or clears the
// slot when it is nil, and drops the tenant image the theme pointed at before.
// The writes share one tenant-scoped transaction, so a failure never leaves the
// theme referencing an image whose variant row was not written.
//
// The tenant row is locked before the image in use is read. Two concurrent
// changes would otherwise read the same previous image, and whichever commits
// last would leave the image the other stored behind with nothing pointing at
// it. Deleting an image the tenant does not have writes nothing and records
// nothing, and answers the theme as it is.
func (s *adminServer) applyTenantBrandingImage(ctx context.Context, tenant dbmodels.Tenant, session rpcmiddleware.SessionContext, image tenantBrandingImage, variant *imageproc.Variant) (*publirattypesv1.TenantTheme, error) {
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
	previous := image.currentImageID(current)
	if variant == nil && !previous.Valid {
		return s.tenantTheme(txCtx, tenant.ID)
	}

	imageID := uuid.NullUUID{}
	if variant != nil {
		// A replace stores a new image rather than overwriting the old object,
		// so the served URL changes and no client keeps serving the previous
		// one from its cache.
		storedImageID, storeErr := s.storeOwnerImage(txCtx, image.images, ownerImageRef(tenant, uuid.Nil, ""), []imageproc.Variant{*variant})
		if storeErr != nil {
			return nil, storeErr
		}
		imageID = uuid.NullUUID{UUID: storedImageID, Valid: true}
	}

	if _, err := image.setImageID(txCtx, s.queriesFor(txCtx), tenant.ID, imageID); err != nil {
		return nil, s.internalDBError(ctx, "failed to set tenant "+image.name, err, "tenant_id", tenant.ID.String())
	}

	if previous.Valid {
		if err := s.queriesFor(txCtx).DeleteTenantImage(txCtx, dbmodels.DeleteTenantImageParams{
			ID:       previous.UUID,
			TenantID: tenant.ID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to delete replaced tenant "+image.name+" image", err, "tenant_id", tenant.ID.String(), "tenant_image_id", previous.UUID.String())
		}
	}

	action := image.deletedAction
	if variant != nil {
		action = image.uploadedAction
	}
	if err := s.writeTenantSettingAudit(txCtx, tenant, session, action, "tenant_branding"); err != nil {
		return nil, err
	}

	// Read the theme back inside the transaction: the variants of the image just
	// stored are only visible there until the commit, and the response has to
	// carry them.
	theme, err := s.tenantTheme(txCtx, tenant.ID)
	if err != nil {
		return nil, err
	}

	owed, err := s.recordRevalidation(txCtx, tenant.ID, themeBrandingRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the tenant "+image.name+" change", err, "tenant_id", tenant.ID.String())
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant "+image.name+" change", err, "tenant_id", tenant.ID.String())
	}

	s.reval.Send(ctx, owed)

	return theme, nil
}

func (s *adminServer) UploadTenantIcon(
	ctx context.Context,
	req *publiraadminv1.UploadTenantIconRequest,
) (*publiraadminv1.UploadTenantIconResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	variant, err := imageproc.BuildIcon(req.IconData, req.IconContentType)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "icon_data")
	}

	theme, err := s.applyTenantBrandingImage(ctx, tenant, session, tenantIconImage, &variant)
	if err != nil {
		return nil, err
	}

	return &publiraadminv1.UploadTenantIconResponse{Theme: theme}, nil
}

func (s *adminServer) DeleteTenantIcon(
	ctx context.Context,
	req *publiraadminv1.DeleteTenantIconRequest,
) (*publiraadminv1.DeleteTenantIconResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	theme, err := s.applyTenantBrandingImage(ctx, tenant, session, tenantIconImage, nil)
	if err != nil {
		return nil, err
	}

	return &publiraadminv1.DeleteTenantIconResponse{Theme: theme}, nil
}

func (s *adminServer) UploadTenantLogo(
	ctx context.Context,
	req *publiraadminv1.UploadTenantLogoRequest,
) (*publiraadminv1.UploadTenantLogoResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	variant, err := imageproc.BuildLogo(req.LogoData, req.LogoContentType)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "logo_data")
	}

	theme, err := s.applyTenantBrandingImage(ctx, tenant, session, tenantLogoImage, &variant)
	if err != nil {
		return nil, err
	}

	return &publiraadminv1.UploadTenantLogoResponse{Theme: theme}, nil
}

func (s *adminServer) DeleteTenantLogo(
	ctx context.Context,
	req *publiraadminv1.DeleteTenantLogoRequest,
) (*publiraadminv1.DeleteTenantLogoResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	theme, err := s.applyTenantBrandingImage(ctx, tenant, session, tenantLogoImage, nil)
	if err != nil {
		return nil, err
	}

	return &publiraadminv1.DeleteTenantLogoResponse{Theme: theme}, nil
}

func (s *adminServer) UploadTenantSignInImage(
	ctx context.Context,
	req *publiraadminv1.UploadTenantSignInImageRequest,
) (*publiraadminv1.UploadTenantSignInImageResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	variant, err := imageproc.BuildSignInImage(req.ImageData, req.ImageContentType)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "image_data")
	}

	theme, err := s.applyTenantBrandingImage(ctx, tenant, session, tenantSignInImage, &variant)
	if err != nil {
		return nil, err
	}

	return &publiraadminv1.UploadTenantSignInImageResponse{Theme: theme}, nil
}

func (s *adminServer) DeleteTenantSignInImage(
	ctx context.Context,
	req *publiraadminv1.DeleteTenantSignInImageRequest,
) (*publiraadminv1.DeleteTenantSignInImageResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	theme, err := s.applyTenantBrandingImage(ctx, tenant, session, tenantSignInImage, nil)
	if err != nil {
		return nil, err
	}

	return &publiraadminv1.DeleteTenantSignInImageResponse{Theme: theme}, nil
}
