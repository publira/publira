package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// EventTypeCommentApprovedNotification tells a reader that staff approved
// their comment.
//
// It is drained here rather than written by ApproveComment itself, because
// whether the row is listed in the reader's inbox is the reader's own
// preference, and the console's connection cannot see it: the preferences are
// isolated to the reader they belong to.
const EventTypeCommentApprovedNotification = "comment_approved_notification"

// NotificationTypeCommentApproved is the notifications.notification_type a
// reader's own comment raises when staff approve it. The storefront assembles
// its copy from it plus the payload; there is no title or body column.
//
// It reaches the bell and the mail. It is not on the push allowlist, so a
// device never receives it: a comment going live is something the reader
// learns the next time they open the inbox or their mail, not an interruption.
//
// A removal raises nothing. A removed comment keeps showing to its author
// exactly as they posted it, so that someone posting to disrupt a comment
// section has no signal to post again, and a notification would be that signal.
const NotificationTypeCommentApproved = "comment_approved"

// CommentAuthorSubjectKey is the identity one comment's reader notifications
// share. A second approval of the same comment is a no-op rather than a second
// row, which is what a retried RPC looks like.
func CommentAuthorSubjectKey(commentPublicID string) string {
	return "comment:" + commentPublicID
}

// CommentApprovedNotificationIdempotencyKey is the outbox key for one
// comment's event. A comment is approved once, and a retried approval is
// refused before it queues anything, so the key only has to keep two tenants
// apart.
func CommentApprovedNotificationIdempotencyKey(tenantID uuid.UUID, commentPublicID string) string {
	return EventTypeCommentApprovedNotification + ":" + tenantID.String() + ":" + commentPublicID
}

// CommentApprovedNotification is what ApproveComment queues for the comment's
// author, and the JSON body of the event. The catalog fields are read when the
// comment is approved, so the inbox names the episode as it was then.
type CommentApprovedNotification struct {
	TenantID        uuid.UUID `json:"tenant_id"`
	UserID          uuid.UUID `json:"user_id"`
	CommentPublicID string    `json:"comment_id"`
	EpisodePublicID string    `json:"episode_id,omitempty"`
	EpisodeTitle    string    `json:"episode_title,omitempty"`
	SeriesPublicID  string    `json:"series_id,omitempty"`
	SeriesTitle     string    `json:"series_title,omitempty"`
}

func (n CommentApprovedNotification) validate() error {
	if n.CommentPublicID == "" {
		return errors.New("comment author notification names no comment")
	}
	if n.UserID == uuid.Nil {
		return errors.New("comment author notification names no author")
	}
	if n.TenantID == uuid.Nil {
		return errors.New("comment author notification names no tenant")
	}
	return nil
}

// commentApprovedQueuer is the insert [QueueCommentApprovedNotification] runs.
type commentApprovedQueuer interface {
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

// QueueCommentApprovedNotification records, on the querier of the approval,
// the event that tells the author their comment was approved, so a rollback of
// the approval takes the notification with it.
func QueueCommentApprovedNotification(ctx context.Context, q commentApprovedQueuer, n CommentApprovedNotification) error {
	if err := n.validate(); err != nil {
		return err
	}
	payload, err := json.Marshal(n)
	if err != nil {
		return fmt.Errorf("encode comment approved notification payload: %w", err)
	}
	eventID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("allocate outbox event id: %w", err)
	}
	_, err = q.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             eventID,
		TenantID:       uuid.NullUUID{UUID: n.TenantID, Valid: true},
		EventType:      EventTypeCommentApprovedNotification,
		Payload:        payload,
		IdempotencyKey: CommentApprovedNotificationIdempotencyKey(n.TenantID, n.CommentPublicID),
		AvailableAt:    time.Now().UTC(),
	})
	// The insert is a no-op when the same key is already queued, and :one then
	// returns no rows.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("queue comment approved notification: %w", err)
	}
	return nil
}

// CommentApprovedNotificationHandlerConfig is what the worker resolves once at
// startup for the comment approved handler.
type CommentApprovedNotificationHandlerConfig struct {
	DB *sql.DB
}

// NewCommentApprovedNotificationHandler writes the bell notification a queued
// approval owes its comment's author.
func NewCommentApprovedNotificationHandler(cfg CommentApprovedNotificationHandlerConfig) Handler {
	if cfg.DB == nil {
		// A plain error rather than a [Permanent] one, because an operator
		// restarting the worker with a database makes the event deliverable.
		return func(context.Context, dbmodels.OutboxEvent) error {
			return errors.New("comment approved notification handler database is not configured")
		}
	}
	return commentApprovedNotificationHandler(dbmodels.New(cfg.DB))
}

func commentApprovedNotificationHandler(queries commentAuthorNotifier) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		var n CommentApprovedNotification
		if err := json.Unmarshal(event.Payload, &n); err != nil {
			return Permanent(fmt.Errorf("decode comment approved notification payload: %w", err))
		}
		if !event.TenantID.Valid || n.TenantID != event.TenantID.UUID {
			return Permanent(errors.New("comment approved notification payload tenant_id does not match the event"))
		}
		if err := n.validate(); err != nil {
			return Permanent(err)
		}
		return notifyCommentApproved(ctx, queries, n)
	}
}

// commentAuthorNotificationBody is what the storefront reads back. The tenant
// and the subject key are how the row found its recipient, and neither says
// anything to the person reading it. A field the producer could not fill is
// left out rather than written as an empty string the inbox would render as a
// blank line.
type commentAuthorNotificationBody struct {
	EpisodeID    string `json:"episode_id,omitempty"`
	EpisodeTitle string `json:"episode_title,omitempty"`
	SeriesID     string `json:"series_id,omitempty"`
	SeriesTitle  string `json:"series_title,omitempty"`
	CommentID    string `json:"comment_id,omitempty"`
}

// commentAuthorNotifier is the inserts the helper runs, named so a test can
// drive the write without a database behind it.
type commentAuthorNotifier interface {
	CreateNotification(ctx context.Context, arg dbmodels.CreateNotificationParams) error
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

// notifyCommentApproved writes one bell notification for the author of a
// comment that was approved, and queues the mail that mirrors it. It does not
// enqueue a push: the type is excluded from the allowlist, and the row in
// `notifications` is the record the bell reads.
func notifyCommentApproved(ctx context.Context, queries commentAuthorNotifier, n CommentApprovedNotification) error {
	if err := n.validate(); err != nil {
		return err
	}
	category, err := NotificationCategoryFor(NotificationTypeCommentApproved)
	if err != nil {
		return err
	}

	body := commentAuthorNotificationBody{
		EpisodeID:    n.EpisodePublicID,
		EpisodeTitle: n.EpisodeTitle,
		SeriesID:     n.SeriesPublicID,
		SeriesTitle:  n.SeriesTitle,
		CommentID:    n.CommentPublicID,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode comment author notification: %w", err)
	}
	notificationID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("allocate notification id: %w", err)
	}
	subjectKey := CommentAuthorSubjectKey(n.CommentPublicID)
	err = queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               notificationID,
		TenantID:         n.TenantID,
		UserID:           n.UserID,
		NotificationType: NotificationTypeCommentApproved,
		SubjectKey:       subjectKey,
		Payload:          payload,
		Category:         category,
	})
	// An author who already has this comment's row, which is what a
	// redelivered event looks like, is a no-op rather than an error.
	if err != nil {
		return fmt.Errorf("insert comment author notification: %w", err)
	}
	return queueNotificationEmail(ctx, queries, n.TenantID, NotificationTypeCommentApproved, subjectKey)
}
