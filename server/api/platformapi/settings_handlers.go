package platformapi

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
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
		Revision:        config.Revision,
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
	//
	// The row's revision is part of the answer: the console sends it back when
	// it saves one of the two fields, which is what lets the server tell that
	// the other field it names is still the one that was read here.
	config, err := s.queriesFor(ctx).GetPlatformConfig(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read platform settings", err)
	}
	settings, err := platformSettingsFromConfig(config)
	if err != nil {
		return nil, s.internalError(ctx, "failed to resolve platform settings", err)
	}
	return connect.NewResponse(&publirasplatformv1.GetPlatformSettingsResponse{
		Settings: settings,
	}), nil
}

// platformSettingsError maps what platformconfig refuses to this API's codes,
// naming the request field when the refusal has one.
func (s *platformServer) platformSettingsError(ctx context.Context, err error) error {
	if connectErr := rpcerrors.FromFieldError(err); connectErr != nil {
		return connectErr
	}
	if errors.Is(err, platformconfig.ErrConflict) {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	return s.internalDBError(ctx, "failed to save platform settings", err)
}

func (s *platformServer) UpdatePlatformSettings(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformSettingsRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformSettingsResponse], error) {
	expectedRevision := req.Msg.GetExpectedRevision()
	params := platformconfig.SaveParams{
		DefaultTimezone:  req.Msg.GetDefaultTimezone(),
		DefaultLocale:    req.Msg.GetDefaultLocale(),
		ExpectedRevision: &expectedRevision,
	}
	if _, err := params.Validate(); err != nil {
		return nil, s.platformSettingsError(ctx, err)
	}
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return nil, err
	}

	updated, err := platformconfig.Save(ctx, s.db, s.logger, actor, params)
	if err != nil {
		return nil, s.platformSettingsError(ctx, err)
	}
	settings, err := platformSettingsFromConfig(updated)
	if err != nil {
		return nil, s.internalError(ctx, "failed to resolve platform settings", err)
	}
	return connect.NewResponse(&publirasplatformv1.UpdatePlatformSettingsResponse{
		Settings: settings,
	}), nil
}
