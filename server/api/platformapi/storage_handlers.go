package platformapi

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformstorage"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/storagesettings"
)

var storageOperationProto = map[storagesettings.Operation]publirasplatformv1.PlatformStorageOperation{
	storagesettings.OperationPutObject:    publirasplatformv1.PlatformStorageOperation_PLATFORM_STORAGE_OPERATION_PUT_OBJECT,
	storagesettings.OperationGetObject:    publirasplatformv1.PlatformStorageOperation_PLATFORM_STORAGE_OPERATION_GET_OBJECT,
	storagesettings.OperationListObjects:  publirasplatformv1.PlatformStorageOperation_PLATFORM_STORAGE_OPERATION_LIST_OBJECTS,
	storagesettings.OperationDeleteObject: publirasplatformv1.PlatformStorageOperation_PLATFORM_STORAGE_OPERATION_DELETE_OBJECT,
}

func platformStorageSettingsToProto(config dbmodels.PlatformStorageConfig) *publirasplatformv1.PlatformStorageSettings {
	stored := storagesettings.FromConfig(config)
	return &publirasplatformv1.PlatformStorageSettings{
		Bucket:             stored.Settings.Bucket,
		Region:             stored.Settings.Region,
		Endpoint:           stored.Settings.Endpoint,
		ForcePathStyle:     stored.Settings.ForcePathStyle,
		PublicBaseUrl:      stored.Settings.PublicBaseURL,
		AccessKeyId:        stored.AccessKeyID,
		HasSecretAccessKey: stored.HasSecretAccessKey,
		Revision:           stored.Revision,
	}
}

func platformStorageChecksToProto(checks []storagesettings.Check) []*publirasplatformv1.PlatformStorageCheck {
	converted := make([]*publirasplatformv1.PlatformStorageCheck, 0, len(checks))
	for _, check := range checks {
		converted = append(converted, &publirasplatformv1.PlatformStorageCheck{
			Operation: storageOperationProto[check.Operation],
			Succeeded: check.Succeeded(),
			Reason:    check.Reason,
		})
	}
	return converted
}

// storageRequest is what a save and a test state alike. The two carry the same
// fields, which is what lets an operator test exactly what the form would save.
type storageRequest interface {
	GetBucket() string
	GetRegion() string
	GetEndpoint() string
	GetForcePathStyle() bool
	GetPublicBaseUrl() string
	GetAccessKeyId() string
	GetSecretAccessKeyUpdateMode() publirasplatformv1.SecretUpdateMode
	GetSecretAccessKey() string
}

func storageSettingsFromRequest(req storageRequest) storagesettings.Settings {
	return storagesettings.Normalize(storagesettings.Settings{
		Bucket:         req.GetBucket(),
		Region:         req.GetRegion(),
		Endpoint:       req.GetEndpoint(),
		ForcePathStyle: req.GetForcePathStyle(),
		PublicBaseURL:  req.GetPublicBaseUrl(),
	})
}

// storageSettingsError maps what platformstorage refuses to this API's codes,
// naming the request field when the refusal has one.
func (s *platformServer) storageSettingsError(ctx context.Context, err error) error {
	if connectErr := rpcerrors.FromFieldError(err); connectErr != nil {
		return connectErr
	}
	if errors.Is(err, platformstorage.ErrConflict) {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	return s.internalDBError(ctx, "failed to access platform storage config", err)
}

func (s *platformServer) GetPlatformStorageSettings(
	ctx context.Context,
	_ *connect.Request[publirasplatformv1.GetPlatformStorageSettingsRequest],
) (*connect.Response[publirasplatformv1.GetPlatformStorageSettingsResponse], error) {
	config, found, err := platformstorage.Get(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get platform storage config", err)
	}
	// Nothing saved is answered as the empty configuration at revision zero,
	// which is what a save states when it expects to create the row.
	settings := &publirasplatformv1.PlatformStorageSettings{}
	if found {
		settings = platformStorageSettingsToProto(config)
	}
	return connect.NewResponse(&publirasplatformv1.GetPlatformStorageSettingsResponse{Settings: settings}), nil
}

func (s *platformServer) UpdatePlatformStorageSettings(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformStorageSettingsRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformStorageSettingsResponse], error) {
	expectedRevision := req.Msg.GetExpectedRevision()
	params := platformstorage.SaveParams{
		Settings:         storageSettingsFromRequest(req.Msg),
		AccessKeyID:      req.Msg.GetAccessKeyId(),
		SecretMode:       secretupdate.Mode(req.Msg.GetSecretAccessKeyUpdateMode()),
		SecretAccessKey:  req.Msg.GetSecretAccessKey(),
		ExpectedRevision: &expectedRevision,
	}
	if err := params.Validate(); err != nil {
		return nil, s.storageSettingsError(ctx, err)
	}
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return nil, err
	}

	saved, err := platformstorage.Save(ctx, s.db, s.logger, s.encryptor, actor, params)
	if err != nil {
		return nil, s.storageSettingsError(ctx, err)
	}
	return connect.NewResponse(&publirasplatformv1.UpdatePlatformStorageSettingsResponse{
		Settings: platformStorageSettingsToProto(saved),
	}), nil
}

func (s *platformServer) TestPlatformStorageConnection(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.TestPlatformStorageConnectionRequest],
) (*connect.Response[publirasplatformv1.TestPlatformStorageConnectionResponse], error) {
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return nil, err
	}
	if s.storageTester == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("storage connection tester is unavailable"))
	}

	tester := platformstorage.Tester{Encryptor: s.encryptor, Store: s.storageTester, Recorder: s.recorder}
	checks, err := tester.Test(ctx, s.queriesFor(ctx), actor, platformstorage.TestParams{
		Settings:        storageSettingsFromRequest(req.Msg),
		AccessKeyID:     req.Msg.GetAccessKeyId(),
		SecretMode:      secretupdate.Mode(req.Msg.GetSecretAccessKeyUpdateMode()),
		SecretAccessKey: req.Msg.GetSecretAccessKey(),
	})
	if err != nil {
		return nil, s.storageSettingsError(ctx, err)
	}
	return connect.NewResponse(&publirasplatformv1.TestPlatformStorageConnectionResponse{
		Checks: platformStorageChecksToProto(checks),
	}), nil
}
