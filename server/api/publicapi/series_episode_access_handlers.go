package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

// GetSeriesEpisodeAccess answers, for every published episode of one series,
// the access state GetEpisodeDetail answers for that episode alone.
func (s *apiServer) GetSeriesEpisodeAccess(
	ctx context.Context,
	req *connect.Request[publirav1.GetSeriesEpisodeAccessRequest],
) (*connect.Response[publirav1.GetSeriesEpisodeAccessResponse], error) {
	seriesPublicID := strings.TrimSpace(req.Msg.SeriesPublicId)
	if seriesPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("series public id is required"))
	}
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	surface, err := callingSurface(req.Msg.Surface)
	if err != nil {
		return nil, err
	}
	series, err := s.queriesFor(ctx).GetPublishedSeriesAgeRatingByPublicID(ctx, dbmodels.GetPublishedSeriesAgeRatingByPublicIDParams{
		TenantID: tenant.ID,
		Surface:  surface,
		PublicID: seriesPublicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get series for episode access", err, "tenant_id", tenant.ID.String(), "series_public_id", seriesPublicID)
	}
	requiredMinimumAge, err := s.requiredMinimumAgeForSeries(ctx, tenant.ID, series.AgeRating)
	if err != nil {
		return nil, s.internalError(ctx, "failed to resolve the tenant age rule for a series", err, "tenant_id", tenant.ID.String(), "series_public_id", seriesPublicID)
	}

	// A rejected session reads as a guest. Any other failure is reported: a
	// guest's answer would offer a signed-in reader what they already hold.
	var reader dbmodels.User
	userID := uuid.NullUUID{}
	if _, hasBearer := auth.BearerTokenFromHeader(req.Header()); hasBearer {
		session, authErr := s.authenticateAccessToken(ctx, req.Msg.Tenant, req.Header())
		if authErr != nil {
			if connect.CodeOf(authErr) != connect.CodeUnauthenticated {
				return nil, authErr
			}
			slog.InfoContext(ctx, "series episode access: bearer session rejected, continuing without it",
				"tenant_id", tenant.ID,
				"series_public_id", seriesPublicID,
				"code", connect.CodeOf(authErr).String(),
			)
		} else {
			reader = session.User
			userID = uuid.NullUUID{UUID: reader.ID, Valid: true}
		}
	}

	clearsAgeGate, err := s.readerClearsMinimumAge(ctx, tenant, requiredMinimumAge, reader.BirthDate)
	if err != nil {
		return nil, s.internalError(ctx, "failed to check the reader against the tenant age rule", err, "tenant_id", tenant.ID.String(), "series_public_id", seriesPublicID)
	}

	rows, err := s.queriesFor(ctx).ListPublishedEpisodeAccessInSeries(ctx, dbmodels.ListPublishedEpisodeAccessInSeriesParams{
		Surface:  surface,
		UserID:   userID,
		TenantID: tenant.ID,
		SeriesID: series.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode access in a series", err, "tenant_id", tenant.ID.String(), "series_public_id", seriesPublicID)
	}
	res := &publirav1.GetSeriesEpisodeAccessResponse{
		Episodes: make([]*publirav1.SeriesEpisodeAccess, 0, len(rows)),
	}
	for _, row := range rows {
		res.Episodes = append(res.Episodes, &publirav1.SeriesEpisodeAccess{
			EpisodePublicId: row.PublicID,
			Access:          episodeAccessFor(clearsAgeGate, row.FreeToEveryone, row.HasGrant),
		})
	}
	return noStorePrivateResponse(res), nil
}

// episodeAccessFor is the order GetEpisodeDetail decides a body's access in:
// the age rule outranks the price, and a free body outranks a grant.
func episodeAccessFor(clearsAgeGate, freeToEveryone, hasGrant bool) publirav1.EpisodeAccess {
	switch {
	case !clearsAgeGate:
		return publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED
	case freeToEveryone:
		return publirav1.EpisodeAccess_EPISODE_ACCESS_FREE
	case hasGrant:
		return publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED
	default:
		return publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED
	}
}
