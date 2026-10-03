package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// seriesWaitFreeRule reads a series' wait-for-free rule, and reports false
// when the series does not offer one: no row, or a row an editor turned off.
func (s *apiServer) seriesWaitFreeRule(ctx context.Context, tenantID, seriesID uuid.UUID) (dbmodels.GetSeriesWaitFreeSettingsRow, bool, error) {
	rule, err := s.queriesFor(ctx).GetSeriesWaitFreeSettings(ctx, dbmodels.GetSeriesWaitFreeSettingsParams{
		TenantID: tenantID,
		SeriesID: seriesID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.GetSeriesWaitFreeSettingsRow{}, false, nil
	}
	if err != nil {
		return dbmodels.GetSeriesWaitFreeSettingsRow{}, false, s.internalDBError(ctx, "failed to get the series wait-free rule", err,
			"tenant_id", tenantID.String(), "series_id", seriesID.String())
	}
	return rule, rule.Enabled, nil
}

// waitFreeRuleFor is what GetSeriesDetail tells a reader about the rule. The
// excluded episodes are the last excluded_latest_count of the list it answers
// with, which holds the published episodes on the calling surface in
// (order_index, id) order: the same episodes GetWaitFreeEpisode counts as the
// latest when UseTicket refuses them.
func waitFreeRuleFor(rule dbmodels.GetSeriesWaitFreeSettingsRow, episodeIDs []string) *publirav1.WaitFreeRule {
	excluded := episodeIDs[max(0, len(episodeIDs)-int(rule.ExcludedLatestCount)):]
	return &publirav1.WaitFreeRule{
		RechargeHours:       rule.RechargeHours,
		AccessHours:         rule.AccessHours,
		ExcludedLatestCount: rule.ExcludedLatestCount,
		ExcludedEpisodeIds:  append([]string{}, excluded...),
	}
}

func waitFreeNotOfferedError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition,
		errors.New("the series does not offer wait-for-free"), rpcerrors.ReasonWaitFreeNotOffered)
}

func waitFreeEpisodeOpenError() error {
	return connect.NewError(connect.CodeAlreadyExists, errors.New("the reader can already open this episode"))
}

func waitFreeNotRechargedError(nextAvailableAt time.Time) error {
	return rpcerrors.NewErrorInfoErrorWithMetadata(connect.CodeFailedPrecondition,
		errors.New("the next wait-for-free ticket is not ready yet"), rpcerrors.ReasonWaitFreeNotRecharged,
		map[string]string{rpcerrors.MetadataNextAvailableAt: nextAvailableAt.UTC().Format(time.RFC3339)})
}

func (s *apiServer) GetMyTicketState(
	ctx context.Context,
	req *connect.Request[publirav1.GetMyTicketStateRequest],
) (*connect.Response[publirav1.GetMyTicketStateResponse], error) {
	seriesID, err := requestRecordID("series_id", req.Msg.SeriesId)
	if err != nil {
		return nil, err
	}
	surface, err := callingSurface(req.Msg.Surface)
	if err != nil {
		return nil, err
	}
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	series, err := s.queriesFor(ctx).GetPublishedSeriesAgeRating(ctx, dbmodels.GetPublishedSeriesAgeRatingParams{
		TenantID: tenant.ID,
		Surface:  surface,
		ID:       seriesID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get series for wait-free ticket state", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	if _, offered, err := s.seriesWaitFreeRule(ctx, tenant.ID, series.ID); err != nil {
		return nil, err
	} else if !offered {
		return nil, waitFreeNotOfferedError()
	}

	res := &publirav1.GetMyTicketStateResponse{}
	state, err := s.queriesFor(ctx).GetWaitFreeTicketState(ctx, dbmodels.GetWaitFreeTicketStateParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
		SeriesID: series.ID,
	})
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Never used here, so a ticket is ready.
	case err != nil:
		return nil, s.internalDBError(ctx, "failed to get the reader's wait-free ticket state", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	case state.Charging:
		res.NextAvailableAt = state.NextAvailableAt.UTC().Format(time.RFC3339)
	}

	open, err := s.queriesFor(ctx).ListOpenWaitFreeTicketsInSeries(ctx, dbmodels.ListOpenWaitFreeTicketsInSeriesParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
		SeriesID: series.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the reader's open wait-free tickets", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	res.OpenTickets = make([]*publirav1.WaitFreeTicket, 0, len(open))
	for _, ticket := range open {
		res.OpenTickets = append(res.OpenTickets, &publirav1.WaitFreeTicket{
			EpisodeId: ticket.EpisodeID.String(),
			ExpiresAt: ticket.ExpiresAt.Time.UTC().Format(time.RFC3339),
		})
	}
	return noStorePrivateResponse(res), nil
}

// UseTicket spends the reader's wait-for-free ticket on one episode.
//
// It does not charge the shared flood control: what it writes is bounded by
// the recharge interval itself, one ticket per series per interval, and every
// refusal writes nothing.
func (s *apiServer) UseTicket(
	ctx context.Context,
	req *connect.Request[publirav1.UseTicketRequest],
) (*connect.Response[publirav1.UseTicketResponse], error) {
	episodeID, err := requestRecordID("episode_id", req.Msg.EpisodeId)
	if err != nil {
		return nil, err
	}
	surface, err := callingSurface(req.Msg.Surface)
	if err != nil {
		return nil, err
	}
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	episode, err := s.queriesFor(ctx).GetWaitFreeEpisode(ctx, dbmodels.GetWaitFreeEpisodeParams{
		Surface:  surface,
		TenantID: tenant.ID,
		ID:       episodeID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get episode for a wait-free ticket", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	rule, offered, err := s.seriesWaitFreeRule(ctx, tenant.ID, episode.SeriesID)
	if err != nil {
		return nil, err
	}
	if !offered {
		return nil, waitFreeNotOfferedError()
	}

	// The age rule outranks every grant, so a ticket spent by a reader it stops
	// would open nothing.
	requiredMinimumAge, err := s.requiredMinimumAgeForSeries(ctx, tenant.ID, episode.AgeRating)
	if err != nil {
		return nil, s.internalError(ctx, "failed to resolve the tenant age rule for a series", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	clearsAgeGate, err := s.readerClearsMinimumAge(ctx, tenant, requiredMinimumAge, user.BirthDate)
	if err != nil {
		return nil, s.internalError(ctx, "failed to check the reader against the tenant age rule", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	if !clearsAgeGate {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("the tenant's age rule stops this reader from opening the series"))
	}

	if episode.FreeToEveryone {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition,
			errors.New("the episode is free to everyone"), rpcerrors.ReasonWaitFreeEpisodeFree)
	}
	// A reader who can already open the episode is told so before anything
	// about the rule: whatever else holds, a ticket would add nothing. This is
	// also what answers a repeated call once the first has committed.
	if kind, err := s.episodeGrantKind(ctx, tenant.ID, user.ID, episode.ID); err != nil {
		return nil, err
	} else if kind != "" {
		return nil, waitFreeEpisodeOpenError()
	}
	if episode.LaterEpisodeCount < rule.ExcludedLatestCount {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition,
			errors.New("the episode is one of the latest the series keeps a ticket off"), rpcerrors.ReasonWaitFreeEpisodeExcluded)
	}

	ticketID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin wait-free ticket transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	nextAvailableAt, err := q.ClaimWaitFreeTicket(ctx, dbmodels.ClaimWaitFreeTicketParams{
		TenantID:      tenant.ID,
		UserID:        user.ID,
		SeriesID:      episode.SeriesID,
		RechargeHours: rule.RechargeHours,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, s.unclaimedWaitFreeTicketError(ctx, q, tenant.ID, user.ID, episode.SeriesID, episode.ID)
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to claim a wait-free ticket", err, "tenant_id", tenant.ID.String(), "series_id", episode.SeriesID.String())
	}
	ticket, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.CreateWaitFreeAccessTicketRow, error) {
		return q.CreateWaitFreeAccessTicket(ctx, dbmodels.CreateWaitFreeAccessTicketParams{
			ID:          ticketID,
			TenantID:    tenant.ID,
			PublicID:    publicID,
			EpisodeID:   episode.ID,
			UserID:      user.ID,
			AccessHours: rule.AccessHours,
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create a wait-free access ticket", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit a wait-free ticket", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}

	return noStorePrivateResponse(&publirav1.UseTicketResponse{
		Ticket: &publirav1.WaitFreeTicket{
			EpisodeId: ticket.EpisodeID.String(),
			ExpiresAt: ticket.ExpiresAt.Time.UTC().Format(time.RFC3339),
		},
		NextAvailableAt: nextAvailableAt.UTC().Format(time.RFC3339),
	}), nil
}

// unclaimedWaitFreeTicketError explains a claim that found no ticket ready.
//
// The claim waits for a concurrent one on the same row to commit, so the usual
// reason it fails right after a grant check passed is the same reader's other
// request having just used the ticket — on this very episode, when a client
// sent the request twice. Each statement here reads what has committed since,
// so that reader is told the episode is open rather than to wait.
func (s *apiServer) unclaimedWaitFreeTicketError(ctx context.Context, q *dbmodels.Queries, tenantID, userID, seriesID, episodeID uuid.UUID) error {
	_, err := q.GetEpisodeEntitlementSource(ctx, dbmodels.GetEpisodeEntitlementSourceParams{
		TenantID:  tenantID,
		UserID:    userID,
		EpisodeID: episodeID,
	})
	if err == nil {
		return waitFreeEpisodeOpenError()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return s.internalDBError(ctx, "failed to get the reader's episode grant", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	state, err := q.GetWaitFreeTicketState(ctx, dbmodels.GetWaitFreeTicketStateParams{
		TenantID: tenantID,
		UserID:   userID,
		SeriesID: seriesID,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to get the reader's wait-free ticket state", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
	}
	return waitFreeNotRechargedError(state.NextAvailableAt)
}
