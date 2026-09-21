package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/storagesettings"
)

const (
	storageSettingsAuditTargetType = "storage_config"
	storageSettingsAuditTargetID   = "platform"
)

// errPlatformStorageConflict is what a save based on a revision the stored row
// has moved past reports.
var errPlatformStorageConflict = errors.New("platform storage settings have changed since they were read")

var storageOperationProto = map[storagesettings.Operation]publirasplatformv1.PlatformStorageOperation{
	storagesettings.OperationPutObject:    publirasplatformv1.PlatformStorageOperation_PLATFORM_STORAGE_OPERATION_PUT_OBJECT,
	storagesettings.OperationGetObject:    publirasplatformv1.PlatformStorageOperation_PLATFORM_STORAGE_OPERATION_GET_OBJECT,
	storagesettings.OperationListObjects:  publirasplatformv1.PlatformStorageOperation_PLATFORM_STORAGE_OPERATION_LIST_OBJECTS,
	storagesettings.OperationDeleteObject: publirasplatformv1.PlatformStorageOperation_PLATFORM_STORAGE_OPERATION_DELETE_OBJECT,
}

func platformStorageSettingsToProto(stored storagesettings.Stored) *publirasplatformv1.PlatformStorageSettings {
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

func (s *platformServer) loadPlatformStorageConfig(ctx context.Context) (dbmodels.PlatformStorageConfig, bool, error) {
	config, err := s.queriesFor(ctx).GetPlatformStorageConfig(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.PlatformStorageConfig{}, false, nil
		}
		return dbmodels.PlatformStorageConfig{}, false, s.internalDBError(ctx, "failed to get platform storage config", err)
	}
	return config, true, nil
}

func (s *platformServer) GetPlatformStorageSettings(
	ctx context.Context,
	_ *connect.Request[publirasplatformv1.GetPlatformStorageSettingsRequest],
) (*connect.Response[publirasplatformv1.GetPlatformStorageSettingsResponse], error) {
	config, found, err := s.loadPlatformStorageConfig(ctx)
	if err != nil {
		return nil, err
	}
	// Nothing saved is answered as the empty configuration at revision zero,
	// which is what a save states when it expects to create the row.
	if !found {
		return connect.NewResponse(&publirasplatformv1.GetPlatformStorageSettingsResponse{
			Settings: &publirasplatformv1.PlatformStorageSettings{},
		}), nil
	}
	return connect.NewResponse(&publirasplatformv1.GetPlatformStorageSettingsResponse{
		Settings: platformStorageSettingsToProto(storagesettings.FromConfig(config)),
	}), nil
}

// storageWrite is one save: the values to store, and how the request stated
// the secret access key that goes with them.
type storageWrite struct {
	settings         storagesettings.Settings
	accessKeyID      string
	secretUpdateMode int32
	secretAccessKey  string
	expectedRevision int64
}

// writePlatformStorageSettings locks the row, compares its revision with the
// one the request states, and writes only when they match. The secret comes
// from the locked row too, so a save that keeps the stored credential keeps
// the one it compared revisions against. The audit entry commits with the
// write, so a change to where every stored object lives never goes unrecorded.
func (s *platformServer) writePlatformStorageSettings(
	ctx context.Context,
	write storageWrite,
	audit *auditlog.PlatformEntry,
) (dbmodels.PlatformStorageConfig, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformStorageConfig{}, s.internalDBError(ctx, "failed to begin update platform storage settings transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	var updated dbmodels.PlatformStorageConfig
	current, err := txq.LockPlatformStorageConfig(ctx)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if write.expectedRevision != 0 {
			return dbmodels.PlatformStorageConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformStorageConflict)
		}
		params, paramsErr := storageConfigParams(write, dbmodels.PlatformStorageConfig{}, s.encryptor)
		if paramsErr != nil {
			return dbmodels.PlatformStorageConfig{}, paramsErr
		}
		updated, err = txq.InsertPlatformStorageConfig(ctx, dbmodels.InsertPlatformStorageConfigParams(params))
		if err != nil {
			// Two first saves both find nothing to lock; the primary key
			// settles which one wins.
			if dberr.IsUniqueViolation(err) {
				return dbmodels.PlatformStorageConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformStorageConflict)
			}
			return dbmodels.PlatformStorageConfig{}, s.internalDBError(ctx, "failed to create platform storage settings", err)
		}
	case err != nil:
		return dbmodels.PlatformStorageConfig{}, s.internalDBError(ctx, "failed to lock platform storage settings", err)
	default:
		if write.expectedRevision != current.Revision {
			return dbmodels.PlatformStorageConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformStorageConflict)
		}
		params, paramsErr := storageConfigParams(write, current, s.encryptor)
		if paramsErr != nil {
			return dbmodels.PlatformStorageConfig{}, paramsErr
		}
		updated, err = txq.UpdatePlatformStorageConfig(ctx, params)
		if err != nil {
			return dbmodels.PlatformStorageConfig{}, s.internalDBError(ctx, "failed to update platform storage settings", err)
		}
	}

	if audit != nil {
		if err := auditlog.WritePlatform(ctx, txq, s.logger, *audit); err != nil {
			return dbmodels.PlatformStorageConfig{}, s.internalDBError(ctx, "failed to audit platform storage settings", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformStorageConfig{}, s.internalDBError(ctx, "failed to commit platform storage settings", err)
	}
	return updated, nil
}

// storageConfigParams resolves the secret the row ends up holding and refuses
// a credential that is only half stated, or whose halves no longer belong
// together. current is the zero row when nothing is saved yet.
func storageConfigParams(
	write storageWrite,
	current dbmodels.PlatformStorageConfig,
	encryptor storagesettings.SecretManager,
) (dbmodels.UpdatePlatformStorageConfigParams, error) {
	existingEncrypted := storedSecretAccessKey(current)
	if err := storagesettings.ValidateKeptSecret(current.AccessKeyID.String, write.accessKeyID, write.secretUpdateMode, existingEncrypted != ""); err != nil {
		return dbmodels.UpdatePlatformStorageConfigParams{}, connect.NewError(connect.CodeInvalidArgument, err)
	}
	encrypted, err := storagesettings.EncryptUpdatedSecret(existingEncrypted, write.secretUpdateMode, write.secretAccessKey, encryptor)
	if err != nil {
		return dbmodels.UpdatePlatformStorageConfigParams{}, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if err := storagesettings.ValidateCredentialPair(write.accessKeyID, encrypted != ""); err != nil {
		return dbmodels.UpdatePlatformStorageConfigParams{}, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return storagesettings.ConfigParams(write.settings, write.accessKeyID, encrypted), nil
}

func storedSecretAccessKey(config dbmodels.PlatformStorageConfig) string {
	if !config.SecretAccessKeyEncrypted.Valid {
		return ""
	}
	return config.SecretAccessKeyEncrypted.String
}

func (s *platformServer) UpdatePlatformStorageSettings(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformStorageSettingsRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformStorageSettingsResponse], error) {
	settings := storageSettingsFromRequest(req.Msg)
	if err := storagesettings.Validate(settings); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if req.Msg.GetExpectedRevision() < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("expected_revision must not be negative"))
	}

	var audit *auditlog.PlatformEntry
	if actor, ok := platformActorFromContext(ctx); ok {
		audit = &auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "platform_storage_settings_updated",
			TargetType:          storageSettingsAuditTargetType,
			TargetID:            storageSettingsAuditTargetID,
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		}
	}

	updated, err := s.writePlatformStorageSettings(ctx, storageWrite{
		settings:         settings,
		accessKeyID:      strings.TrimSpace(req.Msg.GetAccessKeyId()),
		secretUpdateMode: int32(req.Msg.GetSecretAccessKeyUpdateMode()),
		secretAccessKey:  req.Msg.GetSecretAccessKey(),
		expectedRevision: req.Msg.GetExpectedRevision(),
	}, audit)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publirasplatformv1.UpdatePlatformStorageSettingsResponse{
		Settings: platformStorageSettingsToProto(storagesettings.FromConfig(updated)),
	}), nil
}

func (s *platformServer) TestPlatformStorageConnection(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.TestPlatformStorageConnectionRequest],
) (*connect.Response[publirasplatformv1.TestPlatformStorageConnectionResponse], error) {
	actor, ok := platformActorFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeInternal, errors.New("platform actor is unavailable"))
	}
	if s.storageTester == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("storage connection tester is unavailable"))
	}

	settings := storageSettingsFromRequest(req.Msg)
	if err := storagesettings.Validate(settings); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	existing, found, err := s.loadPlatformStorageConfig(ctx)
	if err != nil {
		return nil, err
	}
	existingEncrypted := ""
	if found {
		existingEncrypted = storedSecretAccessKey(existing)
	}
	if err := storagesettings.ValidateKeptSecret(
		existing.AccessKeyID.String,
		req.Msg.GetAccessKeyId(),
		int32(req.Msg.GetSecretAccessKeyUpdateMode()),
		existingEncrypted != "",
	); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	secretAccessKey, err := storagesettings.ResolveSecretForTest(
		existingEncrypted,
		int32(req.Msg.GetSecretAccessKeyUpdateMode()),
		req.Msg.GetSecretAccessKey(),
		s.encryptor,
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	credentials := storagesettings.NormalizeCredentials(storagesettings.Credentials{
		AccessKeyID:     req.Msg.GetAccessKeyId(),
		SecretAccessKey: secretAccessKey,
	})
	if err := storagesettings.ValidateCredentialPair(credentials.AccessKeyID, credentials.SecretAccessKey != ""); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	checks, err := s.storageTester.TestConnection(ctx, settings, credentials)
	if err != nil {
		return nil, s.internalError(ctx, "failed to test platform storage connection", err)
	}

	outcome, reason := auditlog.OutcomeSuccess, ""
	if failed, ok := storagesettings.Failed(checks); ok {
		outcome, reason = auditlog.OutcomeFailure, failed.Reason
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
		Action:              "platform_storage_connection_tested",
		TargetType:          storageSettingsAuditTargetType,
		TargetID:            storageSettingsAuditTargetID,
		Outcome:             outcome,
		Reason:              reason,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.TestPlatformStorageConnectionResponse{
		Checks: platformStorageChecksToProto(checks),
	}), nil
}
