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

	"github.com/publira/publira/server/internal/announcementaudience"
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

// parseDeliverAt reads the instant an announcement is asked to go out at, and
// whether that is a scheduled time rather than now. Empty is now. An instant
// already behind us is refused rather than delivered at once, because the
// operator asked for a time that has passed and should say whether they still
// mean it.
func parseDeliverAt(raw string, now time.Time) (time.Time, bool, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return now, false, nil
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return time.Time{}, false, errors.New("deliver_at must be an RFC 3339 instant")
	}
	if !parsed.After(now) {
		return time.Time{}, false, errors.New("deliver_at must be in the future")
	}
	return parsed, true, nil
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
// notification was for. A targeted one says only that it had an audience: the
// conditions are on the announcement, which the log names.
func announcementCreatedReason(delivery string, targeted bool) string {
	if targeted {
		return "delivery=" + delivery + ";audience=targeted"
	}
	return "delivery=" + delivery
}

// mapAdminAnnouncement answers one announcement as the console lists it: the
// title and body of its translation in the tenant default locale, beside every
// translation it has, the audience it was addressed to, nil for everyone, and
// how many readers it was delivered to and how many opened it.
func mapAdminAnnouncement(
	row dbmodels.ListAnnouncementsForTenantDescRow,
	translations []dbmodels.AnnouncementTranslation,
	audience *publiraadminv1.AnnouncementAudience,
) *publiraadminv1.AdminAnnouncement {
	items := make([]*publiraadminv1.AnnouncementTranslation, 0, len(translations))
	for _, translation := range translations {
		items = append(items, &publiraadminv1.AnnouncementTranslation{
			Locale: translation.Locale,
			Title:  translation.Title,
			Body:   translation.Body,
		})
	}
	return &publiraadminv1.AdminAnnouncement{
		Id:             row.ID.String(),
		Title:          row.Title,
		Body:           row.Body,
		LinkUrl:        row.LinkUrl.String,
		CreatedAt:      row.CreatedAt.UTC().Format(time.RFC3339),
		Pinned:         row.Pinned,
		PinnedUntil:    formatPinnedUntil(row.PinnedUntil),
		Translations:   items,
		Delivery:       announcementDeliveryToProto(row.Delivery),
		Audience:       audience,
		DeliverAt:      formatAnnouncementInstant(row.DeliverAt),
		DeliveredAt:    formatAnnouncementInstant(row.DeliveredAt),
		DeliveredCount: row.DeliveredCount,
		OpenedCount:    row.OpenedCount,
	}
}

// announcementAudiencesOf answers the audience of every row that has one,
// keyed by announcement, naming its series and plans by public id in one query
// each for the whole page. An audience this release cannot read, written by a
// later one, is answered with no conditions, so the row still reads as
// targeted rather than as an announcement for everyone.
func (s *adminServer) announcementAudiencesOf(
	ctx context.Context,
	tenantID uuid.UUID,
	rows []dbmodels.ListAnnouncementsForTenantDescRow,
) (map[uuid.UUID]*publiraadminv1.AnnouncementAudience, error) {
	stored := make(map[uuid.UUID]announcementaudience.Audience, len(rows))
	answered := make(map[uuid.UUID]*publiraadminv1.AnnouncementAudience, len(rows))
	for _, row := range rows {
		if row.Audience == nil {
			continue
		}
		audience, ok, err := announcementaudience.Decode(*row.Audience)
		if err != nil || !ok {
			answered[row.ID] = &publiraadminv1.AnnouncementAudience{}
			continue
		}
		stored[row.ID] = audience
	}
	if len(stored) == 0 {
		return answered, nil
	}
	audiences := make([]announcementaudience.Audience, 0, len(stored))
	for _, audience := range stored {
		audiences = append(audiences, audience)
	}
	names, err := announcementaudience.LookUpPublicIDs(ctx, s.queriesFor(ctx), tenantID, audiences...)
	if err != nil {
		return nil, err
	}
	for id, audience := range stored {
		answered[id] = announcementaudience.ToProto(audience, names)
	}
	return answered, nil
}

// formatPinnedUntil renders the instant a banner stops at. An empty answer is
// a banner with no end rather than one that has already ended.
func formatPinnedUntil(pinnedUntil sql.NullTime) string {
	return formatAnnouncementInstant(pinnedUntil)
}

func formatAnnouncementInstant(instant sql.NullTime) string {
	if !instant.Valid {
		return ""
	}
	return instant.Time.UTC().Format(time.RFC3339)
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
	audiences, err := s.announcementAudiencesOf(ctx, tenant.ID, rows)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list announcement audiences", err, "tenant_id", tenant.ID.String())
	}

	items := make([]*publiraadminv1.AdminAnnouncement, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapAdminAnnouncement(row, translations[row.ID], audiences[row.ID]))
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

	content, err := s.announcementContentFrom(ctx, tenant, announcementRequest{
		translations: req.Translations,
		linkURL:      req.LinkUrl,
		pinned:       req.Pinned,
		pinnedUntil:  req.PinnedUntil,
		delivery:     req.Delivery,
		audience:     req.Audience,
		deliverAt:    req.DeliverAt,
	})
	if err != nil {
		return nil, err
	}

	created, owed, err := s.storeAnnouncement(ctx, tenant, content)
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
		Reason:      announcementCreatedReason(content.delivery, content.audience != nil),
		ClientIP:    clientip.FromContext(ctx),
	})

	return &publiraadminv1.CreateAnnouncementResponse{
		Announcement: created,
	}, nil
}

// announcementRequest is what CreateAnnouncement and UpdateAnnouncement are
// both sent, as the request carries it.
type announcementRequest struct {
	translations []*publiraadminv1.AnnouncementTranslation
	linkURL      string
	pinned       bool
	pinnedUntil  string
	delivery     publiraadminv1.AnnouncementDelivery
	audience     *publiraadminv1.AnnouncementAudience
	deliverAt    string
}

// announcementContentFrom checks what CreateAnnouncement or
// UpdateAnnouncement was sent and resolves it into what is written. A banner
// has to stay up past the instant the announcement goes out, or it would never
// be shown.
func (s *adminServer) announcementContentFrom(
	ctx context.Context,
	tenant dbmodels.Tenant,
	req announcementRequest,
) (announcementContent, error) {
	translations, err := announcementTranslationsFrom(req.translations, tenant)
	if err != nil {
		return announcementContent{}, err
	}
	linkURL := strings.TrimSpace(req.linkURL)
	if !isValidAnnouncementLinkURL(linkURL) {
		return announcementContent{}, connect.NewError(connect.CodeInvalidArgument, "link_url must start with / or http(s)://")
	}

	delivery, err := announcementDeliveryFromProto(req.delivery)
	if err != nil {
		return announcementContent{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "delivery")
	}

	now := time.Now()
	deliverAt, scheduled, err := parseDeliverAt(req.deliverAt, now)
	if err != nil {
		return announcementContent{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "deliver_at")
	}

	pinnedUntil := sql.NullTime{}
	if req.pinned {
		pinnedUntil, err = parsePinnedUntil(req.pinnedUntil, now)
		if err != nil {
			return announcementContent{}, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
		}
		if pinnedUntil.Valid && !pinnedUntil.Time.After(deliverAt) {
			return announcementContent{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("pinned_until must be after deliver_at"), "pinned_until")
		}
	}

	audience, err := s.announcementAudienceFrom(ctx, tenant, req.audience, req.pinned, delivery)
	if err != nil {
		return announcementContent{}, err
	}

	return announcementContent{
		translations: translations,
		linkURL:      linkURL,
		pinned:       req.pinned,
		pinnedUntil:  pinnedUntil,
		delivery:     delivery,
		audience:     audience,
		deliverAt:    deliverAt,
		scheduled:    scheduled,
	}, nil
}

// announcementAudienceFrom reads the audience an announcement was sent, nil
// for an announcement addressed to everyone. A targeted announcement is never
// pinned, since a banner is shown to every visitor, and never delivered to
// everyone, since a notice no reader may miss is not one a condition may keep
// from some of them.
func (s *adminServer) announcementAudienceFrom(
	ctx context.Context,
	tenant dbmodels.Tenant,
	raw *publiraadminv1.AnnouncementAudience,
	pinned bool,
	delivery string,
) (*announcementaudience.Audience, error) {
	if raw == nil {
		return nil, nil
	}
	if pinned {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("an announcement with an audience cannot be pinned"), "pinned")
	}
	if delivery == outbox.AnnouncementDeliveryEveryone {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("an announcement with an audience cannot be delivered to everyone"), "delivery")
	}
	audience, err := announcementaudience.FromProto(ctx, s.queriesFor(ctx), tenant, raw)
	if err != nil {
		if fieldErr := rpcerrors.FromFieldError(err); fieldErr != nil {
			return nil, fieldErr
		}
		return nil, s.internalDBError(ctx, "failed to resolve announcement audience", err, "tenant_id", tenant.ID.String())
	}
	return &audience, nil
}

// CountAnnouncementAudience answers how many readers an audience selects, by
// the function delivery reads through, so the form shows the reach the worker
// would then deliver to. It answers a number and nothing more: a list of the
// readers would be the one the member policies keep out of the console. A
// count changes nothing, so it is not audited.
func (s *adminServer) CountAnnouncementAudience(
	ctx context.Context,
	req *publiraadminv1.CountAnnouncementAudienceRequest,
) (*publiraadminv1.CountAnnouncementAudienceResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}

	if req.Audience == nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("audience must name at least one condition"), "audience")
	}
	audience, err := announcementaudience.FromProto(ctx, s.queriesFor(ctx), tenant, req.Audience)
	if err != nil {
		if fieldErr := rpcerrors.FromFieldError(err); fieldErr != nil {
			return nil, fieldErr
		}
		return nil, s.internalDBError(ctx, "failed to resolve announcement audience", err, "tenant_id", tenant.ID.String())
	}
	encoded, err := audience.Encode()
	if err != nil {
		return nil, s.internalError(ctx, "failed to encode announcement audience", err, "tenant_id", tenant.ID.String())
	}
	count, err := s.queriesFor(ctx).CountAnnouncementAudience(ctx, encoded)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count announcement audience", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.CountAnnouncementAudienceResponse{ReaderCount: count}, nil
}

// announcementTranslationInput is one locale's copy an announcement was asked
// to carry, with its locale resolved.
type announcementTranslationInput struct {
	locale string
	title  string
	body   string
}

// announcementTranslationsFrom checks the copy an announcement was sent: a
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

// announcementContent is what one CreateAnnouncement or UpdateAnnouncement
// call writes.
type announcementContent struct {
	translations []announcementTranslationInput
	linkURL      string
	pinned       bool
	pinnedUntil  sql.NullTime
	delivery     string
	// audience is nil for an announcement addressed to everyone.
	audience *announcementaudience.Audience
	// deliverAt is the instant the announcement goes out at, and scheduled
	// whether that is later rather than now. A scheduled one is written
	// undelivered, for the deliver-announcements job to queue its event.
	deliverAt time.Time
	scheduled bool
}

// deliveredAt is what the row records as delivered: now for an announcement
// that goes out at once, nothing for a scheduled one.
func (c announcementContent) deliveredAt() sql.NullTime {
	if c.scheduled {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: c.deliverAt, Valid: true}
}

// encodedAudience is the audience as the row stores it, nil for everyone.
func (c announcementContent) encodedAudience() (*json.RawMessage, error) {
	if c.audience == nil {
		return nil, nil
	}
	encoded, err := c.audience.Encode()
	if err != nil {
		return nil, fmt.Errorf("encode announcement audience: %w", err)
	}
	return &encoded, nil
}

// storeAnnouncement writes the announcement row and its translations and, in
// the same transaction, the event that puts it in its readers' notification
// inboxes, so a delivery nobody is ever told about cannot outlive the request
// that made it. A scheduled one is written without the event, which the
// deliver-announcements job queues once its time has passed. A pinned one that
// goes out now also owes the banner's cache drop, which the caller sends.
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
	owed, err := s.deliverAnnouncementNow(ctx, txq, tenant.ID, row, content)
	if err != nil {
		return nil, revalidate.Owed{}, err
	}
	if err := tx.Commit(); err != nil {
		return nil, revalidate.Owed{}, err
	}

	answer, err := s.announcementAnswer(ctx, tenant, row, translations, content.audience)
	if err != nil {
		return nil, revalidate.Owed{}, err
	}
	return answer, owed, nil
}

// deliverAnnouncementNow queues the event of an announcement that goes out at
// once, and records the banner's drop when it is pinned. A scheduled one owes
// neither yet: nobody is shown it until the deliver-announcements job does
// both.
func (s *adminServer) deliverAnnouncementNow(
	ctx context.Context,
	txq *dbmodels.Queries,
	tenantID uuid.UUID,
	row dbmodels.Announcement,
	content announcementContent,
) (revalidate.Owed, error) {
	if content.scheduled {
		return revalidate.Owed{}, nil
	}
	if err := outbox.QueueAnnouncementNotification(ctx, txq, tenantID, row.ID, row.Audience != nil); err != nil {
		return revalidate.Owed{}, err
	}
	if !content.pinned {
		return revalidate.Owed{}, nil
	}
	return s.reval.Record(ctx, txq, tenantID, pinnedannouncements.RevalidateTags(tenantID))
}

// announcementAnswer answers a row just written as the console lists it. The
// worker has delivered it to nobody yet, so both counts are 0.
func (s *adminServer) announcementAnswer(
	ctx context.Context,
	tenant dbmodels.Tenant,
	row dbmodels.Announcement,
	translations []dbmodels.AnnouncementTranslation,
	stored *announcementaudience.Audience,
) (*publiraadminv1.AdminAnnouncement, error) {
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
		DeliverAt:        row.DeliverAt,
		DeliveredAt:      row.DeliveredAt,
	}
	for _, translation := range translations {
		if translation.Locale == tenant.DefaultLocale {
			listed.Title = translation.Title
			listed.Body = translation.Body
		}
	}
	var audience *publiraadminv1.AnnouncementAudience
	if stored != nil {
		names, err := announcementaudience.LookUpPublicIDs(ctx, s.queriesFor(ctx), tenant.ID, *stored)
		if err != nil {
			return nil, err
		}
		audience = announcementaudience.ToProto(*stored, names)
	}
	return mapAdminAnnouncement(listed, translations, audience), nil
}

// createAnnouncementRow writes one announcement with its translations.
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
	audience, err := content.encodedAudience()
	if err != nil {
		return dbmodels.Announcement{}, nil, err
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
		Audience:         audience,
		DeliverAt:        sql.NullTime{Time: content.deliverAt, Valid: true},
		DeliveredAt:      content.deliveredAt(),
	})
	if err != nil {
		return dbmodels.Announcement{}, nil, err
	}
	translations, err := createAnnouncementTranslations(ctx, queries, tenantID, row.ID, content.translations)
	if err != nil {
		return dbmodels.Announcement{}, nil, err
	}
	return row, translations, nil
}

// createAnnouncementTranslations writes the copy of one announcement, a row
// per locale.
func createAnnouncementTranslations(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, announcementID uuid.UUID,
	inputs []announcementTranslationInput,
) ([]dbmodels.AnnouncementTranslation, error) {
	translations := make([]dbmodels.AnnouncementTranslation, 0, len(inputs))
	for _, input := range inputs {
		translationID, err := uuid.NewV7()
		if err != nil {
			return nil, fmt.Errorf("allocate announcement translation id: %w", err)
		}
		translation, err := queries.CreateAnnouncementTranslation(ctx, dbmodels.CreateAnnouncementTranslationParams{
			ID:             translationID,
			AnnouncementID: announcementID,
			TenantID:       tenantID,
			Locale:         input.locale,
			Title:          input.title,
			Body:           input.body,
		})
		if err != nil {
			return nil, err
		}
		translations = append(translations, translation)
	}
	return translations, nil
}

// errAnnouncementDelivered refuses an edit or a deletion of an announcement
// that has gone out: readers were shown it and notified of it, so it is not
// rewritten or taken away under them.
func errAnnouncementDelivered() error {
	return connect.NewError(connect.CodeFailedPrecondition, "announcement has been delivered")
}

// lockScheduledAnnouncement reads the announcement UpdateAnnouncement or
// DeleteAnnouncement is about, locked for the rest of the transaction, and
// refuses one that is missing or has been delivered. The lock is what keeps
// the deliver-announcements job from delivering it between this check and the
// write: the job waits, then delivers what the write left if it is still due,
// or nothing.
func (s *adminServer) lockScheduledAnnouncement(
	ctx context.Context,
	txq *dbmodels.Queries,
	tenantID, announcementID uuid.UUID,
) error {
	row, err := txq.GetAnnouncementForUpdate(ctx, dbmodels.GetAnnouncementForUpdateParams{
		ID:       announcementID,
		TenantID: tenantID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewError(connect.CodeNotFound, "announcement not found")
		}
		return s.internalDBError(ctx, "failed to read announcement", err, "tenant_id", tenantID.String(), "announcement_id", announcementID.String())
	}
	if row.DeliveredAt.Valid {
		return errAnnouncementDelivered()
	}
	return nil
}

// UpdateAnnouncement replaces the whole of a scheduled announcement, so a
// scheduled one is a draft with a clock rather than a second kind of record.
// An empty deliver_at delivers it now, in the same transaction, as
// CreateAnnouncement does.
func (s *adminServer) UpdateAnnouncement(
	ctx context.Context,
	req *publiraadminv1.UpdateAnnouncementRequest,
) (*publiraadminv1.UpdateAnnouncementResponse, error) {
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
	content, err := s.announcementContentFrom(ctx, tenant, announcementRequest{
		translations: req.Translations,
		linkURL:      req.LinkUrl,
		pinned:       req.Pinned,
		pinnedUntil:  req.PinnedUntil,
		delivery:     req.Delivery,
		audience:     req.Audience,
		deliverAt:    req.DeliverAt,
	})
	if err != nil {
		return nil, err
	}

	updated, owed, err := s.replaceAnnouncement(ctx, tenant, announcementID, content)
	if err != nil {
		return nil, err
	}
	s.reval.Send(ctx, owed)

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "announcement_updated",
		TargetType:  "announcement",
		TargetID:    announcementID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      announcementCreatedReason(content.delivery, content.audience != nil),
		ClientIP:    clientip.FromContext(ctx),
	})

	return &publiraadminv1.UpdateAnnouncementResponse{Announcement: updated}, nil
}

// replaceAnnouncement writes content over a scheduled announcement and its
// translations, and delivers it when content asks for now.
func (s *adminServer) replaceAnnouncement(
	ctx context.Context,
	tenant dbmodels.Tenant,
	announcementID uuid.UUID,
	content announcementContent,
) (*publiraadminv1.AdminAnnouncement, revalidate.Owed, error) {
	internal := func(err error) error {
		return s.internalDBError(ctx, "failed to update announcement", err, "tenant_id", tenant.ID.String(), "announcement_id", announcementID.String())
	}
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, revalidate.Owed{}, internal(err)
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	if err := s.lockScheduledAnnouncement(ctx, txq, tenant.ID, announcementID); err != nil {
		return nil, revalidate.Owed{}, err
	}
	audience, err := content.encodedAudience()
	if err != nil {
		return nil, revalidate.Owed{}, internal(err)
	}
	row, err := txq.UpdateAnnouncement(ctx, dbmodels.UpdateAnnouncementParams{
		ID:          announcementID,
		TenantID:    tenant.ID,
		LinkUrl:     sql.NullString{String: content.linkURL, Valid: content.linkURL != ""},
		Pinned:      content.pinned,
		PinnedUntil: content.pinnedUntil,
		Delivery:    content.delivery,
		Audience:    audience,
		DeliverAt:   sql.NullTime{Time: content.deliverAt, Valid: true},
		DeliveredAt: content.deliveredAt(),
	})
	if err != nil {
		return nil, revalidate.Owed{}, internal(err)
	}
	if err := txq.DeleteAnnouncementTranslations(ctx, dbmodels.DeleteAnnouncementTranslationsParams{
		TenantID:       tenant.ID,
		AnnouncementID: announcementID,
	}); err != nil {
		return nil, revalidate.Owed{}, internal(err)
	}
	translations, err := createAnnouncementTranslations(ctx, txq, tenant.ID, announcementID, content.translations)
	if err != nil {
		return nil, revalidate.Owed{}, internal(err)
	}
	owed, err := s.deliverAnnouncementNow(ctx, txq, tenant.ID, row, content)
	if err != nil {
		return nil, revalidate.Owed{}, internal(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, revalidate.Owed{}, internal(err)
	}

	answer, err := s.announcementAnswer(ctx, tenant, row, translations, content.audience)
	if err != nil {
		return nil, revalidate.Owed{}, internal(err)
	}
	return answer, owed, nil
}

// DeleteAnnouncement deletes a scheduled announcement with its translations.
// Nobody has been shown it or notified of it, so there is nothing to drop from
// a cache and nothing to take back from an inbox.
func (s *adminServer) DeleteAnnouncement(
	ctx context.Context,
	req *publiraadminv1.DeleteAnnouncementRequest,
) (*publiraadminv1.DeleteAnnouncementResponse, error) {
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

	internal := func(err error) error {
		return s.internalDBError(ctx, "failed to delete announcement", err, "tenant_id", tenant.ID.String(), "announcement_id", announcementID.String())
	}
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, internal(err)
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	if err := s.lockScheduledAnnouncement(ctx, txq, tenant.ID, announcementID); err != nil {
		return nil, err
	}
	if _, err := txq.DeleteAnnouncement(ctx, dbmodels.DeleteAnnouncementParams{
		ID:       announcementID,
		TenantID: tenant.ID,
	}); err != nil {
		return nil, internal(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, internal(err)
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "announcement_deleted",
		TargetType:  "announcement",
		TargetID:    announcementID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    clientip.FromContext(ctx),
	})

	return &publiraadminv1.DeleteAnnouncementResponse{}, nil
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
