package adminapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googletag"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// tenantAnalyticsSettingsRevalidateTags names the storefront read that carries
// the Google tag and the site verification codes,
// TenantService.GetTenantAnalyticsSettings.
func tenantAnalyticsSettingsRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:analytics-settings", strings.TrimSpace(tenantID))}
}

func (s *adminServer) tenantAnalyticsSettingsToProto(
	ctx context.Context,
	tenantID uuid.UUID,
	settings googletag.Settings,
) (*publiraadminv1.TenantAnalyticsSettings, error) {
	mode, err := protomapper.GoogleTagServingModeFromStored(settings.ServingMode)
	if err != nil {
		return nil, s.internalError(ctx, "tenant analytics serving mode is not a supported mode", err, "tenant_id", tenantID.String())
	}
	return &publiraadminv1.TenantAnalyticsSettings{
		Ga4MeasurementId:   settings.GA4MeasurementID,
		GtmContainerId:     settings.GTMContainerID,
		ServingMode:        mode,
		ServerContainerUrl: settings.ServerContainerURL,
		GatewayPath:        settings.GatewayPath,
	}, nil
}

// normalizeTenantAnalyticsSettings validates a requested save and answers it
// ready to store, with the gateway path left for the caller to decide.
func normalizeTenantAnalyticsSettings(requested *publiraadminv1.TenantAnalyticsSettings) (googletag.Settings, error) {
	measurementID, err := googletag.NormalizeMeasurementID(requested.GetGa4MeasurementId())
	if err != nil {
		return googletag.Settings{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.ga4_measurement_id")
	}
	containerID, err := googletag.NormalizeContainerID(requested.GetGtmContainerId())
	if err != nil {
		return googletag.Settings{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.gtm_container_id")
	}
	mode, err := protomapper.GoogleTagServingModeToStored(requested.GetServingMode())
	if err != nil {
		return googletag.Settings{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.serving_mode")
	}
	serverContainerURL, err := googletag.NormalizeServerContainerURL(requested.GetServerContainerUrl())
	if err != nil {
		return googletag.Settings{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.server_container_url")
	}
	if mode == googletag.ServingModeServerContainer && serverContainerURL == "" {
		return googletag.Settings{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument,
			googletag.ErrServerContainerURLRequired, "settings.server_container_url")
	}
	return googletag.Settings{
		GA4MeasurementID:   measurementID,
		GTMContainerID:     containerID,
		ServingMode:        mode,
		ServerContainerURL: serverContainerURL,
	}, nil
}

// lockTenantAnalyticsSettings locks the tenant's settings in the transaction
// txCtx carries and answers them, googletag.Default for a tenant that has
// saved nothing.
func (s *adminServer) lockTenantAnalyticsSettings(txCtx context.Context, tenantID uuid.UUID) (googletag.Settings, error) {
	queries := s.queriesFor(txCtx)
	if _, err := queries.LockTenantForAnalyticsSettings(txCtx, tenantID); err != nil {
		return googletag.Settings{}, s.internalDBError(txCtx, "failed to lock tenant analytics settings", err, "tenant_id", tenantID.String())
	}
	settings, err := googletag.Get(txCtx, queries, tenantID)
	if errors.Is(err, googletag.ErrUnresolvedServingMode) {
		return googletag.Settings{}, s.internalError(txCtx, "tenant analytics serving mode is not a supported mode", err, "tenant_id", tenantID.String())
	}
	if err != nil {
		return googletag.Settings{}, s.internalDBError(txCtx, "failed to get tenant analytics settings", err, "tenant_id", tenantID.String())
	}
	return settings, nil
}

func (s *adminServer) GetTenantAnalyticsSettings(
	ctx context.Context,
	req *publiraadminv1.GetTenantAnalyticsSettingsRequest,
) (*publiraadminv1.GetTenantAnalyticsSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	settings, err := googletag.Get(ctx, s.queriesFor(ctx), tenant.ID)
	if err != nil {
		if errors.Is(err, googletag.ErrUnresolvedServingMode) {
			return nil, s.internalError(ctx, "tenant analytics serving mode is not a supported mode", err, "tenant_id", tenant.ID.String())
		}
		return nil, s.internalDBError(ctx, "failed to get tenant analytics settings", err, "tenant_id", tenant.ID.String())
	}
	message, err := s.tenantAnalyticsSettingsToProto(ctx, tenant.ID, settings)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.GetTenantAnalyticsSettingsResponse{Settings: message}, nil
}

func (s *adminServer) UpdateTenantAnalyticsSettings(
	ctx context.Context,
	req *publiraadminv1.UpdateTenantAnalyticsSettingsRequest,
) (*publiraadminv1.UpdateTenantAnalyticsSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if req.Settings == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "settings is required")
	}
	next, err := normalizeTenantAnalyticsSettings(req.Settings)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant analytics settings transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	qtx := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, qtx)

	current, err := s.lockTenantAnalyticsSettings(txCtx, tenant.ID)
	if err != nil {
		return nil, err
	}
	// The path outlives a switch to another mode, so switching back serves the
	// tag where it was served before; only a regeneration replaces it.
	next.GatewayPath = current.GatewayPath
	if req.GetRegenerateGatewayPath() || (next.ServingMode == googletag.ServingModeGateway && next.GatewayPath == "") {
		next.GatewayPath, err = googletag.NewGatewayPath()
		if err != nil {
			return nil, s.internalError(ctx, "failed to generate a gateway path", err, "tenant_id", tenant.ID.String())
		}
	}
	if next == current {
		message, err := s.tenantAnalyticsSettingsToProto(ctx, tenant.ID, current)
		if err != nil {
			return nil, err
		}
		return &publiraadminv1.UpdateTenantAnalyticsSettingsResponse{Settings: message}, nil
	}

	row, err := qtx.UpsertTenantAnalyticsSettings(ctx, dbmodels.UpsertTenantAnalyticsSettingsParams{
		TenantID:           tenant.ID,
		Ga4MeasurementID:   nullableString(next.GA4MeasurementID),
		GtmContainerID:     nullableString(next.GTMContainerID),
		ServingMode:        next.ServingMode,
		ServerContainerUrl: nullableString(next.ServerContainerURL),
		GatewayPath:        nullableString(next.GatewayPath),
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update tenant analytics settings", err, "tenant_id", tenant.ID.String())
	}
	saved, err := googletag.FromRow(row)
	if err != nil {
		return nil, s.internalError(ctx, "tenant analytics serving mode is not a supported mode", err, "tenant_id", tenant.ID.String())
	}
	if err := s.writeTenantSettingAudit(txCtx, tenant, session, googletag.ActionSettingsUpdated, googletag.AuditTargetType); err != nil {
		return nil, err
	}
	owed, err := s.reval.Record(ctx, qtx, tenant.ID, tenantAnalyticsSettingsRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the tenant analytics settings", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant analytics settings", err, "tenant_id", tenant.ID.String())
	}
	s.reval.Send(ctx, owed)

	message, err := s.tenantAnalyticsSettingsToProto(ctx, tenant.ID, saved)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UpdateTenantAnalyticsSettingsResponse{Settings: message}, nil
}
