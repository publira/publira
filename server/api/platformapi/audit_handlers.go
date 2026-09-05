package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
)

type platformAuditLogPageRow struct {
	id             uuid.UUID
	actorPublicID  string
	actorName      string
	actorRole      string
	tenantPublicID string
	tenantName     string
	action         string
	targetType     sql.NullString
	targetID       sql.NullString
	targetPublicID string
	targetName     string
	outcome        string
	reason         sql.NullString
	clientIP       sql.NullString
	createdAt      time.Time
}

func platformAuditLogPageFromDesc(row dbmodels.ListPlatformAuditLogsDescRow) platformAuditLogPageRow {
	return platformAuditLogPageRow{
		id:             row.ID,
		actorPublicID:  row.ActorPublicID,
		actorName:      row.ActorName,
		actorRole:      row.ActorRole,
		tenantPublicID: row.TenantPublicID,
		tenantName:     row.TenantName,
		action:         row.Action,
		targetType:     row.TargetType,
		targetID:       row.TargetID,
		targetPublicID: row.TargetPublicID,
		targetName:     row.TargetName,
		outcome:        row.Outcome,
		reason:         row.Reason,
		clientIP:       row.ClientIp,
		createdAt:      row.CreatedAt,
	}
}

func platformAuditLogPageFromAsc(row dbmodels.ListPlatformAuditLogsAscRow) platformAuditLogPageRow {
	return platformAuditLogPageRow{
		id:             row.ID,
		actorPublicID:  row.ActorPublicID,
		actorName:      row.ActorName,
		actorRole:      row.ActorRole,
		tenantPublicID: row.TenantPublicID,
		tenantName:     row.TenantName,
		action:         row.Action,
		targetType:     row.TargetType,
		targetID:       row.TargetID,
		targetPublicID: row.TargetPublicID,
		targetName:     row.TargetName,
		outcome:        row.Outcome,
		reason:         row.Reason,
		clientIP:       row.ClientIp,
		createdAt:      row.CreatedAt,
	}
}

func platformAuditLogToProto(row platformAuditLogPageRow) *publirasplatformv1.PlatformAuditLog {
	item := &publirasplatformv1.PlatformAuditLog{
		ActorUserPublicId: row.actorPublicID,
		ActorRole:         row.actorRole,
		Action:            row.action,
		Outcome:           row.outcome,
		CreatedAt:         row.createdAt.UTC().Format(time.RFC3339),
		ActorName:         row.actorName,
		TenantName:        row.tenantName,
		TargetName:        row.targetName,
	}
	if row.tenantPublicID != "" {
		item.TenantPublicId = row.tenantPublicID
	}
	if row.targetType.Valid {
		item.TargetType = row.targetType.String
	}
	if row.targetID.Valid {
		item.TargetId = row.targetID.String
	}
	if row.targetPublicID != "" {
		item.TargetPublicId = row.targetPublicID
	}
	if row.reason.Valid {
		item.Reason = row.reason.String
	}
	if row.clientIP.Valid {
		item.ClientIp = row.clientIP.String
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

type platformAuditLogQueryFilters struct {
	tenantPublicID    sql.NullString
	actorUserPublicID sql.NullString
	action            sql.NullString
}

func (s *platformServer) platformAuditLogPage(
	ctx context.Context,
	filters platformAuditLogQueryFilters,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]platformAuditLogPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListPlatformAuditLogsAsc(ctx, dbmodels.ListPlatformAuditLogsAscParams{
			FilterTenantPublicID:    filters.tenantPublicID,
			FilterActorUserPublicID: filters.actorUserPublicID,
			FilterAction:            filters.action,
			CursorID:                uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive:         keys.Inclusive,
			CursorCreatedAt:         sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:                   limit,
		})
		if err != nil {
			return nil, err
		}

		return toPage(rows, platformAuditLogPageFromAsc), nil
	}

	rows, err := queries.ListPlatformAuditLogsDesc(ctx, dbmodels.ListPlatformAuditLogsDescParams{
		FilterTenantPublicID:    filters.tenantPublicID,
		FilterActorUserPublicID: filters.actorUserPublicID,
		FilterAction:            filters.action,
		CursorID:                uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive:         keys.Inclusive,
		CursorCreatedAt:         sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:                   limit,
	})
	if err != nil {
		return nil, err
	}

	return toPage(rows, platformAuditLogPageFromDesc), nil
}

func (s *platformServer) ListAuditLogs(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListAuditLogsRequest],
) (*connect.Response[publirasplatformv1.ListAuditLogsResponse], error) {
	_, actorUser, _, err := s.authenticatePlatformSession(ctx, "", req.Header())
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultListLimit, maxListLimit)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	filters := platformAuditLogQueryFilters{
		tenantPublicID:    nullStringFilter(req.Msg.TenantPublicId),
		actorUserPublicID: nullStringFilter(req.Msg.ActorUserPublicId),
		action:            nullStringFilter(req.Msg.Action),
	}

	rows, err := s.platformAuditLogPage(ctx, filters, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list platform audit logs", err, "platform_user_id", actorUser.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	resp := &publirasplatformv1.ListAuditLogsResponse{
		AuditLogs: make([]*publirasplatformv1.PlatformAuditLog, len(rows)),
	}
	for index, row := range rows {
		resp.AuditLogs[index] = platformAuditLogToProto(row)
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			resp.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].createdAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			resp.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		resp.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		resp.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(resp), nil
}
