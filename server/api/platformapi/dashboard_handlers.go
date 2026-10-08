package platformapi

import (
	"context"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const (
	defaultDashboardRecentEventsLimit = int32(10)
	maxDashboardRecentEventsLimit     = int32(50)
)

func toDashboardRecentEvent(row dbmodels.ListRecentPlatformEventsRow) *publirasplatformv1.DashboardRecentEvent {
	actor := row.Actor
	if actor == "" {
		actor = "system"
	}

	return &publirasplatformv1.DashboardRecentEvent{
		EventType: row.EventType,
		Action:    row.Action,
		Target:    row.Target,
		Actor:     actor,
		At:        row.OccurredAt.UTC().Format(time.RFC3339),
	}
}

func (s *platformServer) GetDashboardSummary(
	ctx context.Context,
	req *publirasplatformv1.GetDashboardSummaryRequest,
) (*publirasplatformv1.GetDashboardSummaryResponse, error) {
	if _, err := s.requirePlatformActor(ctx, rpcmiddleware.RequestHeader(ctx)); err != nil {
		return nil, err
	}

	totalTenants, err := s.queriesFor(ctx).CountAllTenants(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count tenants for dashboard", err)
	}
	activeTenants, err := s.queriesFor(ctx).CountActiveTenants(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count active tenants for dashboard", err)
	}
	suspendedTenants, err := s.queriesFor(ctx).CountSuspendedTenants(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count suspended tenants for dashboard", err)
	}
	pendingEndUsers, err := s.queriesFor(ctx).CountPendingEndUsers(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count pending end users for dashboard", err)
	}

	limit := req.RecentEventsLimit
	if limit <= 0 {
		limit = defaultDashboardRecentEventsLimit
	}
	if limit > maxDashboardRecentEventsLimit {
		limit = maxDashboardRecentEventsLimit
	}

	recentEvents, err := s.queriesFor(ctx).ListRecentPlatformEvents(ctx, limit)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list recent platform events for dashboard", err)
	}

	items := make([]*publirasplatformv1.DashboardRecentEvent, 0, len(recentEvents))
	for _, event := range recentEvents {
		items = append(items, toDashboardRecentEvent(event))
	}

	return &publirasplatformv1.GetDashboardSummaryResponse{
		TotalTenants:     totalTenants,
		ActiveTenants:    activeTenants,
		SuspendedTenants: suspendedTenants,
		PendingEndUsers:  pendingEndUsers,
		RecentEvents:     items,
	}, nil
}
