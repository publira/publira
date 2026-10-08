package main

import (
	"log/slog"
	"slices"
	"testing"

	"github.com/publira/publira/server/internal/outbox"
)

// The worker drops an event registered as a message while its tenant is
// suspended, and runs every other one. Moving a type between the two lists is
// a decision about what a suspended tenant's readers and staff receive, so it
// is pinned here rather than left to the order of the registrations.
func TestWorkerDropsOnlyMessagesForASuspendedTenant(t *testing.T) {
	cfg := workerConfig(slog.Default(), nil,
		outbox.EmailHandlerConfig{}, outbox.PushHandlerConfig{}, outbox.StaffNotificationHandlerConfig{},
		outbox.AnnouncementNotificationHandlerConfig{}, outbox.EpisodePublishedNotificationHandlerConfig{},
		outbox.GooglePlayHandlerConfig{}, outbox.AppleSignInHandlerConfig{},
		nil, nil, nil)

	messages := []string{
		outbox.EventTypeReaderEmailVerificationEmail,
		outbox.EventTypeReaderEmailChangeConfirmationEmail,
		outbox.EventTypeReaderEmailChangedNoticeEmail,
		outbox.EventTypeReaderPasswordResetEmail,
		outbox.EventTypeReaderPasswordChangedNoticeEmail,
		outbox.EventTypeReaderSignupAttemptNoticeEmail,
		outbox.EventTypeAdminPasswordResetEmail,
		outbox.EventTypeAdminEmailChangeConfirmationEmail,
		outbox.EventTypeAdminEmailChangedNoticeEmail,
		outbox.EventTypeContactMessageStaffEmail,
		outbox.EventTypeContactMessageReplyEmail,
		outbox.EventTypeCommentAwaitingApprovalNotification,
		outbox.EventTypeCommentReportedNotification,
		outbox.EventTypeAnnouncementNotification,
		outbox.EventTypeEpisodePublishedNotification,
		outbox.EventTypeMemberPushNotification,
	}
	others := []string{
		outbox.EventTypeTenantAdminInvitationEmail,
		outbox.EventTypeReaderSignupRequest,
		outbox.EventTypeReaderPasswordResetRequest,
		outbox.EventTypeReaderEmailVerificationRequest,
		outbox.EventTypeAdminPasswordResetRequest,
		outbox.EventTypePlatformPasswordResetEmail,
		outbox.EventTypePlatformPasswordResetRequest,
		outbox.EventTypePlatformEmailChangeConfirmationEmail,
		outbox.EventTypePlatformEmailChangedNoticeEmail,
		outbox.EventTypeNextCacheRevalidation,
		outbox.EventTypeCatalogIndexSync,
		outbox.EventTypeGooglePlayPurchaseConsume,
		outbox.EventTypeAppleSignInCodeExchange,
		outbox.EventTypeAppleSignInTokenRevoke,
	}

	for _, eventType := range slices.Concat(messages, others) {
		if _, ok := cfg.Handlers.Lookup(eventType); !ok {
			t.Errorf("%s has no handler", eventType)
		}
	}
	for _, eventType := range messages {
		if !cfg.Handlers.IsMessage(eventType) {
			t.Errorf("%s runs for a suspended tenant, want it dropped", eventType)
		}
	}
	for _, eventType := range others {
		if cfg.Handlers.IsMessage(eventType) {
			t.Errorf("%s is dropped for a suspended tenant, want it run", eventType)
		}
	}
}
