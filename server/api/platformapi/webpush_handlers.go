package platformapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/webpushsettings"
)

const (
	webPushSettingsAuditTargetType = "webpush_config"
	webPushSettingsAuditTargetID   = "platform"
)

// errPlatformWebPushConflict is what a save based on a revision the stored row
// has moved past reports.
var errPlatformWebPushConflict = errors.New("platform web push settings have changed since they were read")

func platformWebPushSettingsToProto(stored webpushsettings.Stored) *publirasplatformv1.PlatformWebPushSettings {
	return &publirasplatformv1.PlatformWebPushSettings{
		VapidPublicKey: stored.PublicKey,
		HasSubject:     stored.Configured(),
		Subject:        stored.Subject,
		Revision:       stored.Revision,
	}
}

// ensurePlatformWebPushConfig answers the stored row, generating the key pair
// when none is stored. Missing encryption keys are a precondition an operator
// can fix, not an internal fault.
func (s *platformServer) ensurePlatformWebPushConfig(ctx context.Context, q webpushsettings.Querier) (dbmodels.PlatformWebpushConfig, error) {
	config, err := webpushsettings.Ensure(ctx, q, s.encryptor)
	if errors.Is(err, webpushsettings.ErrSecretManagerUnavailable) {
		return dbmodels.PlatformWebpushConfig{}, connect.NewError(connect.CodeFailedPrecondition, err)
	}
	if err != nil {
		return dbmodels.PlatformWebpushConfig{}, s.internalDBError(ctx, "failed to ensure platform web push key pair", err)
	}
	return config, nil
}

func (s *platformServer) GetPlatformWebPushSettings(
	ctx context.Context,
	_ *connect.Request[publirasplatformv1.GetPlatformWebPushSettingsRequest],
) (*connect.Response[publirasplatformv1.GetPlatformWebPushSettingsResponse], error) {
	config, err := s.ensurePlatformWebPushConfig(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publirasplatformv1.GetPlatformWebPushSettingsResponse{
		Settings: platformWebPushSettingsToProto(webpushsettings.FromConfig(config)),
	}), nil
}

// UpdatePlatformWebPushSubject writes only when the locked row's revision is
// the one the request states, and commits the audit entry with the write.
func (s *platformServer) UpdatePlatformWebPushSubject(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformWebPushSubjectRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformWebPushSubjectResponse], error) {
	subject := webpushsettings.NormalizeSubject(req.Msg.GetSubject())
	if err := webpushsettings.ValidateSubject(subject); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if req.Msg.GetExpectedRevision() <= 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("expected_revision must be positive"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update platform web push subject transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)
	current, err := txq.LockPlatformWebPushConfig(ctx)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// The read that yields a revision generates the row, so none means
		// the caller read nothing that is still here.
		return nil, connect.NewError(connect.CodeFailedPrecondition, errPlatformWebPushConflict)
	case err != nil:
		return nil, s.internalDBError(ctx, "failed to lock platform web push settings", err)
	}
	if req.Msg.GetExpectedRevision() != current.Revision {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errPlatformWebPushConflict)
	}
	updated, err := txq.UpdatePlatformWebPushSubject(ctx, subject)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update platform web push subject", err)
	}

	if actor, ok := platformActorFromContext(ctx); ok {
		if err := auditlog.WritePlatform(ctx, txq, s.logger, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "platform_webpush_subject_updated",
			TargetType:          webPushSettingsAuditTargetType,
			TargetID:            webPushSettingsAuditTargetID,
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to audit platform web push subject", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit platform web push subject", err)
	}

	return connect.NewResponse(&publirasplatformv1.UpdatePlatformWebPushSubjectResponse{
		Settings: platformWebPushSettingsToProto(webpushsettings.FromConfig(updated)),
	}), nil
}
