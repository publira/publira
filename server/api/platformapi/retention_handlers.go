package platformapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/retention"
)

// errPlatformRetentionConflict is what a save based on a revision the stored
// row has moved past reports.
var errPlatformRetentionConflict = errors.New("platform retention defaults have changed since they were read")

func retentionPeriodsToProto(periods retention.Periods) *publirattypesv1.RetentionPeriods {
	return &publirattypesv1.RetentionPeriods{
		WithdrawnCommentDays:      int32(periods.WithdrawnCommentDays),
		ContentEventDays:          int32(periods.ContentEventDays),
		DailyRankingSnapshotDays:  int32(periods.DailyRankingSnapshotDays),
		WeeklyRankingSnapshotDays: int32(periods.WeeklyRankingSnapshotDays),
	}
}

// retentionPeriodsFromProto reads a request. A missing message reads as zeros,
// which Validate refuses, so an omitted period cannot be saved.
func retentionPeriodsFromProto(periods *publirattypesv1.RetentionPeriods) retention.Periods {
	return retention.Periods{
		WithdrawnCommentDays:      int(periods.GetWithdrawnCommentDays()),
		ContentEventDays:          int(periods.GetContentEventDays()),
		DailyRankingSnapshotDays:  int(periods.GetDailyRankingSnapshotDays()),
		WeeklyRankingSnapshotDays: int(periods.GetWeeklyRankingSnapshotDays()),
	}
}

func (s *platformServer) GetPlatformRetentionDefaults(
	ctx context.Context,
	_ *connect.Request[publirasplatformv1.GetPlatformRetentionDefaultsRequest],
) (*connect.Response[publirasplatformv1.GetPlatformRetentionDefaultsResponse], error) {
	defaults, revision, err := retention.ReadDefaults(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read platform retention defaults", err)
	}
	return connect.NewResponse(&publirasplatformv1.GetPlatformRetentionDefaultsResponse{
		Defaults: retentionPeriodsToProto(defaults),
		Revision: revision,
	}), nil
}

// writePlatformRetention locks the row, compares its revision with the one the
// request states, and writes only when they match. The audit entry commits
// with the write, so a change to how long every tenant's data is kept never
// goes unrecorded.
func (s *platformServer) writePlatformRetention(
	ctx context.Context,
	defaults retention.Periods,
	expectedRevision int64,
	audit *auditlog.PlatformEntry,
) (dbmodels.PlatformRetentionConfig, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformRetentionConfig{}, s.internalDBError(ctx, "failed to begin update platform retention defaults transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)
	params := defaults.PlatformConfigParams()

	var updated dbmodels.PlatformRetentionConfig
	current, err := txq.LockPlatformRetentionConfig(ctx)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if expectedRevision != 0 {
			return dbmodels.PlatformRetentionConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformRetentionConflict)
		}
		updated, err = txq.InsertPlatformRetentionConfig(ctx, dbmodels.InsertPlatformRetentionConfigParams(params))
		if err != nil {
			// Two first saves both find nothing to lock; the primary key
			// settles which one wins.
			if dberr.IsUniqueViolation(err) {
				return dbmodels.PlatformRetentionConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformRetentionConflict)
			}
			return dbmodels.PlatformRetentionConfig{}, s.internalDBError(ctx, "failed to create platform retention defaults", err)
		}
	case err != nil:
		return dbmodels.PlatformRetentionConfig{}, s.internalDBError(ctx, "failed to lock platform retention defaults", err)
	default:
		if expectedRevision != current.Revision {
			return dbmodels.PlatformRetentionConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformRetentionConflict)
		}
		updated, err = txq.UpdatePlatformRetentionConfig(ctx, params)
		if err != nil {
			return dbmodels.PlatformRetentionConfig{}, s.internalDBError(ctx, "failed to update platform retention defaults", err)
		}
	}

	if audit != nil {
		if err := auditlog.WritePlatform(ctx, txq, s.logger, *audit); err != nil {
			return dbmodels.PlatformRetentionConfig{}, s.internalDBError(ctx, "failed to audit platform retention defaults", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformRetentionConfig{}, s.internalDBError(ctx, "failed to commit platform retention defaults", err)
	}
	return updated, nil
}

func (s *platformServer) UpdatePlatformRetentionDefaults(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformRetentionDefaultsRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformRetentionDefaultsResponse], error) {
	if req.Msg.GetDefaults() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("defaults is required"))
	}
	defaults := retentionPeriodsFromProto(req.Msg.GetDefaults())
	if err := defaults.Validate(); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if req.Msg.ExpectedRevision < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("expected_revision must not be negative"))
	}

	var audit *auditlog.PlatformEntry
	if actor, ok := platformActorFromContext(ctx); ok {
		audit = &auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "platform_retention_defaults_updated",
			TargetType:          "platform_retention",
			TargetID:            "platform",
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		}
	}
	updated, err := s.writePlatformRetention(ctx, defaults, req.Msg.ExpectedRevision, audit)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publirasplatformv1.UpdatePlatformRetentionDefaultsResponse{
		Defaults: retentionPeriodsToProto(retention.FromPlatformConfig(updated)),
		Revision: updated.Revision,
	}), nil
}
