package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantconn"
)

const (
	// The rating's ceiling, which the stored column carries as a CHECK.
	// Clamping here as well keeps a client that reports a burst of presses from
	// turning into a constraint violation.
	maxEpisodeRatingScore = 5

	// The press modes, as tenant_config and series_listings spell them.
	episodeRatingModeSingle   = "single"
	episodeRatingModeMultiple = "multiple"
)

// scopeRatingUser applies the member half of the episode_ratings policy to the
// request connection, so the reader writes and reads their own ratings and sees
// nobody else's. Direct handler tests use sqlmock and borrow no request
// connection.
func (s *apiServer) scopeRatingUser(ctx context.Context, userID uuid.UUID) error {
	conn, ok := rpcmiddleware.TenantConnFromContext(ctx)
	if !ok {
		return nil
	}
	if err := tenantconn.SetUser(ctx, conn, userID); err != nil {
		return s.internalDBError(ctx, "failed to set rating member context", err, "user_id", userID.String())
	}
	return nil
}

// resolveRatingEpisode starts every RPC in this file from the public catalog
// query, the way the follow target does: a foreign, unpublished, or missing
// episode is NotFound before anything of the reader's is read or written.
//
// The row it returns carries the stored tally as well, so the reply the reader
// gets back costs one read rather than two.
func (s *apiServer) resolveRatingEpisode(
	ctx context.Context,
	tenantID uuid.UUID,
	episodePublicID string,
) (dbmodels.GetPublishedEpisodeByPublicIDForTenantRow, error) {
	publicID := strings.TrimSpace(episodePublicID)
	if publicID == "" {
		return dbmodels.GetPublishedEpisodeByPublicIDForTenantRow{},
			connect.NewError(connect.CodeInvalidArgument, errors.New("episode public id is required"))
	}
	row, err := s.queriesFor(ctx).GetPublishedEpisodeByPublicIDForTenant(ctx, dbmodels.GetPublishedEpisodeByPublicIDForTenantParams{
		TenantID: tenantID,
		PublicID: publicID,
	})
	if err == nil {
		return row, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.GetPublishedEpisodeByPublicIDForTenantRow{},
			connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
	}
	return dbmodels.GetPublishedEpisodeByPublicIDForTenantRow{},
		s.internalDBError(ctx, "failed to get rating episode target", err, "tenant_id", tenantID.String())
}

// readerMayReadEpisode answers whether this reader may open the episode's body:
// free to everyone, or granted to them by a purchase or an access ticket. It is
// the same rule the episode detail applies before it attaches that body.
func (s *apiServer) readerMayReadEpisode(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	row dbmodels.GetPublishedEpisodeByPublicIDForTenantRow,
) (bool, error) {
	if row.Price == 0 || row.FreeUntil.Valid {
		return true, nil
	}
	granted, err := s.queriesFor(ctx).UserHasEpisodeContentAccess(ctx, dbmodels.UserHasEpisodeContentAccessParams{
		TenantID:  tenantID,
		UserID:    userID,
		EpisodeID: row.ID,
	})
	if err != nil {
		return false, s.internalDBError(ctx, "failed to check episode content access for a rating", err,
			"tenant_id", tenantID.String(), "user_id", userID.String())
	}
	return granted.Valid && granted.Bool, nil
}

// episodeRatingMode reads the press mode governing one episode: its series' own
// answer, or the tenant's.
func (s *apiServer) episodeRatingMode(ctx context.Context, tenantID, episodeID uuid.UUID) (publirav1.EpisodeRatingMode, error) {
	mode, err := s.queriesFor(ctx).GetEpisodeRatingMode(ctx, dbmodels.GetEpisodeRatingModeParams{
		TenantID:  tenantID,
		EpisodeID: episodeID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// A published episode always has a row here, so no row means the catalog
		// changed under the request rather than that the mode is unset.
		return 0, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
	}
	if err != nil {
		return 0, s.internalDBError(ctx, "failed to get the episode rating mode", err, "tenant_id", tenantID.String())
	}
	switch mode {
	case episodeRatingModeSingle:
		return publirav1.EpisodeRatingMode_EPISODE_RATING_MODE_SINGLE, nil
	case episodeRatingModeMultiple:
		return publirav1.EpisodeRatingMode_EPISODE_RATING_MODE_MULTIPLE, nil
	default:
		// Not a guess: rendering a five-press control where the tenant asked for
		// one press is a different product than the one they configured.
		return 0, s.internalError(ctx, "episode rating mode holds a value this build does not know",
			errors.New("unknown episode rating mode "+mode), "tenant_id", tenantID.String())
	}
}

// ratingPoints is what one call adds to the reader's score. A single-press
// tenant gives the whole rating at once, which is what keeps a stored score
// meaning the same thing after the tenant opens the rating up to five.
func ratingPoints(mode publirav1.EpisodeRatingMode, presses int32) int16 {
	if mode == publirav1.EpisodeRatingMode_EPISODE_RATING_MODE_SINGLE {
		return maxEpisodeRatingScore
	}
	if presses < 1 {
		return 1
	}
	if presses > maxEpisodeRatingScore {
		return maxEpisodeRatingScore
	}
	return int16(presses)
}

// GetMyEpisodeRating answers how far this reader has taken their rating, how
// many readers have given one, and which control the episode should render.
func (s *apiServer) GetMyEpisodeRating(
	ctx context.Context,
	req *connect.Request[publirav1.GetMyEpisodeRatingRequest],
) (*connect.Response[publirav1.GetMyEpisodeRatingResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.scopeRatingUser(ctx, user.ID); err != nil {
		return nil, err
	}
	row, err := s.resolveRatingEpisode(ctx, tenant.ID, req.Msg.EpisodePublicId)
	if err != nil {
		return nil, err
	}
	mode, err := s.episodeRatingMode(ctx, tenant.ID, row.ID)
	if err != nil {
		return nil, err
	}

	// No row is a reader who has not rated the episode, which is a score of
	// zero rather than a failure.
	score, err := s.queriesFor(ctx).GetMyEpisodeRating(ctx, dbmodels.GetMyEpisodeRatingParams{
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: row.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to get the reader's episode rating", err,
			"tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	return noStorePrivateResponse(&publirav1.GetMyEpisodeRatingResponse{
		Score:       int32(score),
		RatingCount: row.RatingCount,
		Mode:        mode,
	}), nil
}

// RateEpisode records this reader's rating of an episode they may read, or
// raises the one they already gave.
func (s *apiServer) RateEpisode(
	ctx context.Context,
	req *connect.Request[publirav1.RateEpisodeRequest],
) (*connect.Response[publirav1.RateEpisodeResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionRateEpisode, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	if err := s.scopeRatingUser(ctx, user.ID); err != nil {
		return nil, err
	}
	row, err := s.resolveRatingEpisode(ctx, tenant.ID, req.Msg.EpisodePublicId)
	if err != nil {
		return nil, err
	}
	mayRead, err := s.readerMayReadEpisode(ctx, tenant.ID, user.ID, row)
	if err != nil {
		return nil, err
	}
	if !mayRead {
		// The answer an unpublished or foreign episode gets, so this RPC cannot
		// be used to tell the episodes a reader has no access to apart from the
		// ones that are not there. MarkEpisodeAsRead answers the same way.
		return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
	}
	mode, err := s.episodeRatingMode(ctx, tenant.ID, row.ID)
	if err != nil {
		return nil, err
	}

	rating, err := s.storeEpisodeRating(ctx, tenant.ID, user.ID, row, ratingPoints(mode, req.Msg.Presses))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the episode rating", err,
			"tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	return noStorePrivateResponse(&publirav1.RateEpisodeResponse{
		Score:       int32(rating.score),
		RatingCount: rating.count,
		Mode:        mode,
	}), nil
}

// storedRating is what a press leaves behind: the reader's own score and the
// tally the episode now stands at.
type storedRating struct {
	score int16
	count int64
}

// storeEpisodeRating raises the reader's score and files the event for the
// points it actually added, in one transaction.
//
// One transaction because the two are one fact, and because the tally the
// trigger derives from the rating has to be read on the far side of it. An
// event written beside the rating rather than with it would simply be missing:
// nothing reconciles ratings afterwards.
//
// A reader already at 5 adds nothing, and no event is filed. Their press is not
// an error — they have said everything the control lets them say — so the reply
// is the score they are already at.
func (s *apiServer) storeEpisodeRating(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	episode dbmodels.GetPublishedEpisodeByPublicIDForTenantRow,
	points int16,
) (storedRating, error) {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return storedRating{}, err
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	// Taken before the score is read, because the event this files carries the
	// difference the press made. Two presses arriving at once would otherwise
	// each read the same starting score and each claim the whole difference,
	// and the day would count more points than the reader gave.
	// Taken before the score is read, because the event this files carries the
	// difference the press made. Two presses arriving at once would otherwise
	// each read the same starting score and each claim the whole difference,
	// and the day would count more points than the reader gave.
	if err := txq.LockEpisodeRating(ctx, dbmodels.LockEpisodeRatingParams{
		TenantID:  tenantID,
		UserID:    userID,
		EpisodeID: episode.ID,
	}); err != nil {
		return storedRating{}, err
	}

	before, err := txq.GetMyEpisodeRating(ctx, dbmodels.GetMyEpisodeRatingParams{
		TenantID:  tenantID,
		UserID:    userID,
		EpisodeID: episode.ID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return storedRating{}, err
	}
	rating, err := txq.RateEpisode(ctx, dbmodels.RateEpisodeParams{
		TenantID:  tenantID,
		UserID:    userID,
		EpisodeID: episode.ID,
		Points:    points,
	})
	if err != nil {
		return storedRating{}, err
	}
	if added := rating.Score - before; added > 0 {
		eventID, idErr := uuid.NewV7()
		if idErr != nil {
			return storedRating{}, idErr
		}
		// series_id comes from the episode row the server read, so a rating can
		// only ever be filed under the series that episode actually belongs to.
		if _, err := txq.InsertRatingEvent(ctx, dbmodels.InsertRatingEventParams{
			ID:          eventID,
			TenantID:    tenantID,
			UserID:      userID,
			SeriesID:    episode.SeriesID,
			EpisodeID:   uuid.NullUUID{UUID: episode.ID, Valid: true},
			RatingScore: added,
			OccurredAt:  time.Now().UTC(),
		}); err != nil {
			return storedRating{}, err
		}
	}

	count, err := txq.GetEpisodeRatingCount(ctx, dbmodels.GetEpisodeRatingCountParams{
		TenantID:  tenantID,
		EpisodeID: episode.ID,
	})
	if err != nil {
		return storedRating{}, err
	}
	if err := tx.Commit(); err != nil {
		return storedRating{}, err
	}
	return storedRating{score: rating.Score, count: count}, nil
}
