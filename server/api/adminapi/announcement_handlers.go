package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

const (
	defaultAnnouncementListLimit = int32(20)
	maxAnnouncementListLimit     = int32(100)
	announcementTypeAdmin        = "announcement"
)

func isValidAnnouncementLinkURL(raw string) bool {
	if raw == "" {
		return true
	}
	if strings.HasPrefix(raw, "/") {
		return true
	}
	return strings.HasPrefix(raw, "https://") || strings.HasPrefix(raw, "http://")
}

type announcementPageRow struct {
	id                 uuid.UUID
	targetUserID       uuid.NullUUID
	title              string
	body               string
	linkURL            sql.NullString
	targetUserPublicID sql.NullString
	targetUserName     sql.NullString
	createdAt          time.Time
}

func mapAnnouncementDescRows(rows []dbmodels.ListAnnouncementsForTenantDescRow) []announcementPageRow {
	mapped := make([]announcementPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, announcementPageRow{
			id:                 row.ID,
			targetUserID:       row.TargetUserID,
			title:              row.Title,
			body:               row.Body,
			linkURL:            row.LinkUrl,
			targetUserPublicID: row.TargetUserPublicID,
			targetUserName:     row.TargetUserName,
			createdAt:          row.CreatedAt,
		})
	}
	return mapped
}

func mapAnnouncementAscRows(rows []dbmodels.ListAnnouncementsForTenantAscRow) []announcementPageRow {
	mapped := make([]announcementPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, announcementPageRow{
			id:                 row.ID,
			targetUserID:       row.TargetUserID,
			title:              row.Title,
			body:               row.Body,
			linkURL:            row.LinkUrl,
			targetUserPublicID: row.TargetUserPublicID,
			targetUserName:     row.TargetUserName,
			createdAt:          row.CreatedAt,
		})
	}
	return mapped
}

func mapAdminAnnouncementFromRow(row announcementPageRow) *publiraadminv1.AdminAnnouncement {
	audienceType := publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_ALL_USERS
	if row.targetUserID.Valid {
		audienceType = publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_SELECTED_USERS
	}

	return &publiraadminv1.AdminAnnouncement{
		Id:                 row.id.String(),
		Title:              row.title,
		Body:               row.body,
		LinkUrl:            row.linkURL.String,
		AudienceType:       audienceType,
		TargetUserPublicId: row.targetUserPublicID.String,
		TargetUserName:     row.targetUserName.String,
		CreatedAt:          row.createdAt.UTC().Format(time.RFC3339),
	}
}

// announcementPage loads one over-fetched page. Admin ListAnnouncements is
// sorted (created_at, id) DESC. Forward uses the DESC query; backward uses ASC
// so the index can be scanned in reverse. pagination.Page flips ASC rows back
// into display order.
func (s *adminServer) announcementPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]announcementPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListAnnouncementsForTenantAsc(ctx, dbmodels.ListAnnouncementsForTenantAscParams{
			TenantID:        tenantID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapAnnouncementAscRows(rows), nil
	}

	rows, err := queries.ListAnnouncementsForTenantDesc(ctx, dbmodels.ListAnnouncementsForTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapAnnouncementDescRows(rows), nil
}

func (s *adminServer) ListAnnouncements(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListAnnouncementsRequest],
) (*connect.Response[publiraadminv1.ListAnnouncementsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultAnnouncementListLimit, maxAnnouncementListLimit)
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

	rows, err := s.announcementPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list announcements", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publiraadminv1.AdminAnnouncement, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapAdminAnnouncementFromRow(row))
	}

	res := &publiraadminv1.ListAnnouncementsResponse{Announcements: items}
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

func (s *adminServer) CreateAnnouncement(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateAnnouncementRequest],
) (*connect.Response[publiraadminv1.CreateAnnouncementResponse], error) {
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
	if !isValidAnnouncementLinkURL(linkURL) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("link_url must start with / or http(s)://"))
	}

	audienceType := req.Msg.AudienceType
	if audienceType == publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_UNSPECIFIED {
		audienceType = publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_ALL_USERS
	}

	selectedUsers := make([]dbmodels.GetUserByPublicIDForTenantRow, 0)
	if audienceType == publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_SELECTED_USERS {
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
				return nil, s.internalDBError(ctx, "failed to get announcement target user", getUserErr, "tenant_id", tenant.ID.String(), "user_public_id", publicID)
			}
			selectedUsers = append(selectedUsers, userRow)
		}
	}
	if audienceType != publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_ALL_USERS &&
		audienceType != publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_SELECTED_USERS {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid audience_type"))
	}

	created, err := s.storeAnnouncements(ctx, tenant.ID, announcementContent{
		title:   title,
		body:    body,
		linkURL: linkURL,
	}, selectedUsers)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create announcement", err, "tenant_id", tenant.ID.String())
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "announcement_created",
		TargetType:  "announcement",
		TargetID:    "bulk",
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.CreateAnnouncementResponse{
		Announcements: created,
	}), nil
}

// announcementContent is what every row one CreateAnnouncement call writes
// shares. A targeted delivery is the same announcement addressed to each
// recipient separately, so only the recipient differs between its rows.
type announcementContent struct {
	title   string
	body    string
	linkURL string
}

// storeAnnouncements writes the announcement rows and, in the same
// transaction, the events that put each of them in its readers' notification
// inboxes.
//
// An empty `targets` is the broadcast, which is one row addressed to nobody in
// particular; a targeted delivery is one row per named reader. One transaction,
// so a delivery nobody is ever told about cannot outlive the request that made
// it, and a targeted post reaches either all of its recipients or none of them.
func (s *adminServer) storeAnnouncements(
	ctx context.Context,
	tenantID uuid.UUID,
	content announcementContent,
	targets []dbmodels.GetUserByPublicIDForTenantRow,
) ([]*publiraadminv1.AdminAnnouncement, error) {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	created := make([]*publiraadminv1.AdminAnnouncement, 0, max(len(targets), 1))
	if len(targets) == 0 {
		row, createErr := createAnnouncementRow(ctx, txq, tenantID, content, uuid.NullUUID{})
		if createErr != nil {
			return nil, createErr
		}
		created = append(created, &publiraadminv1.AdminAnnouncement{
			Id:           row.ID.String(),
			Title:        row.Title,
			Body:         row.Body,
			LinkUrl:      row.LinkUrl.String,
			AudienceType: publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_ALL_USERS,
			CreatedAt:    row.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	for _, userRow := range targets {
		row, createErr := createAnnouncementRow(ctx, txq, tenantID, content,
			uuid.NullUUID{UUID: userRow.ID, Valid: true})
		if createErr != nil {
			return nil, createErr
		}
		created = append(created, &publiraadminv1.AdminAnnouncement{
			Id:                 row.ID.String(),
			Title:              row.Title,
			Body:               row.Body,
			LinkUrl:            row.LinkUrl.String,
			AudienceType:       publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_SELECTED_USERS,
			TargetUserPublicId: userRow.PublicID,
			TargetUserName:     userRow.Name,
			CreatedAt:          row.CreatedAt.UTC().Format(time.RFC3339),
		})
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return created, nil
}

// createAnnouncementRow writes one announcement and queues the notification
// event for the readers it addresses.
func createAnnouncementRow(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	content announcementContent,
	targetUserID uuid.NullUUID,
) (dbmodels.Announcement, error) {
	announcementID, err := uuid.NewV7()
	if err != nil {
		return dbmodels.Announcement{}, fmt.Errorf("allocate announcement id: %w", err)
	}
	row, err := queries.CreateAnnouncement(ctx, dbmodels.CreateAnnouncementParams{
		ID:               announcementID,
		TenantID:         tenantID,
		TargetUserID:     targetUserID,
		AnnouncementType: announcementTypeAdmin,
		Title:            content.title,
		Body:             content.body,
		LinkUrl:          sql.NullString{String: content.linkURL, Valid: content.linkURL != ""},
		Metadata:         json.RawMessage("{}"),
	})
	if err != nil {
		return dbmodels.Announcement{}, err
	}
	if err := enqueueAnnouncementNotification(ctx, queries, tenantID, row); err != nil {
		return dbmodels.Announcement{}, err
	}
	return row, nil
}

// enqueueAnnouncementNotification queues the bell delivery of one announcement.
//
// The worker owns the fan-out: a broadcast addresses every user the tenant has,
// and an operator submitting the console form must not wait on an insert per
// person. The idempotency key is the announcement's own identity, so a
// redelivered event notifies nobody a second time.
func enqueueAnnouncementNotification(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	row dbmodels.Announcement,
) error {
	target := ""
	if row.TargetUserID.Valid {
		target = row.TargetUserID.UUID.String()
	}
	payload, err := json.Marshal(outbox.AnnouncementNotificationPayload{
		TenantID:       tenantID.String(),
		AnnouncementID: row.ID.String(),
		TargetUserID:   target,
		Title:          row.Title,
	})
	if err != nil {
		return fmt.Errorf("marshal announcement notification event: %w", err)
	}
	return insertAdminOutboxEvent(ctx, queries, tenantID, outbox.EventTypeAnnouncementNotification, payload,
		outbox.AnnouncementIdempotencyKey(row.ID))
}
