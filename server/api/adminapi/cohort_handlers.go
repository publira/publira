package adminapi

import (
	"context"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/tenanttz"
)

// GetRetentionCohorts reports, for each calendar week with a day in a period,
// how many of the readers who signed up in it were active in each of the
// twelve weeks after it. The active days are the ones aggregate-content-stats
// filed, so a day reaches the report once it has been rebuilt.
func (s *adminServer) GetRetentionCohorts(
	ctx context.Context,
	req *publiraadminv1.GetRetentionCohortsRequest,
) (*publiraadminv1.GetRetentionCohortsResponse, error) {
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
	report, err := s.audienceReportFor(ctx, tenant, period, req.SeriesPublicId)
	if err != nil {
		return nil, err
	}

	rows, err := s.queriesFor(ctx).ListRetentionCohorts(ctx, dbmodels.ListRetentionCohortsParams{
		TenantID:  report.tenantID,
		SeriesID:  report.seriesID,
		TimeZone:  report.timeZone,
		StartDate: period.start,
		EndDate:   period.end,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list retention cohorts", err, "tenant_id", tenant.ID.String())
	}

	// The rows come in week order and, within a week, in week_index order, so
	// each week's counts are appended as they arrive.
	cohorts := []*publiraadminv1.RetentionCohort{}
	for _, row := range rows {
		weekStart := row.WeekStart.Format(time.DateOnly)
		if len(cohorts) == 0 || cohorts[len(cohorts)-1].WeekStart != weekStart {
			cohorts = append(cohorts, &publiraadminv1.RetentionCohort{
				WeekStart:    weekStart,
				CohortSize:   row.CohortSize,
				ActiveCounts: []int64{},
			})
		}
		if row.WeekIndex >= 0 {
			cohort := cohorts[len(cohorts)-1]
			cohort.ActiveCounts = append(cohort.ActiveCounts, row.ActiveCount)
		}
	}
	return &publiraadminv1.GetRetentionCohortsResponse{
		Cohorts:   cohorts,
		StartDate: period.start.Format(time.DateOnly),
		EndDate:   period.end.Format(time.DateOnly),
		TimeZone:  report.timeZone,
	}, nil
}

// GetSignUpFunnel reports how many of the readers who signed up in a period
// were ever active, and how many of them bought, and how soon. Sign-ups and
// purchases are read from their own tables, so an account created or a
// purchase made a moment ago is in it; activity waits for the daily rebuild.
func (s *adminServer) GetSignUpFunnel(
	ctx context.Context,
	req *publiraadminv1.GetSignUpFunnelRequest,
) (*publiraadminv1.GetSignUpFunnelResponse, error) {
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

	queries := s.queriesFor(ctx)
	timeZone := tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries))
	funnel, err := queries.GetSignUpFunnel(ctx, dbmodels.GetSignUpFunnelParams{
		TenantID:  tenant.ID,
		TimeZone:  timeZone,
		StartDate: period.start,
		EndDate:   period.end,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the sign-up funnel", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.GetSignUpFunnelResponse{
		SignedUpCount:                  funnel.SignedUpCount,
		ActiveCount:                    funnel.ActiveCount,
		PurchasedWithinSevenDaysCount:  funnel.PurchasedWithinSevenDaysCount,
		PurchasedWithinThirtyDaysCount: funnel.PurchasedWithinThirtyDaysCount,
		PurchasedCount:                 funnel.PurchasedCount,
		MedianDaysToFirstPurchase:      funnel.MedianDaysToFirstPurchase,
		StartDate:                      period.start.Format(time.DateOnly),
		EndDate:                        period.end.Format(time.DateOnly),
		TimeZone:                       timeZone,
	}, nil
}
