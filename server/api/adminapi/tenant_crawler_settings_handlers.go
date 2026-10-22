package adminapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/crawlersettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// tenantCrawlerSettingsRevalidateTags names the storefront read behind its
// robots.txt that carries the exclusions.
func tenantCrawlerSettingsRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:crawler-settings", strings.TrimSpace(tenantID))}
}

func tenantCrawlerSettingsToProto(settings crawlersettings.Settings) *publiraadminv1.TenantCrawlerSettings {
	return &publiraadminv1.TenantCrawlerSettings{
		ExcludedUserAgents: settings.UserAgents,
		ExcludedPaths:      settings.Paths,
	}
}

var crawlerPurposeToProto = map[crawlersettings.Purpose]publiraadminv1.CrawlerPurpose{
	crawlersettings.PurposeAITraining:  publiraadminv1.CrawlerPurpose_CRAWLER_PURPOSE_AI_TRAINING,
	crawlersettings.PurposeAIAssistant: publiraadminv1.CrawlerPurpose_CRAWLER_PURPOSE_AI_ASSISTANT,
	crawlersettings.PurposeImageSearch: publiraadminv1.CrawlerPurpose_CRAWLER_PURPOSE_IMAGE_SEARCH,
}

func knownCrawlersToProto() []*publiraadminv1.KnownCrawler {
	known := crawlersettings.Known()
	crawlers := make([]*publiraadminv1.KnownCrawler, 0, len(known))
	for _, crawler := range known {
		crawlers = append(crawlers, &publiraadminv1.KnownCrawler{
			UserAgent: crawler.UserAgent,
			Operator:  crawler.Operator,
			Purpose:   crawlerPurposeToProto[crawler.Purpose],
		})
	}
	return crawlers
}

func (s *adminServer) GetTenantCrawlerSettings(
	ctx context.Context,
	req *publiraadminv1.GetTenantCrawlerSettingsRequest,
) (*publiraadminv1.GetTenantCrawlerSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	settings, err := crawlersettings.Get(ctx, s.queriesFor(ctx), tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant crawler settings", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.GetTenantCrawlerSettingsResponse{
		Settings:      tenantCrawlerSettingsToProto(settings),
		KnownCrawlers: knownCrawlersToProto(),
	}, nil
}

func (s *adminServer) UpdateTenantCrawlerSettings(
	ctx context.Context,
	req *publiraadminv1.UpdateTenantCrawlerSettingsRequest,
) (*publiraadminv1.UpdateTenantCrawlerSettingsResponse, error) {
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
	requested, err := crawlersettings.Normalize(crawlersettings.Settings{
		UserAgents: req.Settings.GetExcludedUserAgents(),
		Paths:      req.Settings.GetExcludedPaths(),
	})
	if err != nil {
		var entryErr *crawlersettings.EntryError
		if errors.As(err, &entryErr) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, entryErr.Err, entryErr.Field())
		}
		return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}

	var stored crawlersettings.Settings
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		q := s.queriesFor(txCtx)
		current, err := crawlersettings.Get(txCtx, q, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to get tenant crawler settings", err, "tenant_id", tenant.ID.String())
		}
		if current.Equal(requested) {
			stored = current
			return nil, nil
		}
		stored, err = crawlersettings.Update(txCtx, q, tenant.ID, requested)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to update tenant crawler settings", err, "tenant_id", tenant.ID.String())
		}
		if err := s.writeTenantSettingAudit(txCtx, tenant, session, crawlersettings.ActionSettingsUpdated, crawlersettings.AuditTargetType); err != nil {
			return nil, err
		}
		return tenantCrawlerSettingsRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}

	return &publiraadminv1.UpdateTenantCrawlerSettingsResponse{
		Settings: tenantCrawlerSettingsToProto(stored),
	}, nil
}
