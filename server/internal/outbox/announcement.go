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

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// EventTypeAnnouncementNotification puts an announcement the console posted in
// front of the readers it addresses, as a row in their notification inbox.
//
// It is drained here rather than written by CreateAnnouncement itself. A
// broadcast addresses every user the tenant has, so the fan-out is a query and
// an insert per person while an operator waits for the form to come back, and
// it grows with the tenant's readership rather than with what was posted.
const EventTypeAnnouncementNotification = "announcement_notification"

// NotificationTypeAnnouncementPosted is the notifications.notification_type the
// handler writes. The storefront assembles its copy from this plus the payload;
// there is no title or body column.
//
// It is bell-only. It is not on the push allowlist, because an announcement is
// the tenant talking to its whole readership at a time of the operator's
// choosing, which is not what a lock screen is for.
const NotificationTypeAnnouncementPosted = "announcement_posted"

// announcementRecipientPageSize bounds one recipient query, for the reason
// defaultFollowerPageSize does in the publish runner: the handler walks the
// tenant's users a page at a time instead of materializing every one of them
// before the first insert.
const announcementRecipientPageSize = int32(500)

// AnnouncementSubjectKey is the identity one announcement's notifications
// share. A redelivered event therefore writes no second row for anyone, and a
// targeted announcement — which is one `announcements` row per recipient — gets
// a key of its own for each.
func AnnouncementSubjectKey(announcementID uuid.UUID) string {
	return "announcement:" + announcementID.String()
}

// AnnouncementIdempotencyKey is the outbox key for one announcement's event.
// The announcement id is already unique across every tenant, so it alone
// separates two tenants posting in the same moment.
func AnnouncementIdempotencyKey(announcementID uuid.UUID) string {
	return EventTypeAnnouncementNotification + ":" + announcementID.String()
}

// AnnouncementNotificationPayload is the JSON body of the event.
//
// TargetUserID is what tells the two audiences apart: empty is the broadcast
// every user of the tenant is addressed by, and a user id is the single reader
// a targeted announcement names.
type AnnouncementNotificationPayload struct {
	TenantID       string `json:"tenant_id"`
	AnnouncementID string `json:"announcement_id"`
	TargetUserID   string `json:"target_user_id,omitempty"`
	Title          string `json:"title"`
}

// announcementNotificationBody is what the inbox reads back. The tenant and the
// announcement id are how the row found its recipients and neither says
// anything to the person reading it, so the title is all that is carried; the
// row links at the announcements inbox, where the body is.
type announcementNotificationBody struct {
	AnnouncementTitle string `json:"announcement_title,omitempty"`
}

// AnnouncementNotificationHandlerConfig is what the worker resolves once at
// startup for the announcement handler.
type AnnouncementNotificationHandlerConfig struct {
	DB     *sql.DB
	Logger *slog.Logger
}

// announcementNotificationQuerier is the statement pair the handler runs, named
// so a test can drive the fan-out without a database behind it.
type announcementNotificationQuerier interface {
	ListTenantUserIDs(ctx context.Context, arg dbmodels.ListTenantUserIDsParams) ([]uuid.UUID, error)
	CreateNotification(ctx context.Context, arg dbmodels.CreateNotificationParams) (dbmodels.Notification, error)
}

// NewAnnouncementNotificationHandler writes one bell notification per reader a
// posted announcement addresses.
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
		body, err := json.Marshal(announcementNotificationBody{
			AnnouncementTitle: strings.TrimSpace(payload.Title),
		})
		if err != nil {
			return Permanent(fmt.Errorf("encode announcement notification body: %w", err))
		}

		insert := func(userID uuid.UUID) error {
			notificationID, idErr := uuid.NewV7()
			if idErr != nil {
				return fmt.Errorf("allocate notification id: %w", idErr)
			}
			_, insertErr := queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
				ID:               notificationID,
				TenantID:         tenantID,
				UserID:           userID,
				NotificationType: NotificationTypeAnnouncementPosted,
				SubjectKey:       AnnouncementSubjectKey(announcementID),
				Payload:          body,
			})
			// No rows means this recipient already has this announcement's row,
			// which is what a redelivered event looks like.
			if insertErr != nil && !errors.Is(insertErr, sql.ErrNoRows) {
				return fmt.Errorf("insert notification for %s: %w", userID, insertErr)
			}
			return nil
		}

		if target := strings.TrimSpace(payload.TargetUserID); target != "" {
			targetID, parseErr := uuid.Parse(target)
			if parseErr != nil {
				return Permanent(fmt.Errorf("announcement notification payload target_user_id is invalid: %w", parseErr))
			}
			return insert(targetID)
		}

		notified := 0
		// The nil UUID sorts below every UUID, so the first page starts there.
		after := uuid.Nil
		for {
			recipients, listErr := queries.ListTenantUserIDs(ctx, dbmodels.ListTenantUserIDsParams{
				TenantID:    uuid.NullUUID{UUID: tenantID, Valid: true},
				AfterUserID: after,
				Limit:       announcementRecipientPageSize,
			})
			if listErr != nil {
				return fmt.Errorf("list announcement recipients: %w", listErr)
			}
			if len(recipients) == 0 {
				break
			}
			for _, userID := range recipients {
				if err := insert(userID); err != nil {
					return err
				}
			}
			notified += len(recipients)
			after = recipients[len(recipients)-1]
			if int32(len(recipients)) < announcementRecipientPageSize {
				break
			}
		}
		if notified == 0 {
			// A tenant with no users still has the announcement on its own
			// list. Completing is the honest answer: a retry would find the
			// same empty readership.
			logAnnouncement(ctx, cfg.Logger, "no readers to notify about an announcement", event,
				"announcement_id", announcementID.String())
		}
		return nil
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
