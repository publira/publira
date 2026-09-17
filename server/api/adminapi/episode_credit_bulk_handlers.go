package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// maxBulkEpisodeCreditEpisodes bounds the range one call may name. Every
// episode in it stays locked until the transaction commits, so the bound is
// what keeps one correction from holding a whole series while it runs. It sits
// above the roughly 800 episodes a weekly quarter-chapter series reaches, so a
// correction still covers such a series in one call.
const maxBulkEpisodeCreditEpisodes = 1000

// bulkCreditOutcome is what one operation did, expressed the way the response
// reports it: the episodes it wrote on, and the reason it gave the rest. Each
// operation is one statement over the whole range, so the outcome is read back
// from what that statement returned rather than accumulated episode by
// episode.
type bulkCreditOutcome struct {
	changed        map[uuid.UUID]struct{}
	unchangedCause publiraadminv1.EpisodeCreditUnchangedReason
	// guests names the episodes whose only matching credit is their own, so a
	// replace or a remove can say that rather than "not credited". An add has
	// none: it conflicts with a credit of either provenance.
	guests map[uuid.UUID]struct{}
}

func (s *adminServer) BulkEditEpisodeCredits(
	ctx context.Context,
	req *connect.Request[publiraadminv1.BulkEditEpisodeCreditsRequest],
) (*connect.Response[publiraadminv1.BulkEditEpisodeCreditsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	seriesPublicID := strings.TrimSpace(req.Msg.SeriesPublicId)
	if seriesPublicID == "" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("series_public_id is required"), "series_public_id")
	}
	episodePublicIDs := make([]string, 0, len(req.Msg.EpisodePublicIds))
	for _, publicID := range req.Msg.EpisodePublicIds {
		episodePublicIDs = append(episodePublicIDs, strings.TrimSpace(publicID))
	}
	if err := validateDistinctPublicIDs(episodePublicIDs, "episode_public_ids", "episode"); err != nil {
		return nil, err
	}
	if len(episodePublicIDs) > maxBulkEpisodeCreditEpisodes {
		return nil, rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			fmt.Errorf("episode_public_ids must name at most %d episodes", maxBulkEpisodeCreditEpisodes),
			"episode_public_ids",
		)
	}
	// Both ends of every credit the operation names, resolved together: one
	// read of the creators and one of the roles, whether the operation names
	// one pair or two. A replace naming the same credit on both sides is the
	// duplicate pair resolveCreatorCredits already refuses.
	pairs, field := bulkCreditPairs(req.Msg)
	if len(pairs) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("an operation is required"))
	}
	credits, err := s.resolveCreatorCredits(ctx, tenant.ID, pairs, field)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin bulk edit episode credits transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	seriesID, err := s.queriesFor(txCtx).LockSeriesByPublicIDForTenant(txCtx, dbmodels.LockSeriesByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: seriesPublicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeNotFound, errors.New("series not found"), "series_public_id")
		}
		return nil, s.internalDBError(ctx, "failed to lock series for bulk edit episode credits", err, "tenant_id", tenant.ID.String(), "series_public_id", seriesPublicID)
	}
	// Resolving the range and locking it is one statement, so an episode of
	// another series or another tenant is simply absent from the result and
	// the count settles it. A separate read that named the offending episode
	// would cost a second round trip to say what the console already knows:
	// the range it composed came from this series' own episode list.
	locked, err := s.queriesFor(txCtx).LockEpisodesByPublicIDsForTenantAndSeries(txCtx, dbmodels.LockEpisodesByPublicIDsForTenantAndSeriesParams{
		TenantID:  tenant.ID,
		SeriesID:  seriesID,
		PublicIds: episodePublicIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to lock episodes for bulk edit episode credits", err, "tenant_id", tenant.ID.String(), "series_public_id", seriesPublicID)
	}
	if len(locked) != len(episodePublicIDs) {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("episode_public_ids names an episode this series does not have"), "episode_public_ids")
	}
	episodeIDByPublicID := make(map[string]uuid.UUID, len(locked))
	episodeIDs := make([]uuid.UUID, 0, len(locked))
	for _, row := range locked {
		episodeIDByPublicID[row.PublicID] = row.ID
		episodeIDs = append(episodeIDs, row.ID)
	}

	outcome, err := s.applyBulkCreditOperation(txCtx, tenant.ID, episodeIDs, req.Msg, credits)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit bulk edit episode credits", err, "tenant_id", tenant.ID.String(), "series_public_id", seriesPublicID)
	}

	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "episode_credits_bulk_edited",
			TargetType:  "series",
			TargetID:    seriesPublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if len(outcome.changed) > 0 && s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, episodeScheduleRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after bulk edit episode credits", "tenant_public_id", tenant.PublicID, "series_public_id", seriesPublicID, "error", err)
		}
	}

	// Reported in the order the request listed the episodes, which is the
	// order the console's range picker composed and the order it shows the
	// result in.
	changed := make([]string, 0, len(outcome.changed))
	unchanged := make([]*publiraadminv1.UnchangedEpisodeCredit, 0, len(episodePublicIDs)-len(outcome.changed))
	for _, publicID := range episodePublicIDs {
		episodeID := episodeIDByPublicID[publicID]
		if _, ok := outcome.changed[episodeID]; ok {
			changed = append(changed, publicID)
			continue
		}
		reason := outcome.unchangedCause
		if _, ok := outcome.guests[episodeID]; ok {
			reason = publiraadminv1.EpisodeCreditUnchangedReason_EPISODE_CREDIT_UNCHANGED_REASON_CREDITED_ON_THE_EPISODE
		}
		unchanged = append(unchanged, &publiraadminv1.UnchangedEpisodeCredit{
			EpisodePublicId: publicID,
			Reason:          reason,
		})
	}
	return connect.NewResponse(&publiraadminv1.BulkEditEpisodeCreditsResponse{
		ChangedEpisodePublicIds: changed,
		UnchangedEpisodes:       unchanged,
	}), nil
}

// bulkCreditPairs reads the (creator, role) pairs out of whichever operation
// the request carries, in the order resolveCreatorCredits answers them in: the
// credit being acted on first, and for a replace the one it becomes second. It
// names the operation's own field alongside them, so a violation points at the
// half of the dialog that has to change.
func bulkCreditPairs(msg *publiraadminv1.BulkEditEpisodeCreditsRequest) ([][2]string, string) {
	switch operation := msg.GetOperation().(type) {
	case *publiraadminv1.BulkEditEpisodeCreditsRequest_Add:
		return creatorCreditPairs([]*publiraadminv1.EpisodeCreatorCredit{operation.Add.GetCredit()}), "add"
	case *publiraadminv1.BulkEditEpisodeCreditsRequest_Replace:
		return creatorCreditPairs([]*publiraadminv1.EpisodeCreatorCredit{
			operation.Replace.GetFrom(),
			operation.Replace.GetTo(),
		}), "replace"
	case *publiraadminv1.BulkEditEpisodeCreditsRequest_Remove:
		return creatorCreditPairs([]*publiraadminv1.EpisodeCreatorCredit{operation.Remove.GetCredit()}), "remove"
	case *publiraadminv1.BulkEditEpisodeCreditsRequest_SetShare:
		return creatorCreditPairs([]*publiraadminv1.EpisodeCreatorCredit{operation.SetShare.GetCredit()}), "set_share"
	default:
		return nil, ""
	}
}

// applyBulkCreditOperation runs the one statement the operation amounts to and
// reads the outcome back from the rows it returned.
func (s *adminServer) applyBulkCreditOperation(
	ctx context.Context,
	tenantID uuid.UUID,
	episodeIDs []uuid.UUID,
	msg *publiraadminv1.BulkEditEpisodeCreditsRequest,
	credits []creatorCredit,
) (bulkCreditOutcome, error) {
	switch msg.GetOperation().(type) {
	case *publiraadminv1.BulkEditEpisodeCreditsRequest_Add:
		written, err := s.queriesFor(ctx).BulkAddEpisodeCreator(ctx, dbmodels.BulkAddEpisodeCreatorParams{
			TenantID:   tenantID,
			EpisodeIds: episodeIDs,
			CreatorID:  credits[0].creator.ID,
			RoleID:     credits[0].role.ID,
		})
		if err != nil {
			return bulkCreditOutcome{}, s.internalDBError(ctx, "failed to add episode credits in bulk", err, "tenant_id", tenantID.String())
		}
		return bulkCreditOutcome{
			changed:        episodeIDSet(written),
			unchangedCause: publiraadminv1.EpisodeCreditUnchangedReason_EPISODE_CREDIT_UNCHANGED_REASON_ALREADY_CREDITED,
		}, nil

	case *publiraadminv1.BulkEditEpisodeCreditsRequest_Replace:
		if err := s.refuseDuplicatingBulkCredit(ctx, tenantID, episodeIDs, credits); err != nil {
			return bulkCreditOutcome{}, err
		}
		written, err := s.queriesFor(ctx).BulkReplaceEpisodeCreator(ctx, dbmodels.BulkReplaceEpisodeCreatorParams{
			TenantID:     tenantID,
			EpisodeIds:   episodeIDs,
			CreatorID:    credits[0].creator.ID,
			RoleID:       credits[0].role.ID,
			NewCreatorID: credits[1].creator.ID,
			NewRoleID:    credits[1].role.ID,
		})
		if err != nil {
			return bulkCreditOutcome{}, s.internalDBError(ctx, "failed to replace episode credits in bulk", err, "tenant_id", tenantID.String())
		}
		guests, err := s.episodesCreditingOnTheirOwn(ctx, tenantID, episodeIDs, credits[0])
		if err != nil {
			return bulkCreditOutcome{}, err
		}
		return bulkCreditOutcome{
			changed:        episodeIDSet(written),
			unchangedCause: publiraadminv1.EpisodeCreditUnchangedReason_EPISODE_CREDIT_UNCHANGED_REASON_NOT_CREDITED,
			guests:         guests,
		}, nil

	case *publiraadminv1.BulkEditEpisodeCreditsRequest_Remove:
		written, err := s.queriesFor(ctx).BulkRemoveEpisodeCreator(ctx, dbmodels.BulkRemoveEpisodeCreatorParams{
			TenantID:   tenantID,
			EpisodeIds: episodeIDs,
			CreatorID:  credits[0].creator.ID,
			RoleID:     credits[0].role.ID,
		})
		if err != nil {
			return bulkCreditOutcome{}, s.internalDBError(ctx, "failed to remove episode credits in bulk", err, "tenant_id", tenantID.String())
		}
		guests, err := s.episodesCreditingOnTheirOwn(ctx, tenantID, episodeIDs, credits[0])
		if err != nil {
			return bulkCreditOutcome{}, err
		}
		return bulkCreditOutcome{
			changed:        episodeIDSet(written),
			unchangedCause: publiraadminv1.EpisodeCreditUnchangedReason_EPISODE_CREDIT_UNCHANGED_REASON_NOT_CREDITED,
			guests:         guests,
		}, nil

	case *publiraadminv1.BulkEditEpisodeCreditsRequest_SetShare:
		share := msg.GetSetShare().GetCredit().GetShareBps()
		if err := validateCreditShares([]int32{share}, "set_share"); err != nil {
			return bulkCreditOutcome{}, err
		}
		exceeding, err := s.queriesFor(ctx).ListEpisodesExceedingShareAfterBulkSet(ctx, dbmodels.ListEpisodesExceedingShareAfterBulkSetParams{
			TenantID: tenantID, EpisodeIds: episodeIDs, CreatorID: credits[0].creator.ID, RoleID: credits[0].role.ID, ShareBps: share,
		})
		if err != nil {
			return bulkCreditOutcome{}, s.internalDBError(ctx, "failed to check episode credit shares", err, "tenant_id", tenantID.String())
		}
		if len(exceeding) > 0 {
			return bulkCreditOutcome{}, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("the share_bps total would exceed 10000 on %d episode(s)", len(exceeding)))
		}
		written, err := s.queriesFor(ctx).BulkSetEpisodeCreatorShare(ctx, dbmodels.BulkSetEpisodeCreatorShareParams{
			TenantID: tenantID, EpisodeIds: episodeIDs, CreatorID: credits[0].creator.ID, RoleID: credits[0].role.ID, ShareBps: share,
		})
		if err != nil {
			return bulkCreditOutcome{}, s.internalDBError(ctx, "failed to set episode credit shares in bulk", err, "tenant_id", tenantID.String())
		}
		return bulkCreditOutcome{
			changed:        episodeIDSet(written),
			unchangedCause: publiraadminv1.EpisodeCreditUnchangedReason_EPISODE_CREDIT_UNCHANGED_REASON_NOT_CREDITED,
		}, nil

	default:
		return bulkCreditOutcome{}, connect.NewError(connect.CodeInvalidArgument, errors.New("an operation is required"))
	}
}

// refuseDuplicatingBulkCredit stops a replace that would credit the same
// person twice in the same role on an episode that already carries the credit
// it would become. The unique constraint would refuse the statement anyway,
// with an error naming neither the episodes nor what to do about them.
func (s *adminServer) refuseDuplicatingBulkCredit(
	ctx context.Context,
	tenantID uuid.UUID,
	episodeIDs []uuid.UUID,
	credits []creatorCredit,
) error {
	conflicting, err := s.queriesFor(ctx).ListEpisodesHoldingBothEpisodeCredits(ctx, dbmodels.ListEpisodesHoldingBothEpisodeCreditsParams{
		TenantID:     tenantID,
		EpisodeIds:   episodeIDs,
		CreatorID:    credits[0].creator.ID,
		RoleID:       credits[0].role.ID,
		NewCreatorID: credits[1].creator.ID,
		NewRoleID:    credits[1].role.ID,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to check for duplicate episode credits", err, "tenant_id", tenantID.String())
	}
	if len(conflicting) > 0 {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf(
			"%d episode(s) in the range already credit %s as %s",
			len(conflicting), credits[1].creator.Name, credits[1].role.Name,
		))
	}
	return nil
}

func (s *adminServer) episodesCreditingOnTheirOwn(
	ctx context.Context,
	tenantID uuid.UUID,
	episodeIDs []uuid.UUID,
	credit creatorCredit,
) (map[uuid.UUID]struct{}, error) {
	rows, err := s.queriesFor(ctx).ListEpisodesCreditedOnTheEpisodeItself(ctx, dbmodels.ListEpisodesCreditedOnTheEpisodeItselfParams{
		TenantID:   tenantID,
		EpisodeIds: episodeIDs,
		CreatorID:  credit.creator.ID,
		RoleID:     credit.role.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episodes crediting the pair on their own", err, "tenant_id", tenantID.String())
	}
	return episodeIDSet(rows), nil
}

func episodeIDSet(episodeIDs []uuid.UUID) map[uuid.UUID]struct{} {
	set := make(map[uuid.UUID]struct{}, len(episodeIDs))
	for _, episodeID := range episodeIDs {
		set[episodeID] = struct{}{}
	}
	return set
}
