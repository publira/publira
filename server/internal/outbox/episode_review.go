package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/tenanttz"
)

// EventTypeEpisodeReviewReturnedNotification tells the member of staff who
// submitted an episode for review that a Tenant admin sent it back, with what
// to fix: a row in the console's bell, and a mail.
//
// It is drained here rather than sent by the RPC that returned the episode, so
// the decision stands whether or not a mail server answers.
const EventTypeEpisodeReviewReturnedNotification = "episode_review_returned_notification"

// NotificationTypeEpisodeReviewReturned is the notifications.notification_type
// of the bell's row.
const NotificationTypeEpisodeReviewReturned = "episode_review_returned"

// EpisodeReviewReturnedNotificationPayload names the decided round and nothing
// else. The worker reloads it, so the notice says what the round says when it
// drains.
type EpisodeReviewReturnedNotificationPayload struct {
	TenantID string `json:"tenant_id"`
	ReviewID string `json:"review_id"`
}

// EpisodeReviewReturnedIdempotencyKey is the outbox key for one round's notice.
// A round is decided once, so its id is the whole identity.
func EpisodeReviewReturnedIdempotencyKey(reviewID uuid.UUID) string {
	return EventTypeEpisodeReviewReturnedNotification + ":" + reviewID.String()
}

// episodeReviewReturnedNotificationBody is what the console reads back from the
// bell's row: the episode, named the way the publication notices name it.
type episodeReviewReturnedNotificationBody struct {
	EpisodeID    string `json:"episode_id,omitempty"`
	EpisodeTitle string `json:"episode_title,omitempty"`
	SeriesID     string `json:"series_id,omitempty"`
	SeriesTitle  string `json:"series_title,omitempty"`
}

// NewEpisodeReviewReturnedNotificationHandler files the bell's row for the
// submitter, then mails them. The row is written first and written once per
// round, so a mail that fails and is retried finds it already there.
func NewEpisodeReviewReturnedNotificationHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("episode review returned notification"); err != nil {
			return err
		}
		tenantID, reviewID, err := episodeReviewReturnedIDs(event)
		if err != nil {
			return Permanent(err)
		}

		tenant, err := queries.GetTenantByID(ctx, tenantID)
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("episode review tenant %s no longer exists", tenantID))
		}
		if err != nil {
			return fmt.Errorf("load episode review tenant: %w", err)
		}
		notice, err := queries.GetReturnedEpisodeReviewNotice(ctx, dbmodels.GetReturnedEpisodeReviewNoticeParams{
			TenantID: tenantID,
			ID:       reviewID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			// The episode was deleted since, and its rounds with it.
			logEpisodeReview(ctx, cfg, event, "returned episode review no longer exists")
			return nil
		}
		if err != nil {
			return fmt.Errorf("load returned episode review: %w", err)
		}
		if !notice.RecipientUserID.Valid {
			logEpisodeReview(ctx, cfg, event, "no staff member to tell about a returned episode")
			return nil
		}

		// Before the SMTP settings, which fail retriably, for the reason the
		// contact message mail gives.
		tenantLocale, err := locale.Resolve(tenant.DefaultLocale)
		if err != nil {
			return Permanent(fmt.Errorf("resolve default locale of tenant %s: %w", tenantID, err))
		}

		held, err := HoldEpisode(ctx, cfg.DB, tenantID, notice.EpisodePublicID, func(q *dbmodels.Queries) error {
			return fileEpisodeReviewReturnedNotification(ctx, q, tenantID, reviewID, notice)
		})
		if err != nil {
			return err
		}
		if !held {
			logEpisodeReview(ctx, cfg, event, "returned episode review no longer exists")
			return nil
		}

		episodeURL, err := tenantAdminConsolePageURL(tenant, "/series/"+notice.SeriesPublicID+"/episodes/"+notice.EpisodePublicID)
		if err != nil {
			return err
		}
		settings, err := resolveSMTPSettings(ctx, queries, tenant, cfg.Encryptor)
		if err != nil {
			return fmt.Errorf("resolve smtp settings: %w", err)
		}
		tenantName := strings.TrimSpace(tenant.Name)
		if tenantName == "" {
			tenantName = "Publira"
		}
		return deliverEmail(ctx, cfg, settings, notice.RecipientEmail.String, emailrenderer.Request{
			Template: "staff_episode_review_returned",
			Locale:   tenantLocale,
			Data: map[string]any{
				"comment":       notice.Comment.String,
				"episode_title": notice.EpisodeTitle,
				"episode_url":   episodeURL,
				"series_title":  notice.SeriesTitle,
				"tenant_name":   tenantName,
			},
			TimeZone: tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries)),
		})
	}
}

// fileEpisodeReviewReturnedNotification writes the bell's row. Its subject is
// the round, so a submitter whose episode is sent back twice has a row for each
// return.
func fileEpisodeReviewReturnedNotification(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	reviewID uuid.UUID,
	notice dbmodels.GetReturnedEpisodeReviewNoticeRow,
) error {
	body, err := json.Marshal(episodeReviewReturnedNotificationBody{
		EpisodeID:    notice.EpisodePublicID,
		EpisodeTitle: notice.EpisodeTitle,
		SeriesID:     notice.SeriesPublicID,
		SeriesTitle:  notice.SeriesTitle,
	})
	if err != nil {
		return Permanent(fmt.Errorf("encode episode review returned notification body: %w", err))
	}
	category, err := NotificationCategoryFor(NotificationTypeEpisodeReviewReturned)
	if err != nil {
		return Permanent(err)
	}
	notificationID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("allocate notification id: %w", err)
	}
	if err := queries.CreateStaffNotification(ctx, dbmodels.CreateStaffNotificationParams{
		ID:               notificationID,
		TenantID:         tenantID,
		UserID:           notice.RecipientUserID.UUID,
		NotificationType: NotificationTypeEpisodeReviewReturned,
		SubjectKey:       EpisodeReviewSubjectKey(reviewID),
		Payload:          body,
		Category:         category,
	}); err != nil {
		return fmt.Errorf("insert episode review returned notification: %w", err)
	}
	return nil
}

// episodeReviewReturnedIDs takes the tenant from the event row and checks the
// payload agrees, as the other staff notices do.
func episodeReviewReturnedIDs(event dbmodels.OutboxEvent) (uuid.UUID, uuid.UUID, error) {
	var payload EpisodeReviewReturnedNotificationPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("decode episode review returned payload: %w", err)
	}
	tenantID, err := uuid.Parse(strings.TrimSpace(payload.TenantID))
	if err != nil || !event.TenantID.Valid || tenantID != event.TenantID.UUID {
		return uuid.Nil, uuid.Nil, errors.New("episode review returned payload has an invalid tenant_id")
	}
	reviewID, err := uuid.Parse(strings.TrimSpace(payload.ReviewID))
	if err != nil {
		return uuid.Nil, uuid.Nil, errors.New("episode review returned payload has an invalid review_id")
	}
	return tenantID, reviewID, nil
}

func logEpisodeReview(ctx context.Context, cfg EmailHandlerConfig, event dbmodels.OutboxEvent, message string) {
	if cfg.Logger == nil {
		return
	}
	cfg.Logger.InfoContext(ctx, message,
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
	)
}
