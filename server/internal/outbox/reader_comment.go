package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// The notifications.notification_type values a reader's own comment raises
// when staff, or the report threshold, decide it. The storefront assembles
// its copy from these plus the payload; there is no title or body column.
//
// Both are bell-only. They are not on the push allowlist, so a device never
// receives them: a comment going live or disappearing is something the reader
// learns the next time they open the inbox, not an interruption.
const (
	NotificationTypeCommentApproved = "comment_approved"
	NotificationTypeCommentHidden   = "comment_hidden"
)

// The hidden_reason values [NotificationTypeCommentHidden] carries. They are
// the same categories episode_comments.hidden_reason stores.
const (
	CommentHiddenReasonStaff       = "staff"
	CommentHiddenReasonAutoReports = "auto_reports"
)

// CommentAuthorSubjectKey is the identity one comment's reader notifications
// share. A second approval or removal of the same comment is a no-op rather
// than a second row, which is what a retried RPC looks like.
func CommentAuthorSubjectKey(commentPublicID string) string {
	return "comment:" + commentPublicID
}

// CommentAuthorNotification is what ApproveComment, HideComment, and the
// automatic report threshold write for the comment's author.
type CommentAuthorNotification struct {
	TenantID         uuid.UUID
	UserID           uuid.UUID
	NotificationType string
	CommentPublicID  string
	EpisodePublicID  string
	EpisodeTitle     string
	SeriesPublicID   string
	SeriesTitle      string
	// HiddenReason is the category the payload carries for comment_hidden:
	// [CommentHiddenReasonStaff] for a moderator, [CommentHiddenReasonAutoReports]
	// for the threshold. Unused for comment_approved.
	HiddenReason string
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
	HiddenReason string `json:"hidden_reason,omitempty"`
}

// commentAuthorNotifier is the insert the helper runs, named so a test can
// drive the write without a database behind it.
type commentAuthorNotifier interface {
	CreateNotification(ctx context.Context, arg dbmodels.CreateNotificationParams) (dbmodels.Notification, error)
}

// NotifyCommentAuthor writes one bell notification for the author of a comment
// that was just approved or hidden. It does not enqueue a push: these types
// are excluded from the allowlist, and the row in `notifications` is the
// record the bell reads.
func NotifyCommentAuthor(ctx context.Context, queries commentAuthorNotifier, n CommentAuthorNotification) error {
	if n.CommentPublicID == "" {
		return errors.New("comment author notification names no comment")
	}
	if n.UserID == uuid.Nil {
		return errors.New("comment author notification names no author")
	}
	if n.TenantID == uuid.Nil {
		return errors.New("comment author notification names no tenant")
	}
	switch n.NotificationType {
	case NotificationTypeCommentApproved:
		if n.HiddenReason != "" {
			return errors.New("comment_approved notification carries a hidden_reason")
		}
	case NotificationTypeCommentHidden:
		if n.HiddenReason == "" {
			return errors.New("comment_hidden notification names no reason")
		}
	default:
		return fmt.Errorf("comment author notification type %q is not a reader comment type", n.NotificationType)
	}

	body := commentAuthorNotificationBody{
		EpisodeID:    n.EpisodePublicID,
		EpisodeTitle: n.EpisodeTitle,
		SeriesID:     n.SeriesPublicID,
		SeriesTitle:  n.SeriesTitle,
		CommentID:    n.CommentPublicID,
	}
	if n.NotificationType == NotificationTypeCommentHidden {
		body.HiddenReason = n.HiddenReason
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode comment author notification: %w", err)
	}
	notificationID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("allocate notification id: %w", err)
	}
	_, err = queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               notificationID,
		TenantID:         n.TenantID,
		UserID:           n.UserID,
		NotificationType: n.NotificationType,
		SubjectKey:       CommentAuthorSubjectKey(n.CommentPublicID),
		Payload:          payload,
	})
	// No rows means this author already has this comment's row, which is what
	// a retried approval or hide looks like.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("insert comment author notification: %w", err)
	}
	return nil
}
