package platformapi

import (
	"context"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/tenanttz"
)

func platformSettingsFromConfig(config dbmodels.PlatformConfig) *publirasplatformv1.PlatformSettings {
	return &publirasplatformv1.PlatformSettings{
		DefaultTimezone: tenanttz.Resolve(config.DefaultTimezone, nil),
		DefaultLocale:   locale.Resolve(config.DefaultLocale, nil),
	}
}

func (s *platformServer) GetPlatformSettings(
	ctx context.Context,
	_req *connect.Request[publirasplatformv1.GetPlatformSettingsRequest],
) (*connect.Response[publirasplatformv1.GetPlatformSettingsResponse], error) {
	timezone, defaultLocale := platformconfig.Defaults(ctx, s.queriesFor(ctx))
	return connect.NewResponse(&publirasplatformv1.GetPlatformSettingsResponse{
		Settings: &publirasplatformv1.PlatformSettings{
			DefaultTimezone: timezone,
			DefaultLocale:   defaultLocale,
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
	defaultLocale, err := locale.Normalize(req.Msg.DefaultLocale)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	updated, err := s.queriesFor(ctx).UpsertPlatformSettings(ctx, dbmodels.UpsertPlatformSettingsParams{
		DefaultTimezone: timezone,
		DefaultLocale:   defaultLocale,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update platform settings", err)
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
		Settings: platformSettingsFromConfig(updated),
	}), nil
}
