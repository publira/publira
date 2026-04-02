package platformapi

import (
	"context"
	"time"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
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
	req *connect.Request[publirasplatformv1.GetDashboardSummaryRequest],
) (*connect.Response[publirasplatformv1.GetDashboardSummaryResponse], error) {
	if _, _, _, err := s.authenticatePlatformSession(ctx, "", req.Header()); err != nil {
		return nil, err
	}

	totalTenants, err := s.queriesFor(ctx).CountAllTenants(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	activeTenants, err := s.queriesFor(ctx).CountActiveTenants(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	suspendedTenants, err := s.queriesFor(ctx).CountSuspendedTenants(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	pendingEndUsers, err := s.queriesFor(ctx).CountPendingEndUsers(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	limit := req.Msg.RecentEventsLimit
	if limit <= 0 {
		limit = defaultDashboardRecentEventsLimit
	}
	if limit > maxDashboardRecentEventsLimit {
		limit = maxDashboardRecentEventsLimit
	}

	recentEvents, err := s.queriesFor(ctx).ListRecentPlatformEvents(ctx, limit)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items := make([]*publirasplatformv1.DashboardRecentEvent, 0, len(recentEvents))
	for _, event := range recentEvents {
		items = append(items, toDashboardRecentEvent(event))
	}

	return connect.NewResponse(&publirasplatformv1.GetDashboardSummaryResponse{
		TotalTenants:     totalTenants,
		ActiveTenants:    activeTenants,
		SuspendedTenants: suspendedTenants,
		PendingEndUsers:  pendingEndUsers,
		RecentEvents:     items,
	}), nil
}
