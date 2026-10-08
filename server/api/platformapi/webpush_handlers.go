package platformapi

import (
	"context"
	"errors"

	"connectrpc.com/connect/v2"

	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/webpushsettings"
)

func platformWebPushSettingsToProto(stored webpushsettings.Stored) *publirasplatformv1.PlatformWebPushSettings {
	return &publirasplatformv1.PlatformWebPushSettings{
		VapidPublicKey: stored.PublicKey,
		HasSubject:     stored.Configured(),
		Subject:        stored.Subject,
		Revision:       stored.Revision,
	}
}

func (s *platformServer) GetPlatformWebPushSettings(
	ctx context.Context,
	_ *publirasplatformv1.GetPlatformWebPushSettingsRequest,
) (*publirasplatformv1.GetPlatformWebPushSettingsResponse, error) {
	// Reading the settings generates the key pair when none is stored.
	config, err := webpushsettings.Ensure(ctx, s.queriesFor(ctx), s.encryptor)
	if err != nil {
		return nil, s.webPushSettingsError(ctx, err)
	}
	return &publirasplatformv1.GetPlatformWebPushSettingsResponse{
		Settings: platformWebPushSettingsToProto(webpushsettings.FromConfig(config)),
	}, nil
}

// UpdatePlatformWebPushSubject saves only over the revision the request
// states, so a read that generated the key pair comes first.
func (s *platformServer) UpdatePlatformWebPushSubject(
	ctx context.Context,
	req *publirasplatformv1.UpdatePlatformWebPushSubjectRequest,
) (*publirasplatformv1.UpdatePlatformWebPushSubjectResponse, error) {
	expectedRevision := req.GetExpectedRevision()
	params := webpushsettings.SaveParams{Subject: req.GetSubject(), ExpectedRevision: &expectedRevision}
	if err := params.Validate(); err != nil {
		return nil, s.webPushSettingsError(ctx, err)
	}
	actor, err := s.auditActor(ctx)
	if err != nil {
		return nil, err
	}
	updated, err := webpushsettings.SaveSubject(ctx, s.db, s.logger, s.encryptor, actor, params)
	if err != nil {
		return nil, s.webPushSettingsError(ctx, err)
	}
	return &publirasplatformv1.UpdatePlatformWebPushSubjectResponse{
		Settings: platformWebPushSettingsToProto(webpushsettings.FromConfig(updated)),
	}, nil
}

// webPushSettingsError maps what webpushsettings refuses to this API's codes,
// naming the request field when the refusal has one. Missing encryption keys
// are a precondition an operator can fix, not an internal fault.
func (s *platformServer) webPushSettingsError(ctx context.Context, err error) error {
	if connectErr := rpcerrors.FromFieldError(err); connectErr != nil {
		return connectErr
	}
	if errors.Is(err, webpushsettings.ErrConflict) || errors.Is(err, webpushsettings.ErrSecretManagerUnavailable) {
		return connect.NewError(connect.CodeFailedPrecondition, err.Error()).WithCause(err)
	}
	return s.internalDBError(ctx, "failed to access platform web push settings", err)
}
