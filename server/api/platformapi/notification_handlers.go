package platformapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	defaultNotificationListLimit = int32(20)
	maxNotificationListLimit     = int32(100)
)

type platformNotificationPageRow struct {
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

func (s *platformServer) requirePlatformActor(ctx context.Context) (platformActor, error) {
	actor, ok := platformActorFromContext(ctx)
	if !ok {
		return platformActor{}, invalidSessionError()
	}
	return actor, nil
}

func mapPlatformNotificationDescRows(rows []dbmodels.ListPlatformNotificationsForUserDescRow) []platformNotificationPageRow {
	mapped := make([]platformNotificationPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, platformNotificationPageRow{
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

func mapPlatformNotificationAscRows(rows []dbmodels.ListPlatformNotificationsForUserAscRow) []platformNotificationPageRow {
	mapped := make([]platformNotificationPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, platformNotificationPageRow{
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

func (s *platformServer) notificationPage(
	ctx context.Context,
	platformUserID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]platformNotificationPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListPlatformNotificationsForUserAsc(ctx, dbmodels.ListPlatformNotificationsForUserAscParams{
			PlatformUserID:  platformUserID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapPlatformNotificationAscRows(rows), nil
	}

	rows, err := queries.ListPlatformNotificationsForUserDesc(ctx, dbmodels.ListPlatformNotificationsForUserDescParams{
		PlatformUserID:  platformUserID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapPlatformNotificationDescRows(rows), nil
}

func mapPlatformNotificationFromRow(row platformNotificationPageRow) *publirasplatformv1.PlatformNotification {
	readAt := ""
	if row.readAt.Valid {
		readAt = row.readAt.Time.UTC().Format(time.RFC3339)
	}
	return &publirasplatformv1.PlatformNotification{
		Id:               row.id.String(),
		NotificationType: row.notificationType,
		Payload:          notificationPayloadJSON(row.payload),
		IsRead:           row.isRead,
		ReadAt:           readAt,
		CreatedAt:        row.createdAt.UTC().Format(time.RFC3339),
	}
}

func (s *platformServer) ListNotifications(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListNotificationsRequest],
) (*connect.Response[publirasplatformv1.ListNotificationsResponse], error) {
	actor, err := s.requirePlatformActor(ctx)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultNotificationListLimit, maxNotificationListLimit)
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

	rows, err := s.notificationPage(ctx, actor.UserID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirasplatformv1.PlatformNotification, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapPlatformNotificationFromRow(row))
	}

	res := &publirasplatformv1.ListNotificationsResponse{Notifications: items}
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

func (s *platformServer) CountUnreadNotifications(
	ctx context.Context,
	_ *connect.Request[publirasplatformv1.CountUnreadNotificationsRequest],
) (*connect.Response[publirasplatformv1.CountUnreadNotificationsResponse], error) {
	actor, err := s.requirePlatformActor(ctx)
	if err != nil {
		return nil, err
	}

	unread, err := s.queriesFor(ctx).CountUnreadPlatformNotificationsForUser(ctx, actor.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirasplatformv1.CountUnreadNotificationsResponse{UnreadCount: unread}), nil
}

func (s *platformServer) MarkNotificationAsRead(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.MarkNotificationAsReadRequest],
) (*connect.Response[publirasplatformv1.MarkNotificationAsReadResponse], error) {
	actor, err := s.requirePlatformActor(ctx)
	if err != nil {
		return nil, err
	}

	notificationID, parseErr := uuid.Parse(strings.TrimSpace(req.Msg.NotificationId))
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("notification_id is invalid"))
	}

	_, err = s.queriesFor(ctx).MarkPlatformNotificationAsRead(ctx, dbmodels.MarkPlatformNotificationAsReadParams{
		ID:             notificationID,
		PlatformUserID: actor.UserID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("notification not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirasplatformv1.MarkNotificationAsReadResponse{Marked: true}), nil
}

func (s *platformServer) MarkAllNotificationsAsRead(
	ctx context.Context,
	_ *connect.Request[publirasplatformv1.MarkAllNotificationsAsReadRequest],
) (*connect.Response[publirasplatformv1.MarkAllNotificationsAsReadResponse], error) {
	actor, err := s.requirePlatformActor(ctx)
	if err != nil {
		return nil, err
	}

	marked, err := s.queriesFor(ctx).MarkAllPlatformNotificationsAsRead(ctx, actor.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirasplatformv1.MarkAllNotificationsAsReadResponse{MarkedCount: int32(marked)}), nil
}
