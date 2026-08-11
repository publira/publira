package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	defaultAuditLogPageSize = int32(20)
	maxAuditLogPageSize     = int32(100)
)

type auditLogQueryFilters struct {
	tenantID          uuid.UUID
	actorUserPublicID sql.NullString
	action            sql.NullString
	createdFrom       sql.NullTime
	createdTo         sql.NullTime
}

type auditLogPageRow struct {
	id            uuid.UUID
	actorPublicID string
	actorName     string
	actorRole     string
	action        string
	targetType    sql.NullString
	targetID      sql.NullString
	outcome       string
	reason        sql.NullString
	clientIP      sql.NullString
	createdAt     time.Time
}

func mapAuditLogDescRows(rows []dbmodels.ListAuditLogsByTenantDescRow) []auditLogPageRow {
	mapped := make([]auditLogPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, auditLogPageRow{
			id:            row.ID,
			actorPublicID: row.ActorPublicID,
			actorName:     row.ActorName,
			actorRole:     row.ActorRole,
			action:        row.Action,
			targetType:    row.TargetType,
			targetID:      row.TargetID,
			outcome:       row.Outcome,
			reason:        row.Reason,
			clientIP:      row.ClientIp,
			createdAt:     row.CreatedAt,
		})
	}
	return mapped
}

func mapAuditLogAscRows(rows []dbmodels.ListAuditLogsByTenantAscRow) []auditLogPageRow {
	mapped := make([]auditLogPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, auditLogPageRow{
			id:            row.ID,
			actorPublicID: row.ActorPublicID,
			actorName:     row.ActorName,
			actorRole:     row.ActorRole,
			action:        row.Action,
			targetType:    row.TargetType,
			targetID:      row.TargetID,
			outcome:       row.Outcome,
			reason:        row.Reason,
			clientIP:      row.ClientIp,
			createdAt:     row.CreatedAt,
		})
	}
	return mapped
}

func (s *adminServer) auditLogPage(
	ctx context.Context,
	filters auditLogQueryFilters,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]auditLogPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListAuditLogsByTenantAsc(ctx, dbmodels.ListAuditLogsByTenantAscParams{
			TenantID:                filters.tenantID,
			FilterActorUserPublicID: filters.actorUserPublicID,
			FilterAction:            filters.action,
			FilterCreatedFrom:       filters.createdFrom,
			FilterCreatedTo:         filters.createdTo,
			CursorID:                uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorCreatedAt:         sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			CursorInclusive:         keys.Inclusive,
			Limit:                   limit,
		})
		if err != nil {
			return nil, err
		}
		return mapAuditLogAscRows(rows), nil
	}

	rows, err := queries.ListAuditLogsByTenantDesc(ctx, dbmodels.ListAuditLogsByTenantDescParams{
		TenantID:                filters.tenantID,
		FilterActorUserPublicID: filters.actorUserPublicID,
		FilterAction:            filters.action,
		FilterCreatedFrom:       filters.createdFrom,
		FilterCreatedTo:         filters.createdTo,
		CursorID:                uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorCreatedAt:         sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive:         keys.Inclusive,
		Limit:                   limit,
	})
	if err != nil {
		return nil, err
	}
	return mapAuditLogDescRows(rows), nil
}

func parseAuditLogTimeFilter(name, value string) (sql.NullTime, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullTime{}, nil
	}

	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New(name+" must be RFC3339"))
	}

	return sql.NullTime{Time: parsed.UTC(), Valid: true}, nil
}

func (s *adminServer) ListAuditLogs(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListAuditLogsRequest],
) (*connect.Response[publiraadminv1.ListAuditLogsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultAuditLogPageSize, maxAuditLogPageSize)
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

	createdFrom, err := parseAuditLogTimeFilter("created_from", req.Msg.CreatedFrom)
	if err != nil {
		return nil, err
	}

	createdTo, err := parseAuditLogTimeFilter("created_to", req.Msg.CreatedTo)
	if err != nil {
		return nil, err
	}

	if createdFrom.Valid && createdTo.Valid && !createdFrom.Time.Before(createdTo.Time) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("created_from must be before created_to"))
	}

	filters := auditLogQueryFilters{
		tenantID: tenant.ID,
		actorUserPublicID: sql.NullString{
			String: strings.TrimSpace(req.Msg.ActorUserPublicId),
			Valid:  strings.TrimSpace(req.Msg.ActorUserPublicId) != "",
		},
		action: sql.NullString{
			String: strings.TrimSpace(req.Msg.Action),
			Valid:  strings.TrimSpace(req.Msg.Action) != "",
		},
		createdFrom: createdFrom,
		createdTo:   createdTo,
	}

	rows, err := s.auditLogPage(ctx, filters, keys, cursor.Direction, limit+1)
	if err != nil {
		s.logger.Error("failed to list audit logs", "error", err, "tenant_id", tenant.ID.String())
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal server error"))
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	auditLogs := make([]*publiraadminv1.AdminAuditLog, 0, len(rows))
	for _, row := range rows {
		item := &publiraadminv1.AdminAuditLog{
			ActorUserPublicId: row.actorPublicID,
			ActorName:         row.actorName,
			ActorRole:         row.actorRole,
			Action:            row.action,
			Outcome:           row.outcome,
			CreatedAt:         row.createdAt.UTC().Format(time.RFC3339),
		}
		if row.targetType.Valid {
			item.TargetType = row.targetType.String
		}
		if row.targetID.Valid {
			item.TargetId = row.targetID.String
		}
		if row.reason.Valid {
			item.Reason = row.reason.String
		}
		if row.clientIP.Valid {
			item.ClientIp = row.clientIP.String
		}
		auditLogs = append(auditLogs, item)
	}

	res := &publiraadminv1.ListAuditLogsResponse{AuditLogs: auditLogs}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].createdAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}
