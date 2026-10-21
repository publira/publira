package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/pinnedannouncements"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
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

// announcementDeliveryFromProto reads the delivery CreateAnnouncement was asked
// for. Unspecified is the preferred delivery, so a console that predates the
// field posts what it always posted.
func announcementDeliveryFromProto(delivery publiraadminv1.AnnouncementDelivery) (string, error) {
	switch delivery {
	case publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_UNSPECIFIED,
		publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_PREFERRED:
		return outbox.AnnouncementDeliveryPreferred, nil
	case publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_EVERYONE:
		return outbox.AnnouncementDeliveryEveryone, nil
	default:
		return "", errors.New("delivery is not a known announcement delivery")
	}
}

func announcementDeliveryToProto(delivery string) publiraadminv1.AnnouncementDelivery {
	if delivery == outbox.AnnouncementDeliveryEveryone {
		return publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_EVERYONE
	}
	return publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_PREFERRED
}

// announcementCreatedReason is the audit reason of a post, which says who its
// notification was for.
func announcementCreatedReason(delivery string) string {
	return "delivery=" + delivery
}

// mapAdminAnnouncement answers one announcement as the console lists it: the
// title and body of its translation in the tenant default locale, beside every
// translation it has.
func mapAdminAnnouncement(row dbmodels.ListAnnouncementsForTenantDescRow, translations []dbmodels.AnnouncementTranslation) *publiraadminv1.AdminAnnouncement {
	items := make([]*publiraadminv1.AnnouncementTranslation, 0, len(translations))
	for _, translation := range translations {
		items = append(items, &publiraadminv1.AnnouncementTranslation{
			Locale: translation.Locale,
			Title:  translation.Title,
			Body:   translation.Body,
		})
	}
	return &publiraadminv1.AdminAnnouncement{
		Id:           row.ID.String(),
		Title:        row.Title,
		Body:         row.Body,
		LinkUrl:      row.LinkUrl.String,
		CreatedAt:    row.CreatedAt.UTC().Format(time.RFC3339),
		Pinned:       row.Pinned,
		PinnedUntil:  formatPinnedUntil(row.PinnedUntil),
		Translations: items,
		Delivery:     announcementDeliveryToProto(row.Delivery),
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
) ([]dbmodels.ListAnnouncementsForTenantDescRow, error) {
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
		mapped := make([]dbmodels.ListAnnouncementsForTenantDescRow, 0, len(rows))
		for _, row := range rows {
			mapped = append(mapped, dbmodels.ListAnnouncementsForTenantDescRow(row))
		}
		return mapped, nil
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

// announcementTranslationsOf reads every translation of the announcements
// rows names in one query, keyed by announcement.
func (s *adminServer) announcementTranslationsOf(
	ctx context.Context,
	tenantID uuid.UUID,
	rows []dbmodels.ListAnnouncementsForTenantDescRow,
) (map[uuid.UUID][]dbmodels.AnnouncementTranslation, error) {
	if len(rows) == 0 {
		return nil, nil
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	translations, err := s.queriesFor(ctx).ListAnnouncementTranslations(ctx, dbmodels.ListAnnouncementTranslationsParams{
		TenantID:        tenantID,
		AnnouncementIds: ids,
	})
	if err != nil {
		return nil, err
	}
	byAnnouncement := make(map[uuid.UUID][]dbmodels.AnnouncementTranslation, len(rows))
	for _, translation := range translations {
		byAnnouncement[translation.AnnouncementID] = append(byAnnouncement[translation.AnnouncementID], translation)
	}
	return byAnnouncement, nil
}

func (s *adminServer) ListAnnouncements(
	ctx context.Context,
	req *publiraadminv1.ListAnnouncementsRequest,
) (*publiraadminv1.ListAnnouncementsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Limit, defaultAnnouncementListLimit, maxAnnouncementListLimit)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
		}
	}

	rows, err := s.announcementPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list announcements", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)
	translations, err := s.announcementTranslationsOf(ctx, tenant.ID, rows)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list announcement translations", err, "tenant_id", tenant.ID.String())
	}

	items := make([]*publiraadminv1.AdminAnnouncement, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapAdminAnnouncement(row, translations[row.ID]))
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

	return res, nil
}

func (s *adminServer) CreateAnnouncement(
	ctx context.Context,
	req *publiraadminv1.CreateAnnouncementRequest,
) (*publiraadminv1.CreateAnnouncementResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantEditor(ctx)
	if err != nil {
		return nil, err
	}

	translations, err := announcementTranslationsFrom(req.Translations, tenant)
	if err != nil {
		return nil, err
	}
	linkURL := strings.TrimSpace(req.LinkUrl)
	if !isValidAnnouncementLinkURL(linkURL) {
		return nil, connect.NewError(connect.CodeInvalidArgument, "link_url must start with / or http(s)://")
	}

	delivery, err := announcementDeliveryFromProto(req.Delivery)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "delivery")
	}

	pinned := req.Pinned
	pinnedUntil := sql.NullTime{}
	if pinned {
		pinnedUntil, err = parsePinnedUntil(req.PinnedUntil, time.Now())
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
		}
	}

	created, owed, err := s.storeAnnouncement(ctx, tenant, announcementContent{
		translations: translations,
		linkURL:      linkURL,
		pinned:       pinned,
		pinnedUntil:  pinnedUntil,
		delivery:     delivery,
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
		Reason:      announcementCreatedReason(delivery),
		ClientIP:    clientip.FromContext(ctx),
	})

	return &publiraadminv1.CreateAnnouncementResponse{
		Announcement: created,
	}, nil
}

// announcementTranslationInput is one locale's copy CreateAnnouncement was
// asked to write, with its locale resolved.
type announcementTranslationInput struct {
	locale string
	title  string
	body   string
}

// announcementTranslationsFrom checks the copy CreateAnnouncement was sent: a
// title and a body in each locale, each locale once and offered by the tenant,
// and the tenant default locale among them, since that is the copy a reader in
// any other locale is shown.
func announcementTranslationsFrom(
	raw []*publiraadminv1.AnnouncementTranslation,
	tenant dbmodels.Tenant,
) ([]announcementTranslationInput, error) {
	translations := make([]announcementTranslationInput, 0, len(raw))
	seen := make(map[string]bool, len(raw))
	for _, translation := range raw {
		code, err := offeredLocale(translation.GetLocale(), tenant)
		if err != nil {
			return nil, err
		}
		if seen[code] {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("translations must name each locale once"), "translations")
		}
		seen[code] = true
		title := strings.TrimSpace(translation.GetTitle())
		if title == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, "title is required")
		}
		body := strings.TrimSpace(translation.GetBody())
		if body == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, "body is required")
		}
		translations = append(translations, announcementTranslationInput{locale: code, title: title, body: body})
	}
	if !seen[tenant.DefaultLocale] {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("translations must include the tenant's default locale"), "translations")
	}
	return translations, nil
}

// announcementContent is what one CreateAnnouncement call writes.
type announcementContent struct {
	translations []announcementTranslationInput
	linkURL      string
	pinned       bool
	pinnedUntil  sql.NullTime
	delivery     string
}

// storeAnnouncement writes the announcement row and its translations and, in
// the same transaction, the event that puts it in its readers' notification
// inboxes, so a delivery nobody is ever told about cannot outlive the request
// that made it. A pinned one also owes the banner's cache drop, which the
// caller sends.
func (s *adminServer) storeAnnouncement(
	ctx context.Context,
	tenant dbmodels.Tenant,
	content announcementContent,
) (*publiraadminv1.AdminAnnouncement, revalidate.Owed, error) {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, revalidate.Owed{}, err
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	row, translations, err := createAnnouncementRow(ctx, txq, tenant.ID, content)
	if err != nil {
		return nil, revalidate.Owed{}, err
	}
	var owed revalidate.Owed
	if content.pinned {
		if owed, err = s.reval.Record(ctx, txq, tenant.ID, pinnedannouncements.RevalidateTags(tenant.ID)); err != nil {
			return nil, revalidate.Owed{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, revalidate.Owed{}, err
	}

	listed := dbmodels.ListAnnouncementsForTenantDescRow{
		ID:               row.ID,
		TenantID:         row.TenantID,
		AnnouncementType: row.AnnouncementType,
		LinkUrl:          row.LinkUrl,
		Metadata:         row.Metadata,
		CreatedAt:        row.CreatedAt,
		Pinned:           row.Pinned,
		PinnedUntil:      row.PinnedUntil,
		Delivery:         row.Delivery,
	}
	for _, translation := range translations {
		if translation.Locale == tenant.DefaultLocale {
			listed.Title = translation.Title
			listed.Body = translation.Body
		}
	}
	return mapAdminAnnouncement(listed, translations), owed, nil
}

// createAnnouncementRow writes one announcement with its translations and
// queues the notification event for the readers it addresses.
func createAnnouncementRow(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	content announcementContent,
) (dbmodels.Announcement, []dbmodels.AnnouncementTranslation, error) {
	announcementID, err := uuid.NewV7()
	if err != nil {
		return dbmodels.Announcement{}, nil, fmt.Errorf("allocate announcement id: %w", err)
	}
	row, err := queries.CreateAnnouncement(ctx, dbmodels.CreateAnnouncementParams{
		ID:               announcementID,
		TenantID:         tenantID,
		AnnouncementType: announcementTypeAdmin,
		LinkUrl:          sql.NullString{String: content.linkURL, Valid: content.linkURL != ""},
		Metadata:         json.RawMessage("{}"),
		Pinned:           content.pinned,
		PinnedUntil:      content.pinnedUntil,
		Delivery:         content.delivery,
	})
	if err != nil {
		return dbmodels.Announcement{}, nil, err
	}
	translations := make([]dbmodels.AnnouncementTranslation, 0, len(content.translations))
	for _, input := range content.translations {
		translationID, err := uuid.NewV7()
		if err != nil {
			return dbmodels.Announcement{}, nil, fmt.Errorf("allocate announcement translation id: %w", err)
		}
		translation, err := queries.CreateAnnouncementTranslation(ctx, dbmodels.CreateAnnouncementTranslationParams{
			ID:             translationID,
			AnnouncementID: row.ID,
			TenantID:       tenantID,
			Locale:         input.locale,
			Title:          input.title,
			Body:           input.body,
		})
		if err != nil {
			return dbmodels.Announcement{}, nil, err
		}
		translations = append(translations, translation)
	}
	if err := enqueueAnnouncementNotification(ctx, queries, tenantID, row); err != nil {
		return dbmodels.Announcement{}, nil, err
	}
	return row, translations, nil
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
	req *publiraadminv1.UnpinAnnouncementRequest,
) (*publiraadminv1.UnpinAnnouncementResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantEditor(ctx)
	if err != nil {
		return nil, err
	}

	announcementID, parseErr := uuid.Parse(strings.TrimSpace(req.AnnouncementId))
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "announcement_id is invalid")
	}

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		if _, err := s.queriesFor(txCtx).UnpinAnnouncement(txCtx, dbmodels.UnpinAnnouncementParams{
			ID:       announcementID,
			TenantID: tenant.ID,
		}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, "announcement not found")
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
		ClientIP:    clientip.FromContext(ctx),
	})

	return &publiraadminv1.UnpinAnnouncementResponse{}, nil
}
