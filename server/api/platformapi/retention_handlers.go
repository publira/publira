package platformapi

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/retention"
	"github.com/publira/publira/server/internal/rpcerrors"
)

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

// platformRetentionError maps what retention refuses to this API's codes,
// naming the request field when the refusal has one.
func (s *platformServer) platformRetentionError(ctx context.Context, err error) error {
	if connectErr := rpcerrors.FromFieldError(err); connectErr != nil {
		return connectErr
	}
	if errors.Is(err, retention.ErrDefaultsConflict) {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	return s.internalDBError(ctx, "failed to save platform retention defaults", err)
}

func (s *platformServer) UpdatePlatformRetentionDefaults(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformRetentionDefaultsRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformRetentionDefaultsResponse], error) {
	if req.Msg.GetDefaults() == nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("defaults is required"), retention.FieldDefaults)
	}
	expectedRevision := req.Msg.GetExpectedRevision()
	params := retention.SaveDefaultsParams{
		Defaults:         retentionPeriodsFromProto(req.Msg.GetDefaults()),
		ExpectedRevision: &expectedRevision,
	}
	if err := params.Validate(); err != nil {
		return nil, s.platformRetentionError(ctx, err)
	}
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return nil, err
	}

	updated, err := retention.SaveDefaults(ctx, s.db, s.logger, actor, params)
	if err != nil {
		return nil, s.platformRetentionError(ctx, err)
	}
	return connect.NewResponse(&publirasplatformv1.UpdatePlatformRetentionDefaultsResponse{
		Defaults: retentionPeriodsToProto(retention.FromPlatformConfig(updated)),
		Revision: updated.Revision,
	}), nil
}
