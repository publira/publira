package adminapi

import (
	"context"
	"errors"
	"math"
	"strconv"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/csvexport"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// exportAllRows is the limit an export reads a ranked report with: all of it
// in one statement, so its rows are counted at the same moment and none moves
// between two pages of the file.
const exportAllRows = int32(math.MaxInt32)

var (
	errStatsExportKind            = errors.New("kind is required")
	errStatsExportSeriesNotNeeded = errors.New("series_public_id narrows an audience report only")
	errStatsExportEpisodeRequired = errors.New("episode_public_id is required for a drop-off report")
	errStatsExportEpisodeNotUsed  = errors.New("episode_public_id belongs to a drop-off report only")
)

// statsExport is one file: its bytes, and what the audit log records it as.
type statsExport struct {
	csv        []byte
	targetType string
	targetID   string
}

// ExportStats writes one of the engagement reports as CSV, every row of it,
// from the same reads the report's own RPC makes.
func (s *adminServer) ExportStats(
	ctx context.Context,
	req *publiraadminv1.ExportStatsRequest,
) (*publiraadminv1.ExportStatsResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	revenue := false
	switch req.Kind {
	case publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_DAY,
		publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_SERIES,
		publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_EPISODE:
		revenue = true
	case publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_AUDIENCE_BY_DAY,
		publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_AUDIENCE_BY_SERIES,
		publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_EPISODE_DROP_OFF:
	default:
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errStatsExportKind, "kind")
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	period, err := parseStatsPeriod(req.StartDate, req.EndDate)
	if err != nil {
		return nil, err
	}
	dropOff := req.Kind == publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_EPISODE_DROP_OFF
	audience := !revenue && !dropOff
	if req.SeriesPublicId != "" && !audience {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errStatsExportSeriesNotNeeded, "series_public_id")
	}
	if dropOff && req.EpisodePublicId == "" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errStatsExportEpisodeRequired, "episode_public_id")
	}
	if !dropOff && req.EpisodePublicId != "" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errStatsExportEpisodeNotUsed, "episode_public_id")
	}

	var export statsExport
	switch {
	case revenue:
		export, err = s.revenueExport(ctx, tenant, period, req.Kind)
	case audience:
		export, err = s.audienceExport(ctx, tenant, period, req.Kind, req.SeriesPublicId)
	default:
		export, err = s.dropOffExport(ctx, tenant, period, req.EpisodePublicId)
	}
	if err != nil {
		return nil, err
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID: tenant.ID, ActorUserID: sessionCtx.User.ID, ActorRole: sessionCtx.Role,
		Action: "stats_exported", TargetType: export.targetType, TargetID: export.targetID,
		Outcome: auditlog.OutcomeSuccess, ClientIP: clientip.FromContext(ctx),
	})
	return &publiraadminv1.ExportStatsResponse{Csv: export.csv}, nil
}

// statsPeriodID names a whole-tenant report in the audit log by its period, as
// an ISO 8601 interval of the two dates.
func statsPeriodID(period statsPeriod) string {
	return period.start.Format(time.DateOnly) + "/" + period.end.Format(time.DateOnly)
}

func (s *adminServer) revenueExport(
	ctx context.Context,
	tenant dbmodels.Tenant,
	period statsPeriod,
	kind publiraadminv1.StatsExportKind,
) (statsExport, error) {
	report, err := s.revenueReportFor(ctx, tenant, period)
	if err != nil {
		return statsExport{}, err
	}
	export := statsExport{targetType: "revenue_stats", targetID: statsPeriodID(period)}
	figures := func(row *publiraadminv1.RevenueStatsRow) []string {
		return []string{
			strconv.FormatInt(row.PurchaseCount, 10),
			strconv.FormatInt(row.GrossAmount, 10),
			strconv.FormatInt(row.RefundedAmount, 10),
			strconv.FormatInt(row.NetAmount, 10),
			report.currency,
		}
	}
	figureColumns := []string{"purchase_count", "gross_amount", "refunded_amount", "net_amount", "currency"}
	start, end := period.start.Format(time.DateOnly), period.end.Format(time.DateOnly)

	if kind == publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_DAY {
		rows, err := s.revenueByDay(ctx, report)
		if err != nil {
			return statsExport{}, s.internalDBError(ctx, "failed to list revenue by day", err, "tenant_id", tenant.ID.String())
		}
		// A subscription payment belongs to no series, so only the day report
		// carries its figures, before the currency they are in.
		w := csvexport.New("date", "purchase_count", "gross_amount", "refunded_amount", "net_amount",
			"subscription_amount", "subscription_refunded_amount", "currency")
		for _, row := range rows {
			w.Row(
				row.Date,
				strconv.FormatInt(row.PurchaseCount, 10),
				strconv.FormatInt(row.GrossAmount, 10),
				strconv.FormatInt(row.RefundedAmount, 10),
				strconv.FormatInt(row.NetAmount, 10),
				strconv.FormatInt(row.SubscriptionAmount, 10),
				strconv.FormatInt(row.SubscriptionRefundedAmount, 10),
				report.currency,
			)
		}
		export.csv = w.Bytes()
		return export, nil
	}

	var rows []revenueRankedRow
	var w *csvexport.Writer
	if kind == publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_SERIES {
		rows, err = s.seriesRevenuePage(ctx, report, pagination.CountUUIDKeys{}, pagination.Forward, exportAllRows)
		w = csvexport.New(append([]string{"start_date", "end_date", "series_id", "series_title"}, figureColumns...)...)
	} else {
		rows, err = s.episodeRevenuePage(ctx, report, pagination.CountUUIDKeys{}, pagination.Forward, exportAllRows)
		w = csvexport.New(append([]string{"start_date", "end_date", "series_id", "series_title", "episode_id", "episode_title"}, figureColumns...)...)
	}
	if err != nil {
		return statsExport{}, s.internalDBError(ctx, "failed to list revenue", err, "tenant_id", tenant.ID.String(), "kind", kind.String())
	}
	for _, ranked := range rows {
		row := ranked.row
		fields := []string{start, end, row.SeriesPublicId, row.SeriesTitle}
		if kind == publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_EPISODE {
			fields = append(fields, row.EpisodePublicId, row.EpisodeTitle)
		}
		w.Row(append(fields, figures(row)...)...)
	}
	export.csv = w.Bytes()
	return export, nil
}

func (s *adminServer) audienceExport(
	ctx context.Context,
	tenant dbmodels.Tenant,
	period statsPeriod,
	kind publiraadminv1.StatsExportKind,
	seriesPublicID string,
) (statsExport, error) {
	report, err := s.audienceReportFor(ctx, tenant, period, seriesPublicID)
	if err != nil {
		return statsExport{}, err
	}
	export := statsExport{targetType: "audience_stats", targetID: statsPeriodID(period)}
	if seriesPublicID != "" {
		export = statsExport{targetType: "series", targetID: seriesPublicID}
	}
	figures := func(row *publiraadminv1.AudienceStatsRow) []string {
		return []string{
			strconv.FormatInt(row.FollowerCount, 10),
			strconv.FormatInt(row.FollowedCount, 10),
			strconv.FormatInt(row.UnfollowedCount, 10),
			strconv.FormatInt(row.ViewCount, 10),
			strconv.FormatInt(row.CompleteCount, 10),
			strconv.FormatInt(row.ReactionCount, 10),
			strconv.FormatInt(row.ReactionPoints, 10),
		}
	}
	figureColumns := []string{
		"follower_count", "followed_count", "unfollowed_count",
		"view_count", "complete_count", "reaction_count", "reaction_points",
	}

	if kind == publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_AUDIENCE_BY_DAY {
		rows, err := s.audienceByDay(ctx, report)
		if err != nil {
			return statsExport{}, s.internalDBError(ctx, "failed to list the audience by day", err, "tenant_id", tenant.ID.String())
		}
		w := csvexport.New(append([]string{"date"}, figureColumns...)...)
		for _, row := range rows {
			w.Row(append([]string{row.Date}, figures(row)...)...)
		}
		export.csv = w.Bytes()
		return export, nil
	}

	rows, err := s.seriesAudiencePage(ctx, report, pagination.CountUUIDKeys{}, pagination.Forward, exportAllRows)
	if err != nil {
		return statsExport{}, s.internalDBError(ctx, "failed to list the audience by series", err, "tenant_id", tenant.ID.String())
	}
	columns := append([]string{"start_date", "end_date", "series_id", "series_title"}, figureColumns...)
	w := csvexport.New(append(columns, "rating_average", "rating_count")...)
	start, end := period.start.Format(time.DateOnly), period.end.Format(time.DateOnly)
	for _, ranked := range rows {
		row := ranked.row
		fields := append([]string{start, end, row.SeriesPublicId, row.SeriesTitle}, figures(row)...)
		w.Row(append(fields,
			strconv.FormatFloat(row.RatingAverage, 'f', 1, 64),
			strconv.FormatInt(row.RatingCount, 10),
		)...)
	}
	export.csv = w.Bytes()
	return export, nil
}

func (s *adminServer) dropOffExport(
	ctx context.Context,
	tenant dbmodels.Tenant,
	period statsPeriod,
	episodePublicID string,
) (statsExport, error) {
	res, err := s.episodeDropOff(ctx, tenant, episodePublicID, period)
	if err != nil {
		return statsExport{}, err
	}
	w := csvexport.New("start_date", "end_date", "episode_id", "page_index", "reader_count")
	for _, page := range res.Pages {
		w.Row(
			res.StartDate, res.EndDate, episodePublicID,
			strconv.Itoa(int(page.PageIndex)),
			strconv.FormatInt(page.ReaderCount, 10),
		)
	}
	return statsExport{csv: w.Bytes(), targetType: "episode", targetID: episodePublicID}, nil
}
