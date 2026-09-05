package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/tenanttz"
)

const (
	defaultEpisodeReadThroughPageSize = int32(20)
	maxEpisodeReadThroughPageSize     = int32(100)

	// readThroughWindowDays is how many of the tenant's days the report covers,
	// counted back from the last day the daily aggregate can have finished.
	// Four whole weeks so every weekday contributes equally: a window of 30
	// days weights two of them twice and makes the number move when the month
	// does.
	readThroughWindowDays = 28
)

// episodeReadThroughRow is one aggregated episode, from whichever sort
// direction the page was scanned in.
type episodeReadThroughRow struct {
	episodeID       uuid.UUID
	completeCount   int64
	memberViewCount int64
	episodePublicID string
	episodeTitle    string
	seriesPublicID  string
	seriesTitle     string
}

func mapEpisodeReadThroughDescRows(rows []dbmodels.ListEpisodeReadThroughDescRow) []episodeReadThroughRow {
	mapped := make([]episodeReadThroughRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, episodeReadThroughRow{
			episodeID:       row.EpisodeID,
			completeCount:   row.CompleteCount,
			memberViewCount: row.MemberViewCount,
			episodePublicID: row.EpisodePublicID,
			episodeTitle:    row.EpisodeTitle,
			seriesPublicID:  row.SeriesPublicID,
			seriesTitle:     row.SeriesTitle,
		})
	}
	return mapped
}

func mapEpisodeReadThroughAscRows(rows []dbmodels.ListEpisodeReadThroughAscRow) []episodeReadThroughRow {
	mapped := make([]episodeReadThroughRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, episodeReadThroughRow{
			episodeID:       row.EpisodeID,
			completeCount:   row.CompleteCount,
			memberViewCount: row.MemberViewCount,
			episodePublicID: row.EpisodePublicID,
			episodeTitle:    row.EpisodeTitle,
			seriesPublicID:  row.SeriesPublicID,
			seriesTitle:     row.SeriesTitle,
		})
	}
	return mapped
}

// readThroughPeriod is the closed range of stat dates the report covers. The
// dates are the tenant's calendar days, which is what content_daily_stats
// stores, so the range is compared against stat_date as written.
type readThroughPeriod struct {
	start time.Time
	end   time.Time
}

// resolveReadThroughPeriod ends the window on the last day the tenant has
// finished, read in the tenant's own zone. Today is still accumulating, and
// its stats row does not exist until the batch runs after that tenant's
// midnight, so including it would put a partial day beside whole ones and make
// the rate look like it fell.
//
// The dates come back at midnight UTC because they name calendar days rather
// than instants: the queries bind them to a date column, and UTC keeps the day
// arithmetic on them exact.
func resolveReadThroughPeriod(now time.Time, location *time.Location) readThroughPeriod {
	year, month, day := now.In(location).AddDate(0, 0, -1).Date()
	end := time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
	return readThroughPeriod{
		start: end.AddDate(0, 0, -(readThroughWindowDays - 1)),
		end:   end,
	}
}

func (s *adminServer) episodeReadThroughPage(
	ctx context.Context,
	tenantID uuid.UUID,
	period readThroughPeriod,
	keys pagination.CountUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]episodeReadThroughRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListEpisodeReadThroughAsc(ctx, dbmodels.ListEpisodeReadThroughAscParams{
			TenantID:            tenantID,
			PeriodStart:         period.start,
			PeriodEnd:           period.end,
			CursorEntityID:      uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorCompleteCount: sql.NullInt64{Int64: keys.Count, Valid: keys.Valid},
			CursorInclusive:     keys.Inclusive,
			Limit:               limit,
		})
		if err != nil {
			return nil, err
		}
		return mapEpisodeReadThroughAscRows(rows), nil
	}

	rows, err := queries.ListEpisodeReadThroughDesc(ctx, dbmodels.ListEpisodeReadThroughDescParams{
		TenantID:            tenantID,
		PeriodStart:         period.start,
		PeriodEnd:           period.end,
		CursorEntityID:      uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorCompleteCount: sql.NullInt64{Int64: keys.Count, Valid: keys.Valid},
		CursorInclusive:     keys.Inclusive,
		Limit:               limit,
	})
	if err != nil {
		return nil, err
	}
	return mapEpisodeReadThroughDescRows(rows), nil
}

// ListEpisodeReadThrough reports how many members finished each episode over a
// fixed recent window, alongside the member views that finishing was measured
// against.
//
// Both counts read content_daily_stats rather than content_events: the report
// spans weeks, and the raw log is purged long before that window is. Which
// means an episode read today appears here once the daily aggregate has run,
// not the moment the member finishes it.
func (s *adminServer) ListEpisodeReadThrough(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListEpisodeReadThroughRequest],
) (*connect.Response[publiraadminv1.ListEpisodeReadThroughResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultEpisodeReadThroughPageSize, maxEpisodeReadThroughPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.CountUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeCountUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	timeZone := tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx)))
	location, err := time.LoadLocation(timeZone)
	if err != nil {
		// A stored zone nothing can load leaves no honest day to count in.
		// Reporting the period in some other zone would be a different report
		// wearing this one's numbers, so the read fails instead.
		return nil, s.internalError(ctx, "failed to load the tenant time zone", err,
			"tenant_id", tenant.ID.String(), "time_zone", timeZone)
	}
	period := resolveReadThroughPeriod(time.Now(), location)

	totals, err := s.queriesFor(ctx).GetEpisodeReadThroughTotals(ctx, dbmodels.GetEpisodeReadThroughTotalsParams{
		TenantID:    tenant.ID,
		PeriodStart: period.start,
		PeriodEnd:   period.end,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to total episode read-through", err, "tenant_id", tenant.ID.String())
	}

	rows, err := s.episodeReadThroughPage(ctx, tenant.ID, period, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode read-through", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	episodes := make([]*publiraadminv1.EpisodeReadThrough, 0, len(rows))
	for _, row := range rows {
		episodes = append(episodes, &publiraadminv1.EpisodeReadThrough{
			SeriesPublicId:  row.seriesPublicID,
			SeriesTitle:     row.seriesTitle,
			EpisodePublicId: row.episodePublicID,
			EpisodeTitle:    row.episodeTitle,
			CompleteCount:   row.completeCount,
			MemberViewCount: row.memberViewCount,
		})
	}

	res := &publiraadminv1.ListEpisodeReadThroughResponse{
		Episodes:             episodes,
		PeriodStart:          period.start.Format(time.DateOnly),
		PeriodEnd:            period.end.Format(time.DateOnly),
		TotalCompleteCount:   totals.CompleteCount,
		TotalMemberViewCount: totals.MemberViewCount,
		TimeZone:             timeZone,
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeCountUUID(pagination.Backward, rows[0].completeCount, rows[0].episodeID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeCountUUID(pagination.Forward, last.completeCount, last.episodeID)
		}
	// An empty page means the boundary row left the report — a re-aggregation
	// can move an episode's completions, and the window itself slides daily.
	// Hand back a token to where the client came from, and recover only once:
	// a recovery token that also comes back empty leaves both tokens empty so
	// the client falls back to the first page instead of bouncing.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeCountUUIDRecovery(pagination.Backward, keys.Count, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeCountUUIDRecovery(pagination.Forward, keys.Count, keys.ID)
	}

	return connect.NewResponse(res), nil
}
