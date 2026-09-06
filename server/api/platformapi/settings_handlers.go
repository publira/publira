package platformapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/locale"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/tenanttz"
)

// errPlatformSettingsConflict is what a save based on a revision the stored row
// has moved past reports. The caller re-reads and decides again rather than
// having its half of the row written over the half it never saw.
var errPlatformSettingsConflict = errors.New("platform settings have changed since they were read")

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

// writePlatformSettings applies the save inside one transaction: the settings
// row is locked, its revision compared with the one the request states, and the
// write skipped entirely when they differ. Reading before the lock would leave
// the same window the revision is there to close.
func (s *platformServer) writePlatformSettings(
	ctx context.Context,
	timezone, defaultLocale string,
	expectedRevision int64,
) (dbmodels.PlatformConfig, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformConfig{}, s.internalDBError(ctx, "failed to begin update platform settings transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	var updated dbmodels.PlatformConfig
	current, err := txq.LockPlatformConfig(ctx)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Only a request that states revision zero means "no settings saved
		// yet". Any other number was read from a row that has since been
		// deleted, and creating one from those values would resurrect settings
		// the caller never confirmed.
		if expectedRevision != 0 {
			return dbmodels.PlatformConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformSettingsConflict)
		}
		updated, err = txq.InsertPlatformSettings(ctx, dbmodels.InsertPlatformSettingsParams{
			DefaultTimezone: timezone,
			DefaultLocale:   defaultLocale,
		})
		if err != nil {
			// An absent row left nothing to lock, so two callers can reach this
			// insert together. The primary key on singleton settles it, and the
			// loser is told the row it meant to create exists now rather than
			// handed an internal error.
			if dberr.IsUniqueViolation(err) {
				return dbmodels.PlatformConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformSettingsConflict)
			}
			return dbmodels.PlatformConfig{}, s.internalDBError(ctx, "failed to create platform settings", err)
		}
	case err != nil:
		return dbmodels.PlatformConfig{}, s.internalDBError(ctx, "failed to lock platform settings", err)
	default:
		if expectedRevision != current.Revision {
			return dbmodels.PlatformConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformSettingsConflict)
		}
		updated, err = txq.UpdatePlatformSettings(ctx, dbmodels.UpdatePlatformSettingsParams{
			DefaultTimezone: timezone,
			DefaultLocale:   defaultLocale,
		})
		if err != nil {
			return dbmodels.PlatformConfig{}, s.internalDBError(ctx, "failed to update platform settings", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformConfig{}, s.internalDBError(ctx, "failed to commit platform settings", err)
	}
	return updated, nil
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
	if req.Msg.ExpectedRevision < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("expected_revision must not be negative"))
	}

	updated, err := s.writePlatformSettings(ctx, timezone, defaultLocale, req.Msg.ExpectedRevision)
	if err != nil {
		return nil, err
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
