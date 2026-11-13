package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/publishepisodes"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantwebhooks"
)

// episodeDeletionBlockers maps what GetEpisodeDeletionBlocker answers to the
// ErrorInfo reason the refusal carries.
var episodeDeletionBlockers = map[string]string{
	"purchase":          rpcerrors.ReasonEpisodePurchased,
	"store_purchase":    rpcerrors.ReasonEpisodeStorePurchased,
	"pending_payment":   rpcerrors.ReasonEpisodePaymentPending,
	"access_ticket":     rpcerrors.ReasonEpisodeAccessTicketIssued,
	"royalty_statement": rpcerrors.ReasonEpisodeOnRoyaltyStatement,
	"coin_payment":      rpcerrors.ReasonEpisodePaidWithCoins,
	"promotion_code":    rpcerrors.ReasonEpisodePromotionCodeRedeemed,
	"published_volume":  rpcerrors.ReasonEpisodeInPublishedVolume,
}

func (s *adminServer) DeleteEpisode(
	ctx context.Context,
	req *publiraadminv1.DeleteEpisodeRequest,
) (*publiraadminv1.DeleteEpisodeResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}

	var deleted dbmodels.LockEpisodeForDeletionRow
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		row, err := s.deleteEpisode(txCtx, tenant.ID, episodeID)
		if err != nil {
			return nil, err
		}
		deleted = row
		// The episode leaves every list and page that showed it, as one taken
		// back to a draft does, and its series' search document is rebuilt
		// without it.
		return publishepisodes.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "episode_deleted",
		TargetType:  "episode",
		TargetID:    deleted.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      deleted.Title,
		ClientIP:    clientip.FromContext(ctx),
	})
	return &publiraadminv1.DeleteEpisodeResponse{}, nil
}

// deleteEpisode deletes the episode in the transaction txCtx carries, or
// refuses it with the reason the first reference that has to be kept names.
// It answers the row it locked, which still names what was deleted.
func (s *adminServer) deleteEpisode(txCtx context.Context, tenantID, episodeID uuid.UUID) (dbmodels.LockEpisodeForDeletionRow, error) {
	q := s.queriesFor(txCtx)
	fail := func(msg string, err error) error {
		return s.internalDBError(txCtx, msg, err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}

	episode, err := q.LockEpisodeForDeletion(txCtx, dbmodels.LockEpisodeForDeletionParams{TenantID: tenantID, ID: episodeID})
	if errors.Is(err, sql.ErrNoRows) {
		return episode, connect.NewError(connect.CodeNotFound, "episode not found")
	}
	if err != nil {
		return episode, fail("failed to lock the episode for deletion", err)
	}
	if _, err := q.LockVolumesHoldingEpisode(txCtx, dbmodels.LockVolumesHoldingEpisodeParams{TenantID: tenantID, EpisodeID: episodeID}); err != nil {
		return episode, fail("failed to lock the volumes holding the episode", err)
	}
	if _, err := q.LockSeriesBundlesNamingEpisode(txCtx, dbmodels.LockSeriesBundlesNamingEpisodeParams{TenantID: tenantID, EpisodeID: episodeID}); err != nil {
		return episode, fail("failed to lock the bundle checkouts naming the episode", err)
	}
	published, err := q.LockEpisodeListingForDeletion(txCtx, dbmodels.LockEpisodeListingForDeletionParams{TenantID: tenantID, EpisodeID: episodeID})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return episode, fail("failed to lock the episode's listing", err)
	}

	blocker, err := q.GetEpisodeDeletionBlocker(txCtx, dbmodels.GetEpisodeDeletionBlockerParams{TenantID: tenantID, EpisodeID: episodeID})
	if err != nil {
		return episode, fail("failed to check what refers to the episode", err)
	}
	if blocker != "" {
		reason, ok := episodeDeletionBlockers[blocker]
		if !ok {
			return episode, s.internalError(txCtx, "the episode deletion check answered a reference this build does not know", fmt.Errorf("blocker %q", blocker), "tenant_id", tenantID.String(), "episode_id", episodeID.String())
		}
		return episode, rpcerrors.NewErrorInfoError(
			connect.CodeFailedPrecondition,
			fmt.Errorf("episode has a %s and cannot be deleted", blocker),
			reason,
		)
	}

	// The event is read from the episode's rows, so it is owed before they go.
	if published {
		if err := tenantwebhooks.QueueEpisodeDeleted(txCtx, q, tenantID, episodeID); err != nil {
			return episode, fail("failed to queue the episode.unpublished webhook", err)
		}
	}
	if err := q.DeleteEpisodeFromUnsoldVolumes(txCtx, dbmodels.DeleteEpisodeFromUnsoldVolumesParams{TenantID: tenantID, EpisodeID: episodeID}); err != nil {
		return episode, fail("failed to take the episode out of volumes never on sale", err)
	}
	if err := q.DeleteEpisodeFromUnpaidSeriesBundles(txCtx, dbmodels.DeleteEpisodeFromUnpaidSeriesBundlesParams{TenantID: tenantID, EpisodeID: episodeID}); err != nil {
		return episode, fail("failed to take the episode out of unpaid bundle checkouts", err)
	}
	if err := q.DeleteEpisodeContentEvents(txCtx, dbmodels.DeleteEpisodeContentEventsParams{TenantID: tenantID, EpisodeID: episodeID}); err != nil {
		return episode, fail("failed to delete the episode's content events", err)
	}
	if err := q.DeleteEpisodeByIDForTenant(txCtx, dbmodels.DeleteEpisodeByIDForTenantParams{TenantID: tenantID, ID: episodeID}); err != nil {
		return episode, fail("failed to delete the episode", err)
	}
	if err := q.DeleteEpisodePromotionCodes(txCtx, dbmodels.DeleteEpisodePromotionCodesParams{TenantID: tenantID, EpisodeID: episodeID}); err != nil {
		return episode, fail("failed to delete the promotion codes for the episode", err)
	}
	if err := catalogindex.Queue(txCtx, q, tenantID, catalogindex.SeriesRef(episode.SeriesID)); err != nil {
		return episode, fail("failed to queue the search index sync for the episode's series", err)
	}
	return episode, nil
}
