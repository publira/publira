package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/tenanttz"
)

// tenantTimezoneRevalidateTags lists the public site caches that render tenant
// wall-clock date/time, so a time zone change is reflected right away.
func tenantTimezoneRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:site", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:list", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
		fmt.Sprintf("tenant:%s:pages", normalizedTenantID),
	}
}

func (s *adminServer) GetTenantTimezone(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantTimezoneRequest],
) (*connect.Response[publiraadminv1.GetTenantTimezoneResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.GetTenantTimezoneResponse{
		Timezone: tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}), nil
}

func (s *adminServer) UpdateTenantTimezone(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantTimezoneRequest],
) (*connect.Response[publiraadminv1.UpdateTenantTimezoneResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	timezone, err := tenanttz.Normalize(req.Msg.Timezone)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	updated, err := s.queriesFor(ctx).UpdateTenantTimezone(ctx, dbmodels.UpdateTenantTimezoneParams{
		ID:       tenant.ID,
		Timezone: timezone,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, s.internalDBError(ctx, "failed to update tenant timezone", err, "tenant_id", tenant.ID.String())
	}

	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, tenantTimezoneRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after tenant timezone update", "tenant_public_id", tenant.PublicID, "error", err)
		}
	}

	return connect.NewResponse(&publiraadminv1.UpdateTenantTimezoneResponse{
		Timezone: tenanttz.Resolve(updated.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}), nil
}

// tenantDefaultLocaleRevalidateTags lists the public site caches that render
// tenant-facing copy, so a default locale change is reflected right away.
func tenantDefaultLocaleRevalidateTags(tenantID string) []string {
	return tenantTimezoneRevalidateTags(tenantID)
}

func (s *adminServer) GetTenantDefaultLocale(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantDefaultLocaleRequest],
) (*connect.Response[publiraadminv1.GetTenantDefaultLocaleResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	defaultLocale, err := locale.Resolve(tenant.DefaultLocale)
	if err != nil {
		return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.GetTenantDefaultLocaleResponse{
		DefaultLocale: defaultLocale,
	}), nil
}

func (s *adminServer) UpdateTenantDefaultLocale(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantDefaultLocaleRequest],
) (*connect.Response[publiraadminv1.UpdateTenantDefaultLocaleResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	defaultLocale, err := locale.Normalize(req.Msg.DefaultLocale)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	updated, err := s.queriesFor(ctx).UpdateTenantDefaultLocale(ctx, dbmodels.UpdateTenantDefaultLocaleParams{
		ID:            tenant.ID,
		DefaultLocale: defaultLocale,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, s.internalDBError(ctx, "failed to update tenant default locale", err, "tenant_id", tenant.ID.String())
	}

	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, tenantDefaultLocaleRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after tenant default locale update", "tenant_public_id", tenant.PublicID, "error", err)
		}
	}

	// The stored row rather than the request: what the console renders next is
	// what the update actually persisted.
	savedLocale, err := locale.Resolve(updated.DefaultLocale)
	if err != nil {
		return nil, s.internalError(ctx, "tenant default locale is not a supported locale", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.UpdateTenantDefaultLocaleResponse{
		DefaultLocale: savedLocale,
	}), nil
}

// tenantCommentModeRevalidateTags names the public site cache that decides
// whether an episode page offers commenting at all. The mode rides on the
// storefront's tenant read, so dropping the site entry is what carries a saved
// change through to the reader.
func tenantCommentModeRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:site", strings.TrimSpace(tenantID))}
}

func (s *adminServer) GetTenantCommentMode(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantCommentModeRequest],
) (*connect.Response[publiraadminv1.GetTenantCommentModeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// A tenant with no config row has chosen nothing about commenting,
			// which is the answer the column's own default gives too.
			return connect.NewResponse(&publiraadminv1.GetTenantCommentModeResponse{
				CommentMode: publirattypesv1.CommentMode_COMMENT_MODE_DISABLED,
			}), nil
		}
		return nil, s.internalDBError(ctx, "failed to get tenant comment mode", err, "tenant_id", tenant.ID.String())
	}

	mode, err := protomapper.CommentModeFromStored(config.CommentMode)
	if err != nil {
		return nil, s.internalError(ctx, "tenant comment mode is not a supported mode", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.GetTenantCommentModeResponse{
		CommentMode: mode,
	}), nil
}

func (s *adminServer) UpdateTenantCommentMode(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantCommentModeRequest],
) (*connect.Response[publiraadminv1.UpdateTenantCommentModeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	stored, err := protomapper.CommentModeToStored(req.Msg.CommentMode)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// An upsert rather than an update: commenting can be the first thing a
	// tenant saves about itself, and a console that refused to turn it on until
	// the site copy had been filled in would be tying together two decisions
	// that have nothing to do with each other.
	updated, err := s.queriesFor(ctx).UpsertTenantCommentMode(ctx, dbmodels.UpsertTenantCommentModeParams{
		TenantID:    tenant.ID,
		CommentMode: stored,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update tenant comment mode", err, "tenant_id", tenant.ID.String())
	}

	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, tenantCommentModeRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after tenant comment mode update", "tenant_public_id", tenant.PublicID, "error", err)
		}
	}

	// The stored row rather than the request: what the console renders next is
	// what the update actually persisted.
	saved, err := protomapper.CommentModeFromStored(updated.CommentMode)
	if err != nil {
		return nil, s.internalError(ctx, "tenant comment mode is not a supported mode", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.UpdateTenantCommentModeResponse{
		CommentMode: saved,
	}), nil
}
