package platformapi

import (
	"context"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirasplatformv1 "github.com/publira/publira/server/internal/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/tenanttz"
)

func platformSettingsFromConfig(config dbmodels.PlatformConfig) (*publirasplatformv1.PlatformSettings, error) {
	defaultLocale, err := locale.Resolve(config.DefaultLocale)
	if err != nil {
		return nil, err
	}
	return &publirasplatformv1.PlatformSettings{
		DefaultTimezone: tenanttz.Resolve(config.DefaultTimezone, nil),
		DefaultLocale:   defaultLocale,
	}, nil
}

func (s *platformServer) GetPlatformSettings(
	ctx context.Context,
	_req *connect.Request[publirasplatformv1.GetPlatformSettingsRequest],
) (*connect.Response[publirasplatformv1.GetPlatformSettingsResponse], error) {
	// A settings row that cannot be read, or that names a locale this build has
	// no catalog for, leaves the console nothing to display. It is told so
	// rather than handed a language the operator never saved — which is what it
	// would then offer to save back over the stored one.
	timezone, defaultLocale, err := platformconfig.Defaults(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, s.internalError(ctx, "failed to resolve platform settings", err)
	}
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

	settings, err := platformSettingsFromConfig(updated)
	if err != nil {
		return nil, s.internalError(ctx, "failed to resolve platform settings", err)
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
		Settings: settings,
	}), nil
}
