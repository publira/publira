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

// tenantCommentSettingsRevalidateTags names the public site cache that decides
// whether an episode page offers commenting at all. The mode rides on the
// storefront's tenant read, so dropping the site entry is what carries a saved
// change through to the reader. The threshold beside it never leaves this API,
// and the card saves the pair, so one drop covers the save either way.
func tenantCommentSettingsRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:site", strings.TrimSpace(tenantID))}
}

// maxCommentAutoHideReportThreshold is the largest automatic removal threshold
// the console accepts.
//
// The setting exists to take an obviously bad comment down before staff are
// awake, and a threshold no episode's readership could reach turns it off
// while still reading as if it were on. A tenant that wants no automatic
// removal says so with 0, which is the answer the card offers.
const maxCommentAutoHideReportThreshold = uint32(1000)

// defaultCommentAutoHideReportThreshold is what a tenant with no config row
// yet is told its threshold is.
//
// It mirrors the column default of
// `tenant_config.comment_auto_hide_report_threshold`, because the row this
// console writes for such a tenant is the row that default would have
// produced: reporting anything else would show a number the very next save
// contradicts. TestDBTenantCommentSettingsDefaultsMatchTheColumnDefaults holds
// the two together.
const defaultCommentAutoHideReportThreshold = uint32(3)

// commentAutoHideReportThresholdFromStored widens the stored count into the
// unsigned one the API speaks.
//
// The column is CHECK-ed non-negative, so a negative value is a database no
// longer holding what the schema says it holds. It fails the read rather than
// being clamped to 0, which would quietly report the automatic removal as
// turned off for a tenant that never turned it off.
func commentAutoHideReportThresholdFromStored(stored int32) (uint32, error) {
	if stored < 0 {
		return 0, fmt.Errorf("stored comment auto hide report threshold is negative: %d", stored)
	}
	return uint32(stored), nil
}

func (s *adminServer) GetTenantCommentSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantCommentSettingsRequest],
) (*connect.Response[publiraadminv1.GetTenantCommentSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// A tenant with no config row has chosen nothing about commenting,
			// which is the answer the columns' own defaults give too.
			return connect.NewResponse(&publiraadminv1.GetTenantCommentSettingsResponse{
				AutoHideReportThreshold: defaultCommentAutoHideReportThreshold,
				CommentMode:             publirattypesv1.CommentMode_COMMENT_MODE_DISABLED,
			}), nil
		}
		return nil, s.internalDBError(ctx, "failed to get tenant comment settings", err, "tenant_id", tenant.ID.String())
	}

	mode, err := protomapper.CommentModeFromStored(config.CommentMode)
	if err != nil {
		return nil, s.internalError(ctx, "tenant comment mode is not a supported mode", err, "tenant_id", tenant.ID.String())
	}
	threshold, err := commentAutoHideReportThresholdFromStored(config.CommentAutoHideReportThreshold)
	if err != nil {
		return nil, s.internalError(ctx, "tenant comment auto hide report threshold is out of range", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.GetTenantCommentSettingsResponse{
		AutoHideReportThreshold: threshold,
		CommentMode:             mode,
	}), nil
}

func (s *adminServer) UpdateTenantCommentSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantCommentSettingsRequest],
) (*connect.Response[publiraadminv1.UpdateTenantCommentSettingsResponse], error) {
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
	if req.Msg.AutoHideReportThreshold > maxCommentAutoHideReportThreshold {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("auto hide report threshold must be at most %d", maxCommentAutoHideReportThreshold))
	}

	// An upsert rather than an update: commenting can be the first thing a
	// tenant saves about itself, and a console that refused to turn it on until
	// the site copy had been filled in would be tying together two decisions
	// that have nothing to do with each other.
	updated, err := s.queriesFor(ctx).UpsertTenantCommentSettings(ctx, dbmodels.UpsertTenantCommentSettingsParams{
		CommentAutoHideReportThreshold: int32(req.Msg.AutoHideReportThreshold),
		CommentMode:                    stored,
		TenantID:                       tenant.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update tenant comment settings", err, "tenant_id", tenant.ID.String())
	}

	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, tenantCommentSettingsRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after tenant comment settings update", "tenant_public_id", tenant.PublicID, "error", err)
		}
	}

	// The stored row rather than the request: what the console renders next is
	// what the update actually persisted.
	saved, err := protomapper.CommentModeFromStored(updated.CommentMode)
	if err != nil {
		return nil, s.internalError(ctx, "tenant comment mode is not a supported mode", err, "tenant_id", tenant.ID.String())
	}
	savedThreshold, err := commentAutoHideReportThresholdFromStored(updated.CommentAutoHideReportThreshold)
	if err != nil {
		return nil, s.internalError(ctx, "tenant comment auto hide report threshold is out of range", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.UpdateTenantCommentSettingsResponse{
		AutoHideReportThreshold: savedThreshold,
		CommentMode:             saved,
	}), nil
}

// tenantAgeVerificationRevalidateTags names the public site caches that decide
// whether the sign-up form asks for a birth date and how a rated series page
// gates itself. The rule rides on the storefront's tenant read and on its
// series reads, so both are dropped: a tenant that starts verifying ages has
// to reach the readers already looking at a rated series, not only the ones
// who arrive next.
func tenantAgeVerificationRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:site", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:list", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
	}
}

func (s *adminServer) GetTenantAgeVerification(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantAgeVerificationRequest],
) (*connect.Response[publiraadminv1.GetTenantAgeVerificationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// A tenant with no config row has chosen nothing about age
			// verification, which is the answer the column's own default gives
			// too.
			return connect.NewResponse(&publiraadminv1.GetTenantAgeVerificationResponse{
				AgeVerification: publirattypesv1.AgeVerification_AGE_VERIFICATION_NONE,
			}), nil
		}
		return nil, s.internalDBError(ctx, "failed to get tenant age verification", err, "tenant_id", tenant.ID.String())
	}

	rule, err := protomapper.AgeVerificationFromStored(config.AgeVerification)
	if err != nil {
		return nil, s.internalError(ctx, "tenant age verification is not a supported rule", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.GetTenantAgeVerificationResponse{
		AgeVerification: rule,
	}), nil
}

func (s *adminServer) UpdateTenantAgeVerification(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantAgeVerificationRequest],
) (*connect.Response[publiraadminv1.UpdateTenantAgeVerificationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	stored, err := protomapper.AgeVerificationToStored(req.Msg.AgeVerification)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	updated, err := s.queriesFor(ctx).UpsertTenantAgeVerification(ctx, dbmodels.UpsertTenantAgeVerificationParams{
		AgeVerification: stored,
		TenantID:        tenant.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update tenant age verification", err, "tenant_id", tenant.ID.String())
	}

	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, tenantAgeVerificationRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after tenant age verification update", "tenant_public_id", tenant.PublicID, "error", err)
		}
	}

	// The stored row rather than the request: what the console renders next is
	// what the update actually persisted.
	saved, err := protomapper.AgeVerificationFromStored(updated.AgeVerification)
	if err != nil {
		return nil, s.internalError(ctx, "tenant age verification is not a supported rule", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.UpdateTenantAgeVerificationResponse{
		AgeVerification: saved,
	}), nil
}
