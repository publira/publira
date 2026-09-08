package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// The staff alerts a reader's own writing raises: a comment that landed in the
// approval queue, and a report filed against a published one.
//
// Both are drained here rather than written by the RPC that caused them. The
// recipients are every member of staff the tenant has, so the fan-out is a
// query and an insert per person while a reader waits for their comment to be
// accepted; and the notification is a side effect of the write rather than part
// of it, so a failure to raise it must not refuse the comment.
const (
	EventTypeCommentAwaitingApprovalNotification = "comment_awaiting_approval_notification"
	EventTypeCommentReportedNotification         = "comment_reported_notification"
)

// The notifications.notification_type values the handlers write. The admin
// console assembles its copy from these plus the payload; there is no title or
// body column.
const (
	NotificationTypeCommentAwaitingApproval = "comment_awaiting_approval"
	NotificationTypeCommentReported         = "comment_reported"
)

// staffCommentWindow is how long one episode's alerts collapse into a single
// notification.
//
// An episode a hundred readers comment on within the hour is one queue to work
// through, not a hundred errands, and a bell holding a hundred rows saying the
// same thing is a bell staff stop reading. An hour is short enough that a
// report filed on a quiet evening is still seen while it matters: the first
// event of every window is raised the moment it arrives, and it is the ones
// behind it that are absorbed.
const staffCommentWindow = time.Hour

// StaffCommentSubjectKey is the identity every alert about one episode shares
// for the length of a window. It is the notification's subject_key and the tail
// of the event's idempotency key, so the collapsing happens twice over: the
// second comment of a window inserts no event, and an event redelivered after
// its notifications were written inserts no second row for anyone.
//
// Windows are cut on the UTC hour rather than on the tenant's own clock. The
// key is not a date anybody reads — it never reaches a screen — so a tenant
// time zone would only make two tenants commenting on the same minute collapse
// differently.
func StaffCommentSubjectKey(episodePublicID string, at time.Time) string {
	return fmt.Sprintf("episode:%s:%s",
		episodePublicID,
		at.UTC().Truncate(staffCommentWindow).Format("2006-01-02T15"),
	)
}

// StaffCommentIdempotencyKey is the outbox key for one window's event. The
// event type separates the approval queue from the report queue — a reported
// comment on an episode that also has one waiting for approval is two errands —
// and the tenant separates two tenants whose episodes share a public ID, since
// outbox_events.idempotency_key is unique across all of them.
func StaffCommentIdempotencyKey(eventType string, tenantID uuid.UUID, subjectKey string) string {
	return fmt.Sprintf("%s:%s:%s", eventType, tenantID, subjectKey)
}

// StaffCommentNotificationPayload is the JSON body of both events.
//
// It names the episode rather than the comment because a window's worth of
// comments is what the alert stands for. The four catalog fields are also the
// notification's own payload, which is what the console renders and links from.
type StaffCommentNotificationPayload struct {
	TenantID     string `json:"tenant_id"`
	SubjectKey   string `json:"subject_key"`
	EpisodeID    string `json:"episode_id"`
	EpisodeTitle string `json:"episode_title"`
	SeriesID     string `json:"series_id"`
	SeriesTitle  string `json:"series_title"`
}

// StaffNotificationHandlerConfig is what the worker resolves once at startup
// for the staff notification handlers.
type StaffNotificationHandlerConfig struct {
	DB     *sql.DB
	Logger *slog.Logger
}

// staffNotificationQuerier is the statement pair the handlers run, named so a
// test can drive the fan-out without a database behind it.
type staffNotificationQuerier interface {
	ListTenantAdminIDs(ctx context.Context, tenantID uuid.UUID) ([]uuid.UUID, error)
	CreateNotification(ctx context.Context, arg dbmodels.CreateNotificationParams) (dbmodels.Notification, error)
}

// NewCommentAwaitingApprovalNotificationHandler tells the tenant's staff that
// an episode has comments waiting in the approval queue.
func NewCommentAwaitingApprovalNotificationHandler(cfg StaffNotificationHandlerConfig) Handler {
	return newStaffCommentNotificationHandler(cfg, NotificationTypeCommentAwaitingApproval)
}

// NewCommentReportedNotificationHandler tells the tenant's staff that an
// episode has comments readers reported.
func NewCommentReportedNotificationHandler(cfg StaffNotificationHandlerConfig) Handler {
	return newStaffCommentNotificationHandler(cfg, NotificationTypeCommentReported)
}

func newStaffCommentNotificationHandler(cfg StaffNotificationHandlerConfig, notificationType string) Handler {
	if cfg.DB == nil {
		// Reported per event rather than at registration, and as a plain error
		// rather than a [Permanent] one, because an operator restarting the
		// worker with a database makes a pending event deliverable again.
		return func(context.Context, dbmodels.OutboxEvent) error {
			return errors.New("staff comment notification handler database is not configured")
		}
	}
	return staffCommentNotificationHandler(cfg, notificationType, dbmodels.New(cfg.DB))
}

func staffCommentNotificationHandler(
	cfg StaffNotificationHandlerConfig,
	notificationType string,
	queries staffNotificationQuerier,
) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		var payload StaffCommentNotificationPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode staff comment notification payload: %w", err))
		}
		tenantID, err := staffCommentTenantID(event, payload.TenantID)
		if err != nil {
			return Permanent(err)
		}
		subjectKey := strings.TrimSpace(payload.SubjectKey)
		if subjectKey == "" {
			return Permanent(errors.New("staff comment notification payload names no subject"))
		}
		body, err := json.Marshal(staffCommentNotificationBody{
			EpisodeID:    payload.EpisodeID,
			EpisodeTitle: payload.EpisodeTitle,
			SeriesID:     payload.SeriesID,
			SeriesTitle:  payload.SeriesTitle,
		})
		if err != nil {
			return Permanent(fmt.Errorf("encode staff comment notification body: %w", err))
		}

		staff, err := queries.ListTenantAdminIDs(ctx, tenantID)
		if err != nil {
			return fmt.Errorf("list tenant staff: %w", err)
		}
		if len(staff) == 0 {
			// A tenant whose last administrator was removed still has a queue,
			// and the row it would be shown in has no recipient. Completing is
			// the honest answer: a retry would find the same empty list.
			logStaffComment(ctx, cfg.Logger, "no staff to notify about comments", event,
				"notification_type", notificationType)
			return nil
		}

		for _, userID := range staff {
			notificationID, err := uuid.NewV7()
			if err != nil {
				return fmt.Errorf("allocate notification id: %w", err)
			}
			_, err = queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
				ID:               notificationID,
				TenantID:         tenantID,
				UserID:           userID,
				NotificationType: notificationType,
				SubjectKey:       subjectKey,
				Payload:          body,
			})
			// No rows means this recipient already has this window's row, which
			// is what a redelivered event looks like.
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("insert notification for %s: %w", userID, err)
			}
		}
		return nil
	}
}

// staffCommentNotificationBody is what the console reads back. It is the
// catalog half of the event payload: the tenant and the subject key are how the
// event found its recipients, and neither says anything to the person reading
// the row. A field the producer could not fill is left out rather than written
// as an empty string the console would render as a blank line.
type staffCommentNotificationBody struct {
	EpisodeID    string `json:"episode_id,omitempty"`
	EpisodeTitle string `json:"episode_title,omitempty"`
	SeriesID     string `json:"series_id,omitempty"`
	SeriesTitle  string `json:"series_title,omitempty"`
}

// staffCommentTenantID takes the tenant from the event row and checks the
// payload agrees. The table already enforces the pair, so a disagreement is a
// row written around the producer.
func staffCommentTenantID(event dbmodels.OutboxEvent, payloadTenantID string) (uuid.UUID, error) {
	if !event.TenantID.Valid {
		return uuid.Nil, errors.New("staff comment notification event carries no tenant")
	}
	parsed, err := uuid.Parse(strings.TrimSpace(payloadTenantID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("staff comment notification payload tenant_id is invalid: %w", err)
	}
	if parsed != event.TenantID.UUID {
		return uuid.Nil, errors.New("staff comment notification payload tenant_id does not match the event")
	}
	return event.TenantID.UUID, nil
}

func logStaffComment(ctx context.Context, logger *slog.Logger, message string, event dbmodels.OutboxEvent, attrs ...any) {
	if logger == nil {
		return
	}
	logger.InfoContext(ctx, message, append([]any{
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
	}, attrs...)...)
}
