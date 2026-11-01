package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/announcementaudience"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// EventTypeAnnouncementNotification puts an announcement the console posted in
// front of every user of the tenant, as a row in their notification inbox:
// listed for those whose announcements cell is on, or for all of them when the
// announcement was posted for everyone.
//
// It is drained here rather than written by CreateAnnouncement itself. The
// fan-out is a query and an insert per person while an operator waits for the
// form to come back, and it grows with the tenant's readership rather than with
// what was posted.
const EventTypeAnnouncementNotification = "announcement_notification"

// EventTypeTargetedAnnouncementNotification is the same fan-out for an
// announcement with an audience, which reaches only the readers the audience
// selects when the event is handled. It is a type of its own because the
// previous release's worker handles [EventTypeAnnouncementNotification] by
// notifying every user of the tenant; a type it does not know it leaves
// pending, for a worker that reads the audience to claim.
const EventTypeTargetedAnnouncementNotification = "targeted_announcement_notification"

// NotificationTypeAnnouncementPosted is the notifications.notification_type the
// handler writes. The storefront assembles its copy from this plus the payload;
// there is no title or body column.
//
// It reaches the bell and the mail. It is not on the push allowlist, because an
// announcement is the tenant talking to its whole readership at a time of the
// operator's choosing, which is not what a lock screen is for.
const NotificationTypeAnnouncementPosted = "announcement_posted"

// AnnouncementDeliveryPreferred and AnnouncementDeliveryEveryone are the
// announcements.delivery values. A preferred announcement answers to each
// reader's announcements cell; one for everyone reaches every reader whatever
// that cell says, for the notice a reader must not miss on a channel that
// otherwise carries campaign news.
const (
	AnnouncementDeliveryPreferred = "preferred"
	AnnouncementDeliveryEveryone  = "everyone"
)

// announcementRecipientPageSize bounds one recipient query, for the reason
// DefaultEpisodeFollowerPageSize does: the handler walks the tenant's users a
// page at a time instead of materializing every one of them before the first
// insert.
const announcementRecipientPageSize = int32(500)

// AnnouncementSubjectKey is the identity one announcement's notifications
// share, so a redelivered event writes no second row for anyone.
func AnnouncementSubjectKey(announcementID uuid.UUID) string {
	return "announcement:" + announcementID.String()
}

// AnnouncementIdempotencyKey is the outbox key for one announcement's event.
// The announcement id is already unique across every tenant, so it alone
// separates two tenants posting in the same moment.
func AnnouncementIdempotencyKey(announcementID uuid.UUID) string {
	return EventTypeAnnouncementNotification + ":" + announcementID.String()
}

// TargetedAnnouncementIdempotencyKey is [AnnouncementIdempotencyKey] for the
// event of an announcement with an audience.
func TargetedAnnouncementIdempotencyKey(announcementID uuid.UUID) string {
	return EventTypeTargetedAnnouncementNotification + ":" + announcementID.String()
}

// AnnouncementNotificationPayload is the JSON body of either event. It carries
// no copy and no audience: the title each reader is told is the one their own
// locale picks, and who the readers are is what the audience selects when the
// event is handled, so both are read then.
type AnnouncementNotificationPayload struct {
	TenantID       string `json:"tenant_id"`
	AnnouncementID string `json:"announcement_id"`
}

// announcementNotificationBody is what the inbox reads back. The tenant and the
// announcement id are how the row found its recipients and neither says
// anything to the person reading it, so the title is all that is carried; the
// row links at the announcements inbox, where the body is. The title is that of
// the translation the reader's last locale picks, so each reader's row is
// written in their own language.
type announcementNotificationBody struct {
	AnnouncementTitle string `json:"announcement_title,omitempty"`
}

// AnnouncementNotificationHandlerConfig is what the worker resolves once at
// startup for the announcement handler.
type AnnouncementNotificationHandlerConfig struct {
	DB     *sql.DB
	Logger *slog.Logger
}

// announcementNotificationQuerier is the statements the handler runs, named so
// a test can drive the fan-out without a database behind it.
type announcementNotificationQuerier interface {
	GetAnnouncementDelivery(ctx context.Context, arg dbmodels.GetAnnouncementDeliveryParams) (dbmodels.GetAnnouncementDeliveryRow, error)
	ListAnnouncementRecipients(ctx context.Context, arg dbmodels.ListAnnouncementRecipientsParams) ([]dbmodels.ListAnnouncementRecipientsRow, error)
	AnnouncementHasNotifications(ctx context.Context, arg dbmodels.AnnouncementHasNotificationsParams) (bool, error)
	CreateNotification(ctx context.Context, arg dbmodels.CreateNotificationParams) error
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

// NewAnnouncementNotificationHandler writes one bell notification per reader a
// posted announcement addresses, and queues the mail that mirrors them. It
// handles both [EventTypeAnnouncementNotification] and
// [EventTypeTargetedAnnouncementNotification]: the announcement row says
// whether it has an audience, and the recipient query reads it from there.
func NewAnnouncementNotificationHandler(cfg AnnouncementNotificationHandlerConfig) Handler {
	if cfg.DB == nil {
		// Reported per event rather than at registration, and as a plain error
		// rather than a [Permanent] one, because an operator restarting the
		// worker with a database makes a pending event deliverable again.
		return func(context.Context, dbmodels.OutboxEvent) error {
			return errors.New("announcement notification handler database is not configured")
		}
	}
	return announcementNotificationHandler(cfg, dbmodels.New(cfg.DB))
}

func announcementNotificationHandler(
	cfg AnnouncementNotificationHandlerConfig,
	queries announcementNotificationQuerier,
) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		var payload AnnouncementNotificationPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode announcement notification payload: %w", err))
		}
		tenantID, err := announcementTenantID(event, payload.TenantID)
		if err != nil {
			return Permanent(err)
		}
		announcementID, err := uuid.Parse(strings.TrimSpace(payload.AnnouncementID))
		if err != nil {
			return Permanent(fmt.Errorf("announcement notification payload announcement_id is invalid: %w", err))
		}
		announcement, err := queries.GetAnnouncementDelivery(ctx, dbmodels.GetAnnouncementDeliveryParams{
			TenantID:       tenantID,
			AnnouncementID: announcementID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			// An announcement that is not there has nobody to be told about
			// it, and a retry would find the same nothing.
			logAnnouncement(ctx, cfg.Logger, "announcement to notify about is gone", event,
				"announcement_id", announcementID.String())
			return nil
		}
		if err != nil {
			return fmt.Errorf("get announcement delivery: %w", err)
		}
		category, err := announcementCategory(announcement.Delivery)
		if err != nil {
			return Permanent(err)
		}
		// The recipient query evaluates the stored audience itself, and selects
		// nobody for one it cannot read. Refusing it here instead makes an
		// audience no worker can deliver a dead event someone sees, rather than
		// an announcement that completed having told nobody.
		var audience []byte
		if announcement.Audience != nil {
			audience = *announcement.Audience
		}
		if _, _, err := announcementaudience.Decode(audience); err != nil {
			return Permanent(err)
		}
		insert := func(recipient dbmodels.ListAnnouncementRecipientsRow) error {
			body, encodeErr := json.Marshal(announcementNotificationBody{
				AnnouncementTitle: strings.TrimSpace(recipient.Title),
			})
			if encodeErr != nil {
				return Permanent(fmt.Errorf("encode announcement notification body: %w", encodeErr))
			}
			notificationID, idErr := uuid.NewV7()
			if idErr != nil {
				return fmt.Errorf("allocate notification id: %w", idErr)
			}
			insertErr := queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
				ID:               notificationID,
				TenantID:         tenantID,
				UserID:           recipient.UserID,
				NotificationType: NotificationTypeAnnouncementPosted,
				SubjectKey:       AnnouncementSubjectKey(announcementID),
				Payload:          body,
				Category:         category,
			})
			// A recipient who already has this announcement's row, which is what
			// a redelivered event looks like, is a no-op rather than an error.
			if insertErr != nil {
				return fmt.Errorf("insert notification for %s: %w", recipient.UserID, insertErr)
			}
			return nil
		}

		notified := 0
		// The nil UUID sorts below every UUID, so the first page starts there.
		after := uuid.Nil
		for {
			recipients, listErr := queries.ListAnnouncementRecipients(ctx, dbmodels.ListAnnouncementRecipientsParams{
				AnnouncementID: announcementID,
				TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
				AfterUserID:    after,
				Limit:          announcementRecipientPageSize,
			})
			if listErr != nil {
				return fmt.Errorf("list announcement recipients: %w", listErr)
			}
			if len(recipients) == 0 {
				break
			}
			for _, recipient := range recipients {
				if err := insert(recipient); err != nil {
					return err
				}
			}
			notified += len(recipients)
			after = recipients[len(recipients)-1].UserID
			if int32(len(recipients)) < announcementRecipientPageSize {
				break
			}
		}
		if notified == 0 {
			// A retry evaluates the audience again, and a reader an earlier
			// attempt wrote a row for may no longer meet it. The mail reads
			// the rows that were written, so it is still owed for them.
			written, err := queries.AnnouncementHasNotifications(ctx, dbmodels.AnnouncementHasNotificationsParams{
				TenantID:   tenantID,
				SubjectKey: AnnouncementSubjectKey(announcementID),
			})
			if err != nil {
				return fmt.Errorf("check announcement notifications: %w", err)
			}
			if written {
				return queueNotificationEmail(ctx, queries, tenantID, NotificationTypeAnnouncementPosted, AnnouncementSubjectKey(announcementID))
			}
			// A tenant with no users, or an audience nobody meets, still has
			// the announcement on its own list. Completing is the honest
			// answer: a retry would find the same empty readership, and a
			// reader who comes to meet the audience later is not sent it.
			logAnnouncement(ctx, cfg.Logger, "no readers to notify about an announcement", event,
				"announcement_id", announcementID.String())
			return nil
		}
		return queueNotificationEmail(ctx, queries, tenantID, NotificationTypeAnnouncementPosted, AnnouncementSubjectKey(announcementID))
	}
}

// announcementCategory files an announcement's rows by its delivery. One for
// everyone is filed under a category no preference governs, so its row is
// listed in every inbox, and a channel the type is later admitted to lets it
// through the same way without a rule of its own.
func announcementCategory(delivery string) (string, error) {
	switch delivery {
	case AnnouncementDeliveryPreferred:
		return NotificationCategoryFor(NotificationTypeAnnouncementPosted)
	case AnnouncementDeliveryEveryone:
		return NotificationCategoryFor(NotificationTypeAnnouncementPosted, NotificationCategoryEveryone)
	default:
		return "", fmt.Errorf("announcement delivery %q is not one the fan-out knows", delivery)
	}
}

// announcementTenantID takes the tenant from the event row and checks the
// payload agrees. The table already enforces the pair, so a disagreement is a
// row written around the producer.
func announcementTenantID(event dbmodels.OutboxEvent, payloadTenantID string) (uuid.UUID, error) {
	if !event.TenantID.Valid {
		return uuid.Nil, errors.New("announcement notification event carries no tenant")
	}
	parsed, err := uuid.Parse(strings.TrimSpace(payloadTenantID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("announcement notification payload tenant_id is invalid: %w", err)
	}
	if parsed != event.TenantID.UUID {
		return uuid.Nil, errors.New("announcement notification payload tenant_id does not match the event")
	}
	return event.TenantID.UUID, nil
}

func logAnnouncement(ctx context.Context, logger *slog.Logger, message string, event dbmodels.OutboxEvent, attrs ...any) {
	if logger == nil {
		return
	}
	logger.InfoContext(ctx, message, append([]any{
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
	}, attrs...)...)
}
