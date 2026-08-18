package platformapi

import (
	"context"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/tenanttz"
)

func (s *platformServer) GetPlatformSettings(
	ctx context.Context,
	_req *connect.Request[publirasplatformv1.GetPlatformSettingsRequest],
) (*connect.Response[publirasplatformv1.GetPlatformSettingsResponse], error) {
	return connect.NewResponse(&publirasplatformv1.GetPlatformSettingsResponse{
		Settings: &publirasplatformv1.PlatformSettings{
			DefaultTimezone: platformconfig.DefaultTimeZone(ctx, s.queriesFor(ctx)),
		},
	}), nil
}

func (s *platformServer) UpdatePlatformSettings(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformSettingsRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformSettingsResponse], error) {
	timezone, err := tenanttz.Normalize(req.Msg.DefaultTimezone)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	updated, err := s.queriesFor(ctx).UpsertPlatformDefaultTimezone(ctx, timezone)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update platform default timezone", err)
	}

	if actor, ok := platformActorFromContext(ctx); ok {
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "platform_settings_updated",
			TargetType:          "platform_config",
			TargetID:            "platform",
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
	}

	return connect.NewResponse(&publirasplatformv1.UpdatePlatformSettingsResponse{
		Settings: &publirasplatformv1.PlatformSettings{
			DefaultTimezone: updated.DefaultTimezone,
		},
	}), nil
}
