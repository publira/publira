package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	defaultNotificationPageSize = int32(20)
	maxNotificationPageSize     = int32(100)
)

type notificationPageRow struct {
	id               uuid.UUID
	notificationType string
	payload          json.RawMessage
	isRead           bool
	readAt           sql.NullTime
	createdAt        time.Time
}

func notificationPayloadJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "{}"
	}
	return string(raw)
}

func mapNotificationDescRows(rows []dbmodels.ListNotificationsForUserDescRow) []notificationPageRow {
	mapped := make([]notificationPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, notificationPageRow{
			id:               row.ID,
			notificationType: row.NotificationType,
			payload:          row.Payload,
			isRead:           row.IsRead,
			readAt:           row.ReadAt,
			createdAt:        row.CreatedAt,
		})
	}
	return mapped
}

func mapNotificationAscRows(rows []dbmodels.ListNotificationsForUserAscRow) []notificationPageRow {
	mapped := make([]notificationPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, notificationPageRow{
			id:               row.ID,
			notificationType: row.NotificationType,
			payload:          row.Payload,
			isRead:           row.IsRead,
			readAt:           row.ReadAt,
			createdAt:        row.CreatedAt,
		})
	}
	return mapped
}

func (s *apiServer) notificationPage(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]notificationPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListNotificationsForUserAsc(ctx, dbmodels.ListNotificationsForUserAscParams{
			TenantID:        tenantID,
			UserID:          userID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapNotificationAscRows(rows), nil
	}

	rows, err := queries.ListNotificationsForUserDesc(ctx, dbmodels.ListNotificationsForUserDescParams{
		TenantID:        tenantID,
		UserID:          userID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapNotificationDescRows(rows), nil
}

func notificationItemFromRow(row notificationPageRow) *publirav1.NotificationItem {
	readAt := ""
	if row.readAt.Valid {
		readAt = row.readAt.Time.UTC().Format(time.RFC3339)
	}
	return &publirav1.NotificationItem{
		Id:               row.id.String(),
		NotificationType: row.notificationType,
		Payload:          notificationPayloadJSON(row.payload),
		IsRead:           row.isRead,
		ReadAt:           readAt,
		CreatedAt:        row.createdAt.UTC().Format(time.RFC3339),
	}
}

func (s *apiServer) ListNotifications(
	ctx context.Context,
	req *connect.Request[publirav1.ListNotificationsRequest],
) (*connect.Response[publirav1.ListNotificationsResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultNotificationPageSize, maxNotificationPageSize)
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

	rows, err := s.notificationPage(ctx, tenant.ID, user.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirav1.NotificationItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, notificationItemFromRow(row))
	}

	res := &publirav1.ListNotificationsResponse{Notifications: items}
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
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}

func (s *apiServer) CountUnreadNotifications(
	ctx context.Context,
	req *connect.Request[publirav1.CountUnreadNotificationsRequest],
) (*connect.Response[publirav1.CountUnreadNotificationsResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}

	unread, err := s.queriesFor(ctx).CountUnreadNotificationsForUser(ctx, dbmodels.CountUnreadNotificationsForUserParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirav1.CountUnreadNotificationsResponse{UnreadCount: unread}), nil
}

func (s *apiServer) MarkNotificationAsRead(
	ctx context.Context,
	req *connect.Request[publirav1.MarkNotificationAsReadRequest],
) (*connect.Response[publirav1.MarkNotificationAsReadResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}

	notificationID, parseErr := uuid.Parse(strings.TrimSpace(req.Msg.NotificationId))
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("notification_id is invalid"))
	}

	_, err = s.queriesFor(ctx).MarkNotificationAsRead(ctx, dbmodels.MarkNotificationAsReadParams{
		ID:       notificationID,
		TenantID: tenant.ID,
		UserID:   user.ID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("notification not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirav1.MarkNotificationAsReadResponse{Marked: true}), nil
}

func (s *apiServer) MarkAllNotificationsAsRead(
	ctx context.Context,
	req *connect.Request[publirav1.MarkAllNotificationsAsReadRequest],
) (*connect.Response[publirav1.MarkAllNotificationsAsReadResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}

	marked, err := s.queriesFor(ctx).MarkAllNotificationsAsRead(ctx, dbmodels.MarkAllNotificationsAsReadParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	markedCount, err := notificationMarkedCount(marked)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publirav1.MarkAllNotificationsAsReadResponse{MarkedCount: markedCount}), nil
}

func notificationMarkedCount(marked int64) (int32, error) {
	if marked < 0 || marked > math.MaxInt32 {
		return 0, connect.NewError(connect.CodeInternal, errors.New("internal server error"))
	}
	return int32(marked), nil
}
