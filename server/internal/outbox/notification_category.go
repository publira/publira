package outbox

import "fmt"

// NotificationCategory is the notifications.category a row is filed under:
// which of its recipient's notification preferences decides whether it is
// listed in their inbox and pushed to their devices.
type NotificationCategory string

const (
	// NotificationCategoryFollowedEpisodes is an episode the reader follows,
	// or one of a series they follow.
	NotificationCategoryFollowedEpisodes NotificationCategory = "followed_episodes"
	// NotificationCategoryFollowedCreators is an episode credited to a creator
	// the reader follows, when they follow neither it nor its series.
	NotificationCategoryFollowedCreators NotificationCategory = "followed_creators"
	// NotificationCategoryComments is the reader's own comment.
	NotificationCategoryComments NotificationCategory = "comments"
	// NotificationCategoryAnnouncements is an announcement the tenant posted.
	NotificationCategoryAnnouncements NotificationCategory = "announcements"
	// NotificationCategoryStaff is a row addressed to the tenant's staff for
	// being staff. No preference governs it.
	NotificationCategoryStaff NotificationCategory = "staff"
)

// notificationCategories names, for every notification_type a row is filed
// under, the categories it may take, the first being the one it takes unless
// its writer knows better. An episode_published row has three: the follow
// that earned it decides between the first two, the more direct one first,
// and the copy the tenant's staff get for every publication is theirs.
//
// TestEveryNotificationTypeHasACategory fails on a NotificationType constant
// this table does not name.
var notificationCategories = map[string][]NotificationCategory{
	NotificationTypeEpisodePublished: {
		NotificationCategoryFollowedEpisodes,
		NotificationCategoryFollowedCreators,
		NotificationCategoryStaff,
	},
	NotificationTypeEpisodePublishFailed:    {NotificationCategoryStaff},
	NotificationTypeCommentApproved:         {NotificationCategoryComments},
	NotificationTypeAnnouncementPosted:      {NotificationCategoryAnnouncements},
	NotificationTypeCommentAwaitingApproval: {NotificationCategoryStaff},
	NotificationTypeCommentReported:         {NotificationCategoryStaff},
}

// NotificationCategoryFor answers the category a row of notificationType is
// filed under: earned when its writer names one, else the type's own. A type
// the table does not name, or a category the table does not allow it, is a
// fault in the writer rather than in what it was told to file.
func NotificationCategoryFor(notificationType string, earned ...NotificationCategory) (string, error) {
	allowed, ok := notificationCategories[notificationType]
	if !ok {
		return "", fmt.Errorf("notification type %q has no category", notificationType)
	}
	if len(earned) == 0 {
		return string(allowed[0]), nil
	}
	for _, category := range allowed {
		if category == earned[0] {
			return string(category), nil
		}
	}
	return "", fmt.Errorf("notification type %q is not filed under %q", notificationType, earned[0])
}
