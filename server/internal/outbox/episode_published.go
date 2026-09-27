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

// EventTypeEpisodePublishedNotification tells the readers following an episode
// the console published at once, the way the scheduled publication job tells
// them about one it published.
//
// It is drained here rather than written by CreateEpisode itself because the
// console's connection cannot see the followers: every follow table is
// isolated to the reader who follows.
const EventTypeEpisodePublishedNotification = "episode_published_notification"

// NotificationTypeEpisodePublished is the notifications.notification_type a
// published episode writes, to its followers and to the tenant's admins alike.
const NotificationTypeEpisodePublished = "episode_published"

// DefaultEpisodeFollowerPageSize bounds one recipient query. The fan-out grows
// with the tenant's readership, so it walks the followers a page at a time
// instead of materializing every one of them before the first insert.
const DefaultEpisodeFollowerPageSize = int32(500)

// EpisodePublishedIdempotencyKey is the outbox key for one episode's event.
// The episode id is unique across every tenant, and an episode is published
// from the console at most once, when it is created.
func EpisodePublishedIdempotencyKey(episodeID uuid.UUID) string {
	return EventTypeEpisodePublishedNotification + ":" + episodeID.String()
}

// EpisodePublishedNotificationPayload is the JSON body of the event. What the
// notification says is read when it drains, so it names the episode it is
// about and nothing else.
type EpisodePublishedNotificationPayload struct {
	TenantID  string `json:"tenant_id"`
	EpisodeID string `json:"episode_id"`
}

// EpisodePublishedNotificationBody is what the inbox reads back from an
// episode_published row.
type EpisodePublishedNotificationBody struct {
	EpisodeID    string `json:"episode_id"`
	EpisodeTitle string `json:"episode_title"`
	SeriesID     string `json:"series_id"`
	SeriesTitle  string `json:"series_title"`
}

// EpisodePublication names the episode a follower fan-out is about.
type EpisodePublication struct {
	TenantID        uuid.UUID
	EpisodeID       uuid.UUID
	EpisodePublicID string
	EpisodeTitle    string
	SeriesPublicID  string
	SeriesTitle     string
}

// EpisodeFollowerQuerier is the statements [NotifyEpisodeFollowers] runs.
type EpisodeFollowerQuerier interface {
	ListEpisodeFollowerIDs(ctx context.Context, arg dbmodels.ListEpisodeFollowerIDsParams) ([]uuid.UUID, error)
	CreateNotification(ctx context.Context, arg dbmodels.CreateNotificationParams) error
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

// NotifyEpisodeFollowers writes one notification per reader who asked to hear
// about this episode — a follower of the episode, of its series, or of a
// creator credited on it — and queues the push that mirrors them. A tenant
// whose readers follow nothing publishes silently, which is the point: a
// follow is the request to be told.
//
// The recipients arrive a page at a time and the rows are written as each page
// lands. The notification and the push both key on the episode, so a second
// run over the same episode writes nothing new.
func NotifyEpisodeFollowers(ctx context.Context, q EpisodeFollowerQuerier, publication EpisodePublication, pageSize int32) error {
	payload, err := json.Marshal(EpisodePublishedNotificationBody{
		EpisodeID:    publication.EpisodePublicID,
		EpisodeTitle: publication.EpisodeTitle,
		SeriesID:     publication.SeriesPublicID,
		SeriesTitle:  publication.SeriesTitle,
	})
	if err != nil {
		return fmt.Errorf("encode payload: %w", err)
	}

	subjectKey := "episode:" + publication.EpisodePublicID
	notified := 0
	// The nil UUID sorts below every UUID, so the first page starts there.
	after := uuid.Nil
	for {
		followers, err := q.ListEpisodeFollowerIDs(ctx, dbmodels.ListEpisodeFollowerIDsParams{
			TenantID:    publication.TenantID,
			EpisodeID:   publication.EpisodeID,
			AfterUserID: after,
			Limit:       pageSize,
		})
		if err != nil {
			return fmt.Errorf("list followers: %w", err)
		}
		if len(followers) == 0 {
			break
		}

		for _, followerID := range followers {
			notificationID, err := uuid.NewV7()
			if err != nil {
				return fmt.Errorf("allocate notification id: %w", err)
			}
			err = q.CreateNotification(ctx, dbmodels.CreateNotificationParams{
				ID:               notificationID,
				TenantID:         publication.TenantID,
				UserID:           followerID,
				NotificationType: NotificationTypeEpisodePublished,
				SubjectKey:       subjectKey,
				Payload:          payload,
			})
			if err != nil {
				return fmt.Errorf("insert notification for %s: %w", followerID, err)
			}
		}
		notified += len(followers)
		after = followers[len(followers)-1]
		if int32(len(followers)) < pageSize {
			break
		}
	}
	if notified == 0 {
		return nil
	}
	return enqueueEpisodePublishedPush(ctx, q, publication, subjectKey)
}

// enqueueEpisodePublishedPush schedules the mobile push for the notification
// rows above, on the querier that wrote them. This worker owns the send, so a
// Firebase outage retries here instead of failing the publication.
//
// One row per episode carries every recipient: the handler resolves the
// devices from the notification rows when it drains the event. The idempotency
// key is the notification's own identity, so a re-run over the same episode
// finds the row already there and pushes nothing a second time.
func enqueueEpisodePublishedPush(ctx context.Context, q EpisodeFollowerQuerier, publication EpisodePublication, subjectKey string) error {
	payload, err := json.Marshal(MemberPushNotificationPayload{
		TenantID:         publication.TenantID.String(),
		NotificationType: NotificationTypeEpisodePublished,
		SubjectKey:       subjectKey,
		SeriesID:         publication.SeriesPublicID,
		SeriesTitle:      publication.SeriesTitle,
		EpisodeID:        publication.EpisodePublicID,
		EpisodeTitle:     publication.EpisodeTitle,
	})
	if err != nil {
		return fmt.Errorf("encode member push payload: %w", err)
	}

	eventID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("allocate outbox event id: %w", err)
	}
	_, err = q.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             eventID,
		TenantID:       uuid.NullUUID{UUID: publication.TenantID, Valid: true},
		EventType:      EventTypeMemberPushNotification,
		Payload:        payload,
		IdempotencyKey: fmt.Sprintf("push:%s:%s", NotificationTypeEpisodePublished, subjectKey),
		AvailableAt:    time.Now().UTC(),
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("insert member push outbox event: %w", err)
	}
	return nil
}

// EpisodePublishedNotificationHandlerConfig is what the worker resolves once
// at startup for the episode published handler.
type EpisodePublishedNotificationHandlerConfig struct {
	DB     *sql.DB
	Logger *slog.Logger
}

// episodePublishedNotificationQuerier is the statements the handler runs, named
// so a test can drive the fan-out without a database behind it.
type episodePublishedNotificationQuerier interface {
	EpisodeFollowerQuerier
	GetPublishedEpisodeForFollowerNotification(ctx context.Context, arg dbmodels.GetPublishedEpisodeForFollowerNotificationParams) (dbmodels.GetPublishedEpisodeForFollowerNotificationRow, error)
}

// NewEpisodePublishedNotificationHandler tells the followers of an episode the
// console published at once.
func NewEpisodePublishedNotificationHandler(cfg EpisodePublishedNotificationHandlerConfig) Handler {
	if cfg.DB == nil {
		// A plain error rather than a [Permanent] one, because an operator
		// restarting the worker with a database makes the event deliverable.
		return func(context.Context, dbmodels.OutboxEvent) error {
			return errors.New("episode published notification handler database is not configured")
		}
	}
	return episodePublishedNotificationHandler(cfg, dbmodels.New(cfg.DB), DefaultEpisodeFollowerPageSize)
}

func episodePublishedNotificationHandler(
	cfg EpisodePublishedNotificationHandlerConfig,
	queries episodePublishedNotificationQuerier,
	pageSize int32,
) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		var payload EpisodePublishedNotificationPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode episode published notification payload: %w", err))
		}
		tenantID, err := episodePublishedTenantID(event, payload.TenantID)
		if err != nil {
			return Permanent(err)
		}
		episodeID, err := uuid.Parse(strings.TrimSpace(payload.EpisodeID))
		if err != nil {
			return Permanent(fmt.Errorf("episode published notification payload episode_id is invalid: %w", err))
		}

		episode, err := queries.GetPublishedEpisodeForFollowerNotification(ctx, dbmodels.GetPublishedEpisodeForFollowerNotificationParams{
			TenantID: tenantID,
			ID:       episodeID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			// Deleted or taken back to a draft before the event drained: there
			// is no published episode left to announce, and a retry would find
			// the same.
			logEpisodePublished(ctx, cfg.Logger, "episode is no longer published; followers are not notified", event,
				"episode_id", episodeID.String())
			return nil
		}
		if err != nil {
			return fmt.Errorf("get published episode: %w", err)
		}

		return NotifyEpisodeFollowers(ctx, queries, EpisodePublication{
			TenantID:        tenantID,
			EpisodeID:       episode.EpisodeID,
			EpisodePublicID: episode.EpisodePublicID,
			EpisodeTitle:    episode.EpisodeTitle,
			SeriesPublicID:  episode.SeriesPublicID,
			SeriesTitle:     episode.SeriesTitle,
		}, pageSize)
	}
}

// episodePublishedTenantID takes the tenant from the event row and checks the
// payload agrees.
func episodePublishedTenantID(event dbmodels.OutboxEvent, payloadTenantID string) (uuid.UUID, error) {
	if !event.TenantID.Valid {
		return uuid.Nil, errors.New("episode published notification event carries no tenant")
	}
	parsed, err := uuid.Parse(strings.TrimSpace(payloadTenantID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("episode published notification payload tenant_id is invalid: %w", err)
	}
	if parsed != event.TenantID.UUID {
		return uuid.Nil, errors.New("episode published notification payload tenant_id does not match the event")
	}
	return event.TenantID.UUID, nil
}

func logEpisodePublished(ctx context.Context, logger *slog.Logger, message string, event dbmodels.OutboxEvent, attrs ...any) {
	if logger == nil {
		return
	}
	logger.InfoContext(ctx, message, append([]any{
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
	}, attrs...)...)
}
