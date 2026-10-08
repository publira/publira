package publicapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// episodeGrantKindCreator is the episode_content_grants kind of an account
// linked to a creator the episode credits.
const episodeGrantKindCreator = "creator"

// episodeGrantKind answers which grant opens the episode to the reader, or ""
// when none does. The creator grant is reported ahead of any other the reader
// also holds, so the answer is episodeGrantKindCreator exactly when the reader
// is credited on the episode.
func (s *apiServer) episodeGrantKind(ctx context.Context, tenantID, userID, episodeID uuid.UUID) (string, error) {
	kind, err := s.queriesFor(ctx).GetEpisodeEntitlementSource(ctx, dbmodels.GetEpisodeEntitlementSourceParams{
		TenantID:  tenantID,
		UserID:    userID,
		EpisodeID: episodeID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", s.internalDBError(ctx, "failed to get the reader's episode grant", err,
			"tenant_id", tenantID.String(), "user_id", userID.String(), "episode_id", episodeID.String())
	}
	return kind, nil
}

// readerCreditedOnEpisodeError refuses a sale or a rating of the reader's own
// episode, which would count the creator's reading as a reader's.
func readerCreditedOnEpisodeError() error {
	return rpcerrors.NewErrorInfoError(connect.CodePermissionDenied,
		errors.New("the reader is credited on this episode"), rpcerrors.ReasonReaderCreditedOnEpisode)
}

// refuseCreditedReader answers readerCreditedOnEpisodeError when the reader is
// credited on the episode.
func (s *apiServer) refuseCreditedReader(ctx context.Context, tenantID, userID, episodeID uuid.UUID) error {
	kind, err := s.episodeGrantKind(ctx, tenantID, userID, episodeID)
	if err != nil {
		return err
	}
	if kind == episodeGrantKindCreator {
		return readerCreditedOnEpisodeError()
	}
	return nil
}
