package adminapi

import (
	"context"
	"database/sql"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/dayperiod"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenanttz"
)

// maxPublicationPeriodDays bounds the days ListEpisodesByPublicationDate reads
// over: two months of 31, so a calendar can ask for the month it shows and the
// one beside it.
const maxPublicationPeriodDays = 62

// The page size defaults to the maximum rather than to 20: a calendar reads
// every page of its period before it draws, so a smaller default only adds
// round trips.
const (
	defaultEpisodePublicationPageSize int32 = 100
	maxEpisodePublicationPageSize     int32 = 100
)

// ListEpisodesByPublicationDate answers every scheduled and published episode
// of the tenant whose publication falls within a period of the tenant's days.
func (s *adminServer) ListEpisodesByPublicationDate(
	ctx context.Context,
	req *publiraadminv1.ListEpisodesByPublicationDateRequest,
) (*publiraadminv1.ListEpisodesByPublicationDateResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	timeZone := tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx)))
	zone, err := time.LoadLocation(timeZone)
	if err != nil {
		return nil, s.internalError(ctx, "failed to load the tenant time zone", err,
			"tenant_id", tenant.ID.String(), "time_zone", timeZone)
	}
	period, err := dayperiod.Parse(req.StartDate, req.EndDate, maxPublicationPeriodDays, zone)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Limit, defaultEpisodePublicationPageSize, maxEpisodePublicationPageSize)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	// The period's midnights rather than its dates: the same dates name another
	// list once the tenant's time zone changes.
	listKey := pagination.NewListKey("published_at_asc").
		Time("from", period.From, true).
		Time("to", period.To, true)
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = listKey.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, rpcerrors.NewPageTokenError(err)
		}
	}

	rows, err := s.episodePublicationPage(ctx, tenant.ID, period, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episodes by publication date", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	episodes := make([]*publiraadminv1.EpisodePublication, 0, len(rows))
	for _, row := range rows {
		episodes = append(episodes, &publiraadminv1.EpisodePublication{
			SeriesPublicId:  row.SeriesPublicID,
			SeriesTitle:     row.SeriesTitle,
			EpisodePublicId: row.EpisodePublicID,
			EpisodeTitle:    row.EpisodeTitle,
			Status:          row.Status,
			PublishedAt:     row.PublishedAt.UTC().Format(time.RFC3339),
		})
	}

	res := &publiraadminv1.ListEpisodesByPublicationDateResponse{Episodes: episodes}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = listKey.EncodeTimeUUID(pagination.Backward, rows[0].PublishedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = listKey.EncodeTimeUUID(pagination.Forward, last.PublishedAt, last.ID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return res, nil
}

// episodePublicationPage reads one page of the period in the direction the
// token points, in the shape of the ascending query's rows.
func (s *adminServer) episodePublicationPage(
	ctx context.Context,
	tenantID uuid.UUID,
	period dayperiod.Period,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]dbmodels.ListEpisodesByPublicationTimeForTenantAscRow, error) {
	queries := s.queriesFor(ctx)
	cursorID := uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid}
	cursorPublishedAt := sql.NullTime{Time: keys.Time, Valid: keys.Valid}
	if direction == pagination.Backward {
		rows, err := queries.ListEpisodesByPublicationTimeForTenantDesc(ctx, dbmodels.ListEpisodesByPublicationTimeForTenantDescParams{
			TenantID:          tenantID,
			FromTime:          period.From,
			ToTime:            period.To,
			CursorID:          cursorID,
			CursorInclusive:   keys.Inclusive,
			CursorPublishedAt: cursorPublishedAt,
			Limit:             limit,
		})
		if err != nil {
			return nil, err
		}
		mapped := make([]dbmodels.ListEpisodesByPublicationTimeForTenantAscRow, 0, len(rows))
		for _, row := range rows {
			mapped = append(mapped, dbmodels.ListEpisodesByPublicationTimeForTenantAscRow(row))
		}
		return mapped, nil
	}
	return queries.ListEpisodesByPublicationTimeForTenantAsc(ctx, dbmodels.ListEpisodesByPublicationTimeForTenantAscParams{
		TenantID:          tenantID,
		FromTime:          period.From,
		ToTime:            period.To,
		CursorID:          cursorID,
		CursorInclusive:   keys.Inclusive,
		CursorPublishedAt: cursorPublishedAt,
		Limit:             limit,
	})
}
