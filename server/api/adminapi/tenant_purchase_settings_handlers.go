package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"unicode"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// tenantPurchaseSettingsRevalidateTags names the public caches that carry the
// settings: the tenant read with the store listings, and the series detail
// every cached episode read is tagged with, whose episodes carry where they
// may be bought and the amounts a reader may tip in.
func tenantPurchaseSettingsRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:site", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
	}
}

// normalizeStoreURL trims a store listing URL and answers NULL for an empty
// one. The listing is a link the storefront hands a reader, so it has to be an
// absolute https:// URL; a query is allowed because a Google Play listing names
// its app in one.
func normalizeStoreURL(value string) (sql.NullString, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullString{}, nil
	}
	if strings.IndexFunc(trimmed, unicode.IsSpace) >= 0 {
		return sql.NullString{}, errors.New("store URL must not contain whitespace")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return sql.NullString{}, errors.New("store URL must be an https:// URL")
	}
	return sql.NullString{String: trimmed, Valid: true}, nil
}

// maxTipAmounts is how many amounts a tenant may offer a reader to tip in,
// which tenant_config_tip_amounts_check holds the column to as well.
const maxTipAmounts = 6

// normalizeTipSettings checks the tips a request asks for and answers their
// amounts in ascending order, which is the order a reader is offered them in.
func normalizeTipSettings(tips *publiraadminv1.TenantTipSettings) ([]int32, error) {
	amounts := slices.Clone(tips.GetAmounts())
	if len(amounts) > maxTipAmounts {
		return nil, fmt.Errorf("at most %d tip amounts may be offered", maxTipAmounts)
	}
	if tips.GetEnabled() && len(amounts) == 0 {
		return nil, errors.New("tips need at least one amount to be on")
	}
	slices.Sort(amounts)
	for i, amount := range amounts {
		if amount <= 0 {
			return nil, errors.New("a tip amount must be above 0")
		}
		if i > 0 && amounts[i-1] == amount {
			return nil, errors.New("a tip amount must not be repeated")
		}
	}
	if amounts == nil {
		amounts = []int32{}
	}
	return amounts, nil
}

func tenantPurchaseSettingsFromConfig(config dbmodels.TenantConfig) (*publiraadminv1.TenantPurchaseSettings, error) {
	availability, err := protomapper.SurfaceAvailabilityFromStored(config.PurchaseAvailability)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.TenantPurchaseSettings{
		PurchaseAvailability: availability,
		AppStoreUrl:          config.AppStoreUrl.String,
		GooglePlayUrl:        config.GooglePlayUrl.String,
		Tips: &publiraadminv1.TenantTipSettings{
			Enabled: config.TipsEnabled,
			Amounts: config.TipAmounts,
		},
	}, nil
}

func (s *adminServer) GetTenantPurchaseSettings(
	ctx context.Context,
	req *publiraadminv1.GetTenantPurchaseSettingsRequest,
) (*publiraadminv1.GetTenantPurchaseSettingsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// A tenant with no config row sells on both surfaces and lists no
			// app, which is what the columns' own defaults say too.
			return &publiraadminv1.GetTenantPurchaseSettingsResponse{
				Settings: &publiraadminv1.TenantPurchaseSettings{
					PurchaseAvailability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_ALL,
					Tips:                 &publiraadminv1.TenantTipSettings{Amounts: []int32{}},
				},
			}, nil
		}
		return nil, s.internalDBError(ctx, "failed to get tenant purchase settings", err, "tenant_id", tenant.ID.String())
	}

	settings, err := tenantPurchaseSettingsFromConfig(config)
	if err != nil {
		return nil, s.internalError(ctx, "tenant purchase availability is not a supported value", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.GetTenantPurchaseSettingsResponse{Settings: settings}, nil
}

func (s *adminServer) UpdateTenantPurchaseSettings(
	ctx context.Context,
	req *publiraadminv1.UpdateTenantPurchaseSettingsRequest,
) (*publiraadminv1.UpdateTenantPurchaseSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	requested := req.GetSettings()
	availability, err := protomapper.SeriesSurfaceAvailabilityToStored(requested.GetPurchaseAvailability())
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.purchase_availability")
	}
	appStoreURL, err := normalizeStoreURL(requested.GetAppStoreUrl())
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.app_store_url")
	}
	googlePlayURL, err := normalizeStoreURL(requested.GetGooglePlayUrl())
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.google_play_url")
	}
	// A client that predates tips sends none, and leaves the tenant's as they
	// are rather than turning them off.
	var tipAmounts []int32
	if requested.GetTips() != nil {
		tipAmounts, err = normalizeTipSettings(requested.GetTips())
		if err != nil {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.tips.amounts")
		}
	}

	var updated dbmodels.TenantConfig
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		current, err := s.lockTenantConfig(txCtx, tenant.ID)
		if err != nil {
			return nil, err
		}
		updated = current
		changed := false
		if current.PurchaseAvailability != availability ||
			current.AppStoreUrl != appStoreURL ||
			current.GooglePlayUrl != googlePlayURL {
			row, err := s.queriesFor(txCtx).UpsertTenantPurchaseSettings(txCtx, dbmodels.UpsertTenantPurchaseSettingsParams{
				TenantID:             tenant.ID,
				PurchaseAvailability: availability,
				AppStoreUrl:          appStoreURL,
				GooglePlayUrl:        googlePlayURL,
			})
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to update tenant purchase settings", err, "tenant_id", tenant.ID.String())
			}
			updated = row
			changed = true
			if err := s.writeTenantSettingAudit(txCtx, tenant, session, "tenant_purchase_settings_updated", "tenant_purchase_settings"); err != nil {
				return nil, err
			}
		}
		if tipAmounts != nil && (current.TipsEnabled != requested.GetTips().GetEnabled() || !slices.Equal(current.TipAmounts, tipAmounts)) {
			row, err := s.queriesFor(txCtx).UpsertTenantTipSettings(txCtx, dbmodels.UpsertTenantTipSettingsParams{
				TenantID:    tenant.ID,
				TipsEnabled: requested.GetTips().GetEnabled(),
				TipAmounts:  tipAmounts,
			})
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to update tenant tip settings", err, "tenant_id", tenant.ID.String())
			}
			updated = row
			changed = true
			if err := s.writeTenantSettingAudit(txCtx, tenant, session, "tenant_tip_settings_updated", "tenant_tip_settings"); err != nil {
				return nil, err
			}
		}
		if !changed {
			return nil, nil
		}
		return tenantPurchaseSettingsRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}

	settings, err := tenantPurchaseSettingsFromConfig(updated)
	if err != nil {
		return nil, s.internalError(ctx, "tenant purchase availability is not a supported value", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.UpdateTenantPurchaseSettingsResponse{Settings: settings}, nil
}
