package platformapi

import (
	"context"
	"database/sql"
	"math"
	"slices"
	"time"

	"github.com/publira/publira/server/internal/auditexport"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/csvexport"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformconfig"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// ExportAuditLogs writes every entry of a period of the install's days as
// CSV, oldest first, and records the export in the same log. Every operator
// role may, as every one may read the list.
func (s *platformServer) ExportAuditLogs(
	ctx context.Context,
	req *publirasplatformv1.ExportAuditLogsRequest,
) (*publirasplatformv1.ExportAuditLogsResponse, error) {
	actor, err := s.requirePlatformActor(ctx, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if err := actor.requirePerson(); err != nil {
		return nil, err
	}
	tenantID, err := auditTenantFilter(req.TenantId)
	if err != nil {
		return nil, err
	}
	timeZone := platformconfig.DefaultTimeZone(ctx, s.queriesFor(ctx))
	zone, err := time.LoadLocation(timeZone)
	if err != nil {
		return nil, s.internalError(ctx, "failed to load the platform time zone", err, "time_zone", timeZone)
	}
	period, err := auditexport.ParsePeriod(req.StartDate, req.EndDate, zone)
	if err != nil {
		return nil, err
	}

	// One statement reads the whole period, so the file is a single snapshot
	// of the log rather than pages read at different moments.
	rows, err := s.queriesFor(ctx).ListPlatformAuditLogsAsc(ctx, dbmodels.ListPlatformAuditLogsAscParams{
		FilterTenantID:          tenantID,
		FilterActorUserPublicID: nullStringFilter(req.ActorUserPublicId),
		FilterAction:            nullStringFilter(req.Action),
		FilterCreatedFrom:       sql.NullTime{Time: period.From, Valid: true},
		FilterCreatedTo:         sql.NullTime{Time: period.To, Valid: true},
		Limit:                   math.MaxInt32,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list platform audit logs for export", err, "platform_user_id", actor.UserID.String())
	}
	w := csvexport.New(slices.Concat(auditexport.Columns, []string{"tenant_public_id", "tenant_name", "target_public_id", "target_name"})...)
	for _, row := range rows {
		fields := auditexport.Entry{
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
		}.Fields(zone)
		w.Row(append(fields, row.TenantPublicID, row.TenantName, row.TargetPublicID, row.TargetName)...)
	}

	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
		TenantID:            tenantID.UUID,
		Action:              auditexport.Action,
		TargetType:          auditexport.TargetType,
		TargetID:            period.ID(),
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            clientip.FromContext(ctx),
	})
	return &publirasplatformv1.ExportAuditLogsResponse{Csv: w.Bytes()}, nil
}
