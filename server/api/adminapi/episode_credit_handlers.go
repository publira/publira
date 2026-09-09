package adminapi

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// creditSourceEpisode marks a credit an editor wrote on the episode itself,
// as against the `series` rows the bake writes. The distinction is what a
// range edit across episodes has to respect: it moves the standing team and
// leaves a guest where they were credited.
const creditSourceEpisode = "episode"

func (s *adminServer) ListEpisodeCredits(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListEpisodeCreditsRequest],
) (*connect.Response[publiraadminv1.ListEpisodeCreditsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	episode, err := s.episodeForCreditsByPublicID(ctx, tenant.ID, req.Msg.EpisodePublicId)
	if err != nil {
		return nil, err
	}
	credits, err := s.episodeCreditsByEpisodeIDs(ctx, []uuid.UUID{episode.ID})
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.ListEpisodeCreditsResponse{
		Creators: credits[episode.ID],
	}), nil
}

func (s *adminServer) ReplaceEpisodeCredits(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ReplaceEpisodeCreditsRequest],
) (*connect.Response[publiraadminv1.ReplaceEpisodeCreditsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	episode, err := s.episodeForCreditsByPublicID(ctx, tenant.ID, req.Msg.EpisodePublicId)
	if err != nil {
		return nil, err
	}
	credits, err := s.resolveCreatorCredits(ctx, tenant.ID, creatorCreditPairs(req.Msg.CreatorCredits))
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin replace episode credits transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	// What the episode carries now, so a credit the request keeps keeps saying
	// where it came from. Read inside the transaction that rewrites the set,
	// otherwise a concurrent save could turn a baked credit into one this call
	// records as the editor's own.
	existing, err := s.queriesFor(txCtx).ListEpisodeCreatorsByEpisodeIDs(txCtx, []uuid.UUID{episode.ID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode credits before replacing them", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	sourceByPair := make(map[[2]string]string, len(existing))
	for _, row := range existing {
		sourceByPair[[2]string{row.PublicID, row.RolePublicID.String}] = row.Source
	}

	if err := s.queriesFor(txCtx).DeleteEpisodeCreatorsByEpisodeID(txCtx, episode.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to delete episode credits", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	// display_order is the position in the request, which orders the creators
	// who share a role: the read sorts by role priority first, so a global
	// index keeps the order the editor gave within each role without carrying
	// a second counter.
	ordered := slices.SortedStableFunc(slices.Values(credits), func(left, right creatorCredit) int {
		return cmp.Compare(left.role.DisplayPriority, right.role.DisplayPriority)
	})
	for index, credit := range ordered {
		source, kept := sourceByPair[[2]string{credit.creator.PublicID, credit.role.PublicID}]
		if !kept {
			source = creditSourceEpisode
		}
		err := s.queriesFor(txCtx).CreateEpisodeCreator(txCtx, dbmodels.CreateEpisodeCreatorParams{
			TenantID:     tenant.ID,
			EpisodeID:    episode.ID,
			CreatorID:    credit.creator.ID,
			RoleID:       credit.role.ID,
			DisplayOrder: int32(index),
			Source:       source,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to create episode credit", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String(), "creator_id", credit.creator.ID.String())
		}
	}
	written, err := s.queriesFor(txCtx).ListEpisodeCreatorsByEpisodeIDs(txCtx, []uuid.UUID{episode.ID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode credits after replacing them", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit replace episode credits", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}

	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "episode_credits_replaced",
			TargetType:  "episode",
			TargetID:    episode.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, episodeScheduleRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after episode credits replace", "tenant_public_id", tenant.PublicID, "episode_public_id", episode.PublicID, "error", err)
		}
	}

	return connect.NewResponse(&publiraadminv1.ReplaceEpisodeCreditsResponse{
		Creators: protomapper.EpisodeCreditsByEpisodeID(written)[episode.ID],
	}), nil
}

// episodeForCreditsByPublicID resolves the episode a credit call names, as the
// not-found the console shows rather than as a write against nothing.
func (s *adminServer) episodeForCreditsByPublicID(
	ctx context.Context,
	tenantID uuid.UUID,
	publicID string,
) (dbmodels.GetEpisodeByPublicIDForTenantRow, error) {
	row, err := s.queriesFor(ctx).GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{
		TenantID: tenantID,
		PublicID: strings.TrimSpace(publicID),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetEpisodeByPublicIDForTenantRow{}, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return dbmodels.GetEpisodeByPublicIDForTenantRow{}, s.internalDBError(ctx, "failed to get episode", err, "tenant_id", tenantID.String(), "episode_public_id", publicID)
	}
	return row, nil
}

func (s *adminServer) episodeCreditsByEpisodeIDs(
	ctx context.Context,
	episodeIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.Creator, error) {
	if len(episodeIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.Creator{}, nil
	}
	rows, err := s.queriesFor(ctx).ListEpisodeCreatorsByEpisodeIDs(ctx, episodeIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode credits", err)
	}
	return protomapper.EpisodeCreditsByEpisodeID(rows), nil
}
