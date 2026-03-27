package adminapi

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	defaultAuditLogPageSize = int32(20)
	maxAuditLogPageSize     = int32(100)
)

func encodeAuditLogCursor(createdAt time.Time, id uuid.UUID) string {
	payload := createdAt.UTC().Format(time.RFC3339Nano) + "|" + id.String()
	return base64.RawURLEncoding.EncodeToString([]byte(payload))
}

func decodeAuditLogCursor(raw string) (time.Time, uuid.UUID, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return time.Time{}, uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("cursor is invalid"))
	}

	parts := strings.Split(string(decoded), "|")
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("cursor is invalid"))
	}

	createdAt, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("cursor is invalid"))
	}

	id, err := uuid.Parse(parts[1])
	if err != nil {
		return time.Time{}, uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("cursor is invalid"))
	}

	return createdAt.UTC(), id, nil
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

	limit := req.Msg.Limit
	if limit <= 0 || limit > maxAuditLogPageSize {
		limit = defaultAuditLogPageSize
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

	params := dbmodels.ListAuditLogsByTenantParams{
		TenantID: tenant.ID,
		FilterActorUserPublicID: sql.NullString{
			String: strings.TrimSpace(req.Msg.ActorUserPublicId),
			Valid:  strings.TrimSpace(req.Msg.ActorUserPublicId) != "",
		},
		FilterAction: sql.NullString{
			String: strings.TrimSpace(req.Msg.Action),
			Valid:  strings.TrimSpace(req.Msg.Action) != "",
		},
		FilterCreatedFrom: createdFrom,
		FilterCreatedTo:   createdTo,
		Limit:             limit + 1,
	}

	if cursor := strings.TrimSpace(req.Msg.Cursor); cursor != "" {
		cursorCreatedAt, cursorID, err := decodeAuditLogCursor(cursor)
		if err != nil {
			return nil, err
		}
		params.CursorCreatedAt = sql.NullTime{Time: cursorCreatedAt, Valid: true}
		params.CursorID = uuid.NullUUID{UUID: cursorID, Valid: true}
	}

	rows, err := s.queries.ListAuditLogsByTenant(ctx, params)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	nextCursor := ""
	if len(rows) > int(limit) {
		last := rows[limit-1]
		nextCursor = encodeAuditLogCursor(last.CreatedAt, last.ID)
		rows = rows[:limit]
	}

	auditLogs := make([]*publiraadminv1.AdminAuditLog, 0, len(rows))
	for _, row := range rows {
		item := &publiraadminv1.AdminAuditLog{
			ActorUserPublicId: row.ActorPublicID,
			ActorName:         row.ActorName,
			ActorRole:         row.ActorRole,
			Action:            row.Action,
			Outcome:           row.Outcome,
			CreatedAt:         row.CreatedAt.UTC().Format(time.RFC3339),
		}
		if row.TargetType.Valid {
			item.TargetType = row.TargetType.String
		}
		if row.TargetID.Valid {
			item.TargetId = row.TargetID.String
		}
		if row.Reason.Valid {
			item.Reason = row.Reason.String
		}
		if row.ClientIp.Valid {
			item.ClientIp = row.ClientIp.String
		}
		auditLogs = append(auditLogs, item)
	}

	return connect.NewResponse(&publiraadminv1.ListAuditLogsResponse{
		AuditLogs:  auditLogs,
		NextCursor: nextCursor,
	}), nil
}