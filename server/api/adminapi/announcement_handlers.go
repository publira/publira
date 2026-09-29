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
	"github.com/publira/publira/server/internal/pinnedannouncements"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/revalidate"
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

// parsePinnedUntil reads the instant a banner is asked to stop at. An instant
// already behind us is refused rather than stored, because it would post an
// announcement whose banner never shows.
func parsePinnedUntil(raw string, now time.Time) (sql.NullTime, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return sql.NullTime{}, nil
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return sql.NullTime{}, errors.New("pinned_until must be an RFC 3339 instant")
	}
	if !parsed.After(now) {
		return sql.NullTime{}, errors.New("pinned_until must be in the future")
	}
	return sql.NullTime{Time: parsed, Valid: true}, nil
}

func mapAdminAnnouncementFromRow(row dbmodels.Announcement) *publiraadminv1.AdminAnnouncement {
	return &publiraadminv1.AdminAnnouncement{
		Id:          row.ID.String(),
		Title:       row.Title,
		Body:        row.Body,
		LinkUrl:     row.LinkUrl.String,
		CreatedAt:   row.CreatedAt.UTC().Format(time.RFC3339),
		Pinned:      row.Pinned,
		PinnedUntil: formatPinnedUntil(row.PinnedUntil),
	}
}

// formatPinnedUntil renders the instant a banner stops at. An empty answer is
// a banner with no end rather than one that has already ended.
func formatPinnedUntil(pinnedUntil sql.NullTime) string {
	if !pinnedUntil.Valid {
		return ""
	}
	return pinnedUntil.Time.UTC().Format(time.RFC3339)
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
) ([]dbmodels.Announcement, error) {
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
		return rows, nil
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
	return rows, nil
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
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
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

	pinned := req.Msg.Pinned
	pinnedUntil := sql.NullTime{}
	if pinned {
		pinnedUntil, err = parsePinnedUntil(req.Msg.PinnedUntil, time.Now())
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
	}

	created, owed, err := s.storeAnnouncement(ctx, tenant.ID, announcementContent{
		title:       title,
		body:        body,
		linkURL:     linkURL,
		pinned:      pinned,
		pinnedUntil: pinnedUntil,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create announcement", err, "tenant_id", tenant.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "announcement_created",
		TargetType:  "announcement",
		TargetID:    created.Id,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.CreateAnnouncementResponse{
		Announcement: created,
	}), nil
}

// announcementContent is what one CreateAnnouncement call writes.
type announcementContent struct {
	title       string
	body        string
	linkURL     string
	pinned      bool
	pinnedUntil sql.NullTime
}

// storeAnnouncement writes the announcement row and, in the same transaction,
// the event that puts it in its readers' notification inboxes, so a delivery
// nobody is ever told about cannot outlive the request that made it. A pinned
// one also owes the banner's cache drop, which the caller sends.
func (s *adminServer) storeAnnouncement(
	ctx context.Context,
	tenantID uuid.UUID,
	content announcementContent,
) (*publiraadminv1.AdminAnnouncement, revalidate.Owed, error) {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, revalidate.Owed{}, err
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	row, err := createAnnouncementRow(ctx, txq, tenantID, content)
	if err != nil {
		return nil, revalidate.Owed{}, err
	}
	var owed revalidate.Owed
	if content.pinned {
		if owed, err = s.reval.Record(ctx, txq, tenantID, pinnedannouncements.RevalidateTags(tenantID)); err != nil {
			return nil, revalidate.Owed{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, revalidate.Owed{}, err
	}
	return mapAdminAnnouncementFromRow(row), owed, nil
}

// createAnnouncementRow writes one announcement and queues the notification
// event for the readers it addresses.
func createAnnouncementRow(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	content announcementContent,
) (dbmodels.Announcement, error) {
	announcementID, err := uuid.NewV7()
	if err != nil {
		return dbmodels.Announcement{}, fmt.Errorf("allocate announcement id: %w", err)
	}
	row, err := queries.CreateAnnouncement(ctx, dbmodels.CreateAnnouncementParams{
		ID:               announcementID,
		TenantID:         tenantID,
		AnnouncementType: announcementTypeAdmin,
		Title:            content.title,
		Body:             content.body,
		LinkUrl:          sql.NullString{String: content.linkURL, Valid: content.linkURL != ""},
		Metadata:         json.RawMessage("{}"),
		Pinned:           content.pinned,
		PinnedUntil:      content.pinnedUntil,
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
// The worker owns the fan-out: an announcement addresses every user the tenant
// has, and an operator submitting the console form must not wait on an insert
// per person. The idempotency key is the announcement's own identity, so a
// redelivered event notifies nobody a second time.
func enqueueAnnouncementNotification(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	row dbmodels.Announcement,
) error {
	payload, err := json.Marshal(outbox.AnnouncementNotificationPayload{
		TenantID:       tenantID.String(),
		AnnouncementID: row.ID.String(),
		Title:          row.Title,
	})
	if err != nil {
		return fmt.Errorf("marshal announcement notification event: %w", err)
	}
	return insertAdminOutboxEvent(ctx, queries, tenantID, outbox.EventTypeAnnouncementNotification, payload,
		outbox.AnnouncementIdempotencyKey(row.ID))
}

// UnpinAnnouncement takes a banner down and leaves the announcement where it
// is. Deleting the row would be the other way to stop a banner, and it would
// take the announcement out of the list its readers were pointed at.
func (s *adminServer) UnpinAnnouncement(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UnpinAnnouncementRequest],
) (*connect.Response[publiraadminv1.UnpinAnnouncementResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	announcementID, parseErr := uuid.Parse(strings.TrimSpace(req.Msg.AnnouncementId))
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("announcement_id is invalid"))
	}

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		if _, err := s.queriesFor(txCtx).UnpinAnnouncement(txCtx, dbmodels.UnpinAnnouncementParams{
			ID:       announcementID,
			TenantID: tenant.ID,
		}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, errors.New("announcement not found"))
			}
			return nil, s.internalDBError(ctx, "failed to unpin announcement", err, "tenant_id", tenant.ID.String(), "announcement_id", announcementID.String())
		}
		return pinnedannouncements.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "announcement_unpinned",
		TargetType:  "announcement",
		TargetID:    announcementID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.UnpinAnnouncementResponse{}), nil
}
