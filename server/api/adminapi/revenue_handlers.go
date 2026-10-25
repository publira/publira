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
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenanttz"
)

const (
	defaultRevenueStatsPageSize = int32(20)
	maxRevenueStatsPageSize     = int32(100)
)

var errRevenueGroupBy = errors.New("group_by is required")

// revenueReport is what every grouping is read against: the tenant, the
// period in its zone, and the one currency its amounts are added up in.
type revenueReport struct {
	tenantID uuid.UUID
	period   statsPeriod
	timeZone string
	currency string
}

// revenueRankedRow is one series or episode of a ranked report, from
// whichever direction the page was scanned in.
type revenueRankedRow struct {
	id  uuid.UUID
	row *publiraadminv1.RevenueStatsRow
}

func revenueStatsRow(purchaseCount, grossAmount, refundedAmount int64) *publiraadminv1.RevenueStatsRow {
	return &publiraadminv1.RevenueStatsRow{
		PurchaseCount:  purchaseCount,
		GrossAmount:    grossAmount,
		RefundedAmount: refundedAmount,
		NetAmount:      grossAmount - refundedAmount,
	}
}

// revenueListKey binds a ranked report's tokens to its grouping and its
// period, since a boundary row sits elsewhere once either changes.
func revenueListKey(groupBy publiraadminv1.RevenueGroupBy, period statsPeriod) pagination.ListKey {
	order := "series_net_amount_desc"
	if groupBy == publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_EPISODE {
		order = "episode_net_amount_desc"
	}
	return pagination.NewListKey(order).
		Value("from", period.start.Format(time.DateOnly)).
		Value("to", period.end.Format(time.DateOnly))
}

func (s *adminServer) revenueByDay(ctx context.Context, report revenueReport) ([]*publiraadminv1.RevenueStatsRow, error) {
	days, err := s.queriesFor(ctx).ListRevenueByDay(ctx, dbmodels.ListRevenueByDayParams{
		TenantID:  report.tenantID,
		Currency:  report.currency,
		TimeZone:  report.timeZone,
		StartDate: report.period.start,
		EndDate:   report.period.end,
	})
	if err != nil {
		return nil, err
	}
	rows := make([]*publiraadminv1.RevenueStatsRow, 0, len(days))
	for _, day := range days {
		row := revenueStatsRow(day.PurchaseCount, day.GrossAmount, day.RefundedAmount)
		row.Date = day.SaleDate.Format(time.DateOnly)
		rows = append(rows, row)
	}
	return rows, nil
}

func (s *adminServer) seriesRevenuePage(
	ctx context.Context,
	report revenueReport,
	keys pagination.CountUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]revenueRankedRow, error) {
	queries := s.queriesFor(ctx)
	cursorID := uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid}
	cursorNet := sql.NullInt64{Int64: keys.Count, Valid: keys.Valid}
	mapped := []revenueRankedRow{}
	add := func(row dbmodels.ListSeriesRevenueDescRow) {
		stats := revenueStatsRow(row.PurchaseCount, row.GrossAmount, row.RefundedAmount)
		stats.SeriesPublicId = row.SeriesPublicID
		stats.SeriesTitle = row.SeriesTitle
		mapped = append(mapped, revenueRankedRow{id: row.SeriesID, row: stats})
	}

	if direction == pagination.Backward {
		rows, err := queries.ListSeriesRevenueAsc(ctx, dbmodels.ListSeriesRevenueAscParams{
			TenantID:        report.tenantID,
			Currency:        report.currency,
			TimeZone:        report.timeZone,
			StartDate:       report.period.start,
			EndDate:         report.period.end,
			CursorSeriesID:  cursorID,
			CursorNetAmount: cursorNet,
			CursorInclusive: keys.Inclusive,
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			add(dbmodels.ListSeriesRevenueDescRow(row))
		}
		return mapped, nil
	}

	rows, err := queries.ListSeriesRevenueDesc(ctx, dbmodels.ListSeriesRevenueDescParams{
		TenantID:        report.tenantID,
		Currency:        report.currency,
		TimeZone:        report.timeZone,
		StartDate:       report.period.start,
		EndDate:         report.period.end,
		CursorSeriesID:  cursorID,
		CursorNetAmount: cursorNet,
		CursorInclusive: keys.Inclusive,
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		add(row)
	}
	return mapped, nil
}

func (s *adminServer) episodeRevenuePage(
	ctx context.Context,
	report revenueReport,
	keys pagination.CountUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]revenueRankedRow, error) {
	queries := s.queriesFor(ctx)
	cursorID := uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid}
	cursorNet := sql.NullInt64{Int64: keys.Count, Valid: keys.Valid}
	mapped := []revenueRankedRow{}
	add := func(row dbmodels.ListEpisodeRevenueDescRow) {
		stats := revenueStatsRow(row.PurchaseCount, row.GrossAmount, row.RefundedAmount)
		stats.SeriesPublicId = row.SeriesPublicID
		stats.SeriesTitle = row.SeriesTitle
		stats.EpisodePublicId = row.EpisodePublicID
		stats.EpisodeTitle = row.EpisodeTitle
		mapped = append(mapped, revenueRankedRow{id: row.EpisodeID, row: stats})
	}

	if direction == pagination.Backward {
		rows, err := queries.ListEpisodeRevenueAsc(ctx, dbmodels.ListEpisodeRevenueAscParams{
			TenantID:        report.tenantID,
			Currency:        report.currency,
			TimeZone:        report.timeZone,
			StartDate:       report.period.start,
			EndDate:         report.period.end,
			CursorEpisodeID: cursorID,
			CursorNetAmount: cursorNet,
			CursorInclusive: keys.Inclusive,
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			add(dbmodels.ListEpisodeRevenueDescRow(row))
		}
		return mapped, nil
	}

	rows, err := queries.ListEpisodeRevenueDesc(ctx, dbmodels.ListEpisodeRevenueDescParams{
		TenantID:        report.tenantID,
		Currency:        report.currency,
		TimeZone:        report.timeZone,
		StartDate:       report.period.start,
		EndDate:         report.period.end,
		CursorEpisodeID: cursorID,
		CursorNetAmount: cursorNet,
		CursorInclusive: keys.Inclusive,
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		add(row)
	}
	return mapped, nil
}

// GetRevenueStats reports what a tenant's purchases earned over a period of
// its days, cut by day, by series, or by episode. It reads purchases
// themselves, so a sale made a moment ago, and a refund that arrived since a
// day was last read, are both in it.
func (s *adminServer) GetRevenueStats(
	ctx context.Context,
	req *publiraadminv1.GetRevenueStatsRequest,
) (*publiraadminv1.GetRevenueStatsResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
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
	case publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_DAY,
		publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_SERIES,
		publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_EPISODE:
	default:
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errRevenueGroupBy, "group_by")
	}

	ranked := req.GroupBy != publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_DAY
	listKey := revenueListKey(req.GroupBy, period)
	limit := pagination.NormalizeLimit(req.Limit, defaultRevenueStatsPageSize, maxRevenueStatsPageSize)
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

	currency, err := paymentsettings.TenantCurrency(ctx, s.queriesFor(ctx), tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the tenant currency", err, "tenant_id", tenant.ID.String())
	}
	report := revenueReport{
		tenantID: tenant.ID,
		period:   period,
		timeZone: tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
		currency: currency,
	}

	totals, err := s.queriesFor(ctx).GetRevenueTotals(ctx, dbmodels.GetRevenueTotalsParams{
		TenantID:  report.tenantID,
		Currency:  report.currency,
		TimeZone:  report.timeZone,
		StartDate: report.period.start,
		EndDate:   report.period.end,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to total revenue", err, "tenant_id", tenant.ID.String())
	}

	res := &publiraadminv1.GetRevenueStatsResponse{
		StartDate: period.start.Format(time.DateOnly),
		EndDate:   period.end.Format(time.DateOnly),
		TimeZone:  report.timeZone,
		Currency:  report.currency,
		Totals: &publiraadminv1.RevenueStatsTotals{
			PurchaseCount:  totals.PurchaseCount,
			GrossAmount:    totals.GrossAmount,
			RefundedAmount: totals.RefundedAmount,
			NetAmount:      totals.GrossAmount - totals.RefundedAmount,
		},
	}

	if !ranked {
		res.Rows, err = s.revenueByDay(ctx, report)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list revenue by day", err, "tenant_id", tenant.ID.String())
		}
		return res, nil
	}

	var rows []revenueRankedRow
	if req.GroupBy == publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_SERIES {
		rows, err = s.seriesRevenuePage(ctx, report, keys, cursor.Direction, limit+1)
	} else {
		rows, err = s.episodeRevenuePage(ctx, report, keys, cursor.Direction, limit+1)
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list revenue", err,
			"tenant_id", tenant.ID.String(), "group_by", req.GroupBy.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	res.Rows = make([]*publiraadminv1.RevenueStatsRow, 0, len(rows))
	for _, row := range rows {
		res.Rows = append(res.Rows, row.row)
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = listKey.EncodeCountUUID(pagination.Backward, rows[0].row.NetAmount, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = listKey.EncodeCountUUID(pagination.Forward, last.row.NetAmount, last.id)
		}
	// An empty page means the boundary row left the report: a refund lowers a
	// row's net and moves it down the order. Hand back a token to where the
	// client came from, and recover only once, as ListEpisodeReadThrough does.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = listKey.EncodeCountUUIDRecovery(pagination.Backward, keys.Count, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = listKey.EncodeCountUUIDRecovery(pagination.Forward, keys.Count, keys.ID)
	}

	return res, nil
}
