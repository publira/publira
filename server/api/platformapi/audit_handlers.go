package platformapi

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

func platformAuditLogToProto(row dbmodels.ListPlatformAuditLogsRow) *publirasplatformv1.PlatformAuditLog {
	item := &publirasplatformv1.PlatformAuditLog{
		ActorUserPublicId: row.ActorPublicID,
		ActorRole:         row.ActorRole,
		Action:            row.Action,
		Outcome:           row.Outcome,
		CreatedAt:         row.CreatedAt.UTC().Format(time.RFC3339),
		ActorName:         row.ActorName,
		TenantName:        row.TenantName,
		TargetName:        row.TargetName,
	}
	if row.TenantPublicID != "" {
		item.TenantPublicId = row.TenantPublicID
	}
	if row.TargetType.Valid {
		item.TargetType = row.TargetType.String
	}
	if row.TargetID.Valid {
		item.TargetId = row.TargetID.String
	}
	if row.TargetPublicID != "" {
		item.TargetPublicId = row.TargetPublicID
	}
	if row.Reason.Valid {
		item.Reason = row.Reason.String
	}
	if row.ClientIp.Valid {
		item.ClientIp = row.ClientIp.String
	}
	return item
}

func nullStringFilter(value string) sql.NullString {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: trimmed, Valid: true}
}

func (s *platformServer) ListAuditLogs(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListAuditLogsRequest],
) (*connect.Response[publirasplatformv1.ListAuditLogsResponse], error) {
	if _, _, _, err := s.authenticatePlatformSession(ctx, "", req.Header()); err != nil {
		return nil, err
	}

	limit := req.Msg.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	offset := req.Msg.Offset
	if offset < 0 {
		offset = 0
	}

	rows, err := s.queriesFor(ctx).ListPlatformAuditLogs(ctx, dbmodels.ListPlatformAuditLogsParams{
		FilterTenantPublicID:    nullStringFilter(req.Msg.TenantPublicId),
		FilterActorUserPublicID: nullStringFilter(req.Msg.ActorUserPublicId),
		FilterAction:            nullStringFilter(req.Msg.Action),
		Offset:                  offset,
		Limit:                   limit,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items := make([]*publirasplatformv1.PlatformAuditLog, len(rows))
	for index, row := range rows {
		items[index] = platformAuditLogToProto(row)
	}

	return connect.NewResponse(&publirasplatformv1.ListAuditLogsResponse{AuditLogs: items}), nil
}
