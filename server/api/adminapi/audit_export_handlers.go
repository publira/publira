package adminapi

import (
	"context"
	"database/sql"
	"time"

	"github.com/publira/publira/server/internal/auditexport"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/csvexport"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/tenanttz"
)

// ExportAuditLogs writes every entry of a period of the tenant's days as CSV,
// oldest first, and records the export in the same log.
func (s *adminServer) ExportAuditLogs(
	ctx context.Context,
	req *publiraadminv1.ExportAuditLogsRequest,
) (*publiraadminv1.ExportAuditLogsResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
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
	period, err := auditexport.ParsePeriod(req.StartDate, req.EndDate, zone)
	if err != nil {
		return nil, err
	}

	// One statement reads the whole period, so the file is a single snapshot
	// of the log rather than pages read at different moments.
	rows, err := s.queriesFor(ctx).ListAuditLogsByTenantAsc(ctx, dbmodels.ListAuditLogsByTenantAscParams{
		TenantID:                tenant.ID,
		FilterActorUserPublicID: nullableString(req.ActorUserPublicId),
		FilterAction:            nullableString(req.Action),
		FilterCreatedFrom:       sql.NullTime{Time: period.From, Valid: true},
		FilterCreatedTo:         sql.NullTime{Time: period.To, Valid: true},
		Limit:                   exportAllRows,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list audit logs for export", err, "tenant_id", tenant.ID.String())
	}
	w := csvexport.New(auditexport.Columns...)
	for _, row := range rows {
		w.Row(auditexport.Entry{
			Time:          row.CreatedAt,
			ActorPublicID: row.ActorPublicID,
			ActorName:     row.ActorName,
			ActorRole:     row.ActorRole,
			Action:        row.Action,
			Outcome:       row.Outcome,
			Reason:        row.Reason.String,
			TargetType:    row.TargetType.String,
			TargetID:      row.TargetID.String,
			ClientIP:      row.ClientIp.String,
		}.Fields(zone)...)
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID: tenant.ID, ActorUserID: sessionCtx.User.ID, ActorRole: sessionCtx.Role,
		Action: auditexport.Action, TargetType: auditexport.TargetType, TargetID: period.ID(),
		Outcome: auditlog.OutcomeSuccess, ClientIP: clientip.FromContext(ctx),
	})
	return &publiraadminv1.ExportAuditLogsResponse{Csv: w.Bytes()}, nil
}
