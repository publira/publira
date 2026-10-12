package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// NotificationTypeCommentApproved is the notifications.notification_type a
// reader's own comment raises when staff approve it. The storefront assembles
// its copy from it plus the payload; there is no title or body column.
//
// It is bell-only. It is not on the push allowlist, so a device never receives
// it: a comment going live is something the reader learns the next time they
// open the inbox, not an interruption.
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

// CommentApprovedNotification is what ApproveComment writes for the comment's
// author.
type CommentApprovedNotification struct {
	TenantID        uuid.UUID
	UserID          uuid.UUID
	CommentPublicID string
	EpisodePublicID string
	EpisodeTitle    string
	SeriesPublicID  string
	SeriesTitle     string
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

// commentAuthorNotifier is the insert the helper runs, named so a test can
// drive the write without a database behind it.
type commentAuthorNotifier interface {
	CreateNotification(ctx context.Context, arg dbmodels.CreateNotificationParams) error
}

// NotifyCommentApproved writes one bell notification for the author of a
// comment that was just approved. It does not enqueue a push: the type is
// excluded from the allowlist, and the row in `notifications` is the record
// the bell reads.
func NotifyCommentApproved(ctx context.Context, queries commentAuthorNotifier, n CommentApprovedNotification) error {
	if n.CommentPublicID == "" {
		return errors.New("comment author notification names no comment")
	}
	if n.UserID == uuid.Nil {
		return errors.New("comment author notification names no author")
	}
	if n.TenantID == uuid.Nil {
		return errors.New("comment author notification names no tenant")
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
	err = queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               notificationID,
		TenantID:         n.TenantID,
		UserID:           n.UserID,
		NotificationType: NotificationTypeCommentApproved,
		SubjectKey:       CommentAuthorSubjectKey(n.CommentPublicID),
		Payload:          payload,
	})
	// An author who already has this comment's row, which is what a retried
	// approval looks like, is a no-op rather than an error.
	if err != nil {
		return fmt.Errorf("insert comment author notification: %w", err)
	}
	return nil
}
