package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenanttz"
)

const (
	defaultAudienceStatsPageSize = int32(20)
	maxAudienceStatsPageSize     = int32(100)
)

var (
	errAudienceGroupBy        = errors.New("group_by is required")
	errAudienceSeriesNotFound = errors.New("series not found")
)

// audienceReport is what every grouping is read against: the tenant, the
// period in its zone, and the one series it is narrowed to, if any.
type audienceReport struct {
	tenantID uuid.UUID
	period   statsPeriod
	timeZone string
	seriesID uuid.NullUUID
}

// audienceRankedRow is one series of a series report, from whichever
// direction the page was scanned in.
type audienceRankedRow struct {
	id  uuid.UUID
	row *publiraadminv1.AudienceStatsRow
}

// audienceListKey binds a series report's tokens to its period and the series
// it is narrowed to, since a boundary row sits elsewhere once either changes.
func audienceListKey(report audienceReport) pagination.ListKey {
	key := pagination.NewListKey("series_follower_count_desc").
		Value("from", report.period.start.Format(time.DateOnly)).
		Value("to", report.period.end.Format(time.DateOnly))
	if report.seriesID.Valid {
		key = key.Value("series", report.seriesID.UUID.String())
	}
	return key
}

func (s *adminServer) audienceByDay(ctx context.Context, report audienceReport) ([]*publiraadminv1.AudienceStatsRow, error) {
	days, err := s.queriesFor(ctx).ListAudienceByDay(ctx, dbmodels.ListAudienceByDayParams{
		TenantID:  report.tenantID,
		SeriesID:  report.seriesID,
		TimeZone:  report.timeZone,
		StartDate: report.period.start,
		EndDate:   report.period.end,
	})
	if err != nil {
		return nil, err
	}
	rows := make([]*publiraadminv1.AudienceStatsRow, 0, len(days))
	for _, day := range days {
		rows = append(rows, &publiraadminv1.AudienceStatsRow{
			Date:            day.StatDate.Format(time.DateOnly),
			FollowerCount:   day.FollowerCount,
			FollowedCount:   day.FollowedCount,
			UnfollowedCount: day.UnfollowedCount,
			ViewCount:       day.ViewCount,
			CompleteCount:   day.CompleteCount,
			ReactionCount:   day.ReactionCount,
			ReactionPoints:  day.ReactionPoints,
		})
	}
	return rows, nil
}

func (s *adminServer) seriesAudiencePage(
	ctx context.Context,
	report audienceReport,
	keys pagination.CountUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]audienceRankedRow, error) {
	queries := s.queriesFor(ctx)
	cursorID := uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid}
	cursorFollowers := sql.NullInt64{Int64: keys.Count, Valid: keys.Valid}
	mapped := []audienceRankedRow{}
	add := func(row dbmodels.ListSeriesAudienceDescRow) {
		mapped = append(mapped, audienceRankedRow{id: row.SeriesID, row: &publiraadminv1.AudienceStatsRow{
			SeriesPublicId:  row.SeriesPublicID,
			SeriesTitle:     row.SeriesTitle,
			FollowerCount:   row.FollowerCount,
			FollowedCount:   row.FollowedCount,
			UnfollowedCount: row.UnfollowedCount,
			ViewCount:       row.ViewCount,
			CompleteCount:   row.CompleteCount,
			ReactionCount:   row.ReactionCount,
			ReactionPoints:  row.ReactionPoints,
			RatingAverage:   row.RatingAverage,
			RatingCount:     row.RatingCount,
		}})
	}

	if direction == pagination.Backward {
		rows, err := queries.ListSeriesAudienceAsc(ctx, dbmodels.ListSeriesAudienceAscParams{
			TenantID:            report.tenantID,
			SeriesID:            report.seriesID,
			TimeZone:            report.timeZone,
			StartDate:           report.period.start,
			EndDate:             report.period.end,
			CursorSeriesID:      cursorID,
			CursorFollowerCount: cursorFollowers,
			CursorInclusive:     keys.Inclusive,
			Limit:               limit,
		})
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			add(dbmodels.ListSeriesAudienceDescRow(row))
		}
		return mapped, nil
	}

	rows, err := queries.ListSeriesAudienceDesc(ctx, dbmodels.ListSeriesAudienceDescParams{
		TenantID:            report.tenantID,
		SeriesID:            report.seriesID,
		TimeZone:            report.timeZone,
		StartDate:           report.period.start,
		EndDate:             report.period.end,
		CursorSeriesID:      cursorID,
		CursorFollowerCount: cursorFollowers,
		CursorInclusive:     keys.Inclusive,
		Limit:               limit,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		add(row)
	}
	return mapped, nil
}

// GetAudienceStats reports how a tenant's series were followed, read, and
// reacted to over a period of its days, cut by day or by series. Followers are
// read from the tallies the follows themselves keep, so a follow made a moment
// ago is in them; the rest waits for the daily aggregates.
func (s *adminServer) GetAudienceStats(
	ctx context.Context,
	req *publiraadminv1.GetAudienceStatsRequest,
) (*publiraadminv1.GetAudienceStatsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	period, err := parseStatsPeriod(req.StartDate, req.EndDate)
	if err != nil {
		return nil, err
	}
	switch req.GroupBy {
	case publiraadminv1.AudienceGroupBy_AUDIENCE_GROUP_BY_DAY,
		publiraadminv1.AudienceGroupBy_AUDIENCE_GROUP_BY_SERIES:
	default:
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errAudienceGroupBy, "group_by")
	}

	report := audienceReport{
		tenantID: tenant.ID,
		period:   period,
		timeZone: tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}
	if req.SeriesPublicId != "" {
		series, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{
			TenantID: tenant.ID,
			PublicID: req.SeriesPublicId,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeNotFound, errAudienceSeriesNotFound, "series_public_id")
		}
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to resolve series for audience stats", err, "tenant_id", tenant.ID.String())
		}
		report.seriesID = uuid.NullUUID{UUID: series.ID, Valid: true}
	}

	ranked := req.GroupBy == publiraadminv1.AudienceGroupBy_AUDIENCE_GROUP_BY_SERIES
	listKey := audienceListKey(report)
	limit := pagination.NormalizeLimit(req.Limit, defaultAudienceStatsPageSize, maxAudienceStatsPageSize)
	var cursor pagination.Cursor
	var keys pagination.CountUUIDKeys
	if ranked {
		cursor, err = pagination.Decode(req.Token)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
		}
		if !cursor.IsZero() {
			keys, err = listKey.DecodeCountUUID(cursor)
			if err != nil {
				return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
			}
		}
	}

	totals, err := s.queriesFor(ctx).GetAudienceTotals(ctx, dbmodels.GetAudienceTotalsParams{
		TenantID:  report.tenantID,
		SeriesID:  report.seriesID,
		TimeZone:  report.timeZone,
		StartDate: report.period.start,
		EndDate:   report.period.end,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to total the audience", err, "tenant_id", tenant.ID.String())
	}

	res := &publiraadminv1.GetAudienceStatsResponse{
		StartDate: period.start.Format(time.DateOnly),
		EndDate:   period.end.Format(time.DateOnly),
		TimeZone:  report.timeZone,
		Totals: &publiraadminv1.AudienceStatsTotals{
			FollowerCount:   totals.FollowerCount,
			FollowedCount:   totals.FollowedCount,
			UnfollowedCount: totals.UnfollowedCount,
			ViewCount:       totals.ViewCount,
			CompleteCount:   totals.CompleteCount,
			ReactionCount:   totals.ReactionCount,
			ReactionPoints:  totals.ReactionPoints,
		},
	}

	if !ranked {
		res.Rows, err = s.audienceByDay(ctx, report)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list the audience by day", err, "tenant_id", tenant.ID.String())
		}
		return res, nil
	}

	rows, err := s.seriesAudiencePage(ctx, report, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the audience by series", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	res.Rows = make([]*publiraadminv1.AudienceStatsRow, 0, len(rows))
	for _, row := range rows {
		res.Rows = append(res.Rows, row.row)
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = listKey.EncodeCountUUID(pagination.Backward, rows[0].row.FollowerCount, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = listKey.EncodeCountUUID(pagination.Forward, last.row.FollowerCount, last.id)
		}
	// An empty page means the boundary row left the report: a follow ending
	// lowers a series' count and moves it down the order, and a deleted series
	// leaves it. Hand back a token to where the client came from, and recover
	// only once, as GetRevenueStats does.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = listKey.EncodeCountUUIDRecovery(pagination.Backward, keys.Count, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = listKey.EncodeCountUUIDRecovery(pagination.Forward, keys.Count, keys.ID)
	}

	return res, nil
}
