package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	defaultNotificationListLimit = int32(20)
	maxNotificationListLimit     = int32(100)
	notificationTypeAdmin        = "admin_notification"
)

func isValidNotificationLinkURL(raw string) bool {
	if raw == "" {
		return true
	}
	if strings.HasPrefix(raw, "/") {
		return true
	}
	return strings.HasPrefix(raw, "https://") || strings.HasPrefix(raw, "http://")
}

func mapAdminNotificationFromRow(row dbmodels.ListNotificationsForTenantRow) *publiraadminv1.AdminNotification {
	audienceType := publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_ALL_USERS
	if row.TargetUserID.Valid {
		audienceType = publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_SELECTED_USERS
	}

	return &publiraadminv1.AdminNotification{
		Id:                 row.ID.String(),
		Title:              row.Title,
		Body:               row.Body,
		LinkUrl:            row.LinkUrl.String,
		AudienceType:       audienceType,
		TargetUserPublicId: row.TargetUserPublicID.String,
		TargetUserName:     row.TargetUserName.String,
		CreatedAt:          row.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *adminServer) ListNotifications(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListNotificationsRequest],
) (*connect.Response[publiraadminv1.ListNotificationsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	limit := req.Msg.Limit
	if limit <= 0 || limit > maxNotificationListLimit {
		limit = defaultNotificationListLimit
	}
	offset := req.Msg.Offset
	if offset < 0 {
		offset = 0
	}

	rows, err := s.queriesFor(ctx).ListNotificationsForTenant(ctx, dbmodels.ListNotificationsForTenantParams{
		TenantID: tenant.ID,
		Limit:    limit,
		Offset:   offset,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items := make([]*publiraadminv1.AdminNotification, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapAdminNotificationFromRow(row))
	}

	return connect.NewResponse(&publiraadminv1.ListNotificationsResponse{
		Notifications: items,
	}), nil
}

func (s *adminServer) CreateNotification(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateNotificationRequest],
) (*connect.Response[publiraadminv1.CreateNotificationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	title := strings.TrimSpace(req.Msg.Title)
	if title == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	body := strings.TrimSpace(req.Msg.Body)
	if body == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("body is required"))
	}
	linkURL := strings.TrimSpace(req.Msg.LinkUrl)
	if !isValidNotificationLinkURL(linkURL) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("link_url must start with / or http(s)://"))
	}

	audienceType := req.Msg.AudienceType
	if audienceType == publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_UNSPECIFIED {
		audienceType = publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_ALL_USERS
	}

	selectedUsers := make([]dbmodels.GetUserByPublicIDForTenantRow, 0)
	if audienceType == publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_SELECTED_USERS {
		targetPublicIDs := make([]string, 0, len(req.Msg.TargetUserPublicIds))
		seen := make(map[string]struct{}, len(req.Msg.TargetUserPublicIds))
		for _, raw := range req.Msg.TargetUserPublicIds {
			normalized := strings.TrimSpace(raw)
			if normalized == "" {
				continue
			}
			if _, ok := seen[normalized]; ok {
				continue
			}
			seen[normalized] = struct{}{}
			targetPublicIDs = append(targetPublicIDs, normalized)
		}
		if len(targetPublicIDs) == 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("target_user_public_ids are required when audience_type is selected users"))
		}

		selectedUsers = make([]dbmodels.GetUserByPublicIDForTenantRow, 0, len(targetPublicIDs))
		for _, publicID := range targetPublicIDs {
			userRow, getUserErr := s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
				TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
				PublicID: publicID,
			})
			if getUserErr != nil {
				if errors.Is(getUserErr, sql.ErrNoRows) {
					return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("target user not found"))
				}
				return nil, connect.NewError(connect.CodeInternal, getUserErr)
			}
			selectedUsers = append(selectedUsers, userRow)
		}
	}
	if audienceType != publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_ALL_USERS &&
		audienceType != publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_SELECTED_USERS {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid audience_type"))
	}

	created := make([]*publiraadminv1.AdminNotification, 0)
	metadata := json.RawMessage("{}")
	if audienceType == publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_ALL_USERS {
		notificationID, idErr := uuid.NewV7()
		if idErr != nil {
			return nil, connect.NewError(connect.CodeInternal, idErr)
		}
		row, createErr := s.queriesFor(ctx).CreateNotification(ctx, dbmodels.CreateNotificationParams{
			ID:               notificationID,
			TenantID:         tenant.ID,
			TargetUserID:     uuid.NullUUID{},
			NotificationType: notificationTypeAdmin,
			Title:            title,
			Body:             body,
			LinkUrl:          sql.NullString{String: linkURL, Valid: linkURL != ""},
			Metadata:         metadata,
		})
		if createErr != nil {
			return nil, connect.NewError(connect.CodeInternal, createErr)
		}
		created = append(created, &publiraadminv1.AdminNotification{
			Id:           row.ID.String(),
			Title:        row.Title,
			Body:         row.Body,
			LinkUrl:      row.LinkUrl.String,
			AudienceType: publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_ALL_USERS,
			CreatedAt:    row.CreatedAt.UTC().Format(time.RFC3339),
		})
	} else {
		created = make([]*publiraadminv1.AdminNotification, 0, len(selectedUsers))
		for _, userRow := range selectedUsers {
			notificationID, idErr := uuid.NewV7()
			if idErr != nil {
				return nil, connect.NewError(connect.CodeInternal, idErr)
			}
			row, createErr := s.queriesFor(ctx).CreateNotification(ctx, dbmodels.CreateNotificationParams{
				ID:               notificationID,
				TenantID:         tenant.ID,
				TargetUserID:     uuid.NullUUID{UUID: userRow.ID, Valid: true},
				NotificationType: notificationTypeAdmin,
				Title:            title,
				Body:             body,
				LinkUrl:          sql.NullString{String: linkURL, Valid: linkURL != ""},
				Metadata:         metadata,
			})
			if createErr != nil {
				return nil, connect.NewError(connect.CodeInternal, createErr)
			}
			created = append(created, &publiraadminv1.AdminNotification{
				Id:                 row.ID.String(),
				Title:              row.Title,
				Body:               row.Body,
				LinkUrl:            row.LinkUrl.String,
				AudienceType:       publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_SELECTED_USERS,
				TargetUserPublicId: userRow.PublicID,
				TargetUserName:     userRow.Name,
				CreatedAt:          row.CreatedAt.UTC().Format(time.RFC3339),
			})
		}
	}

	s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "notification_created",
		TargetType:  "notification",
		TargetID:    "bulk",
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.CreateNotificationResponse{
		Notifications: created,
	}), nil
}
