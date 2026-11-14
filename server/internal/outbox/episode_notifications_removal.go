package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// EventTypeEpisodeNotificationsRemoval removes the notifications about an
// episode that was deleted, from every reader's inbox and every member of
// staff's bell.
//
// It is drained here rather than deleted by DeleteEpisode itself, because a
// notification is visible only to its recipient's own connection: the console's
// tenant-scoped connection reaches none of them, and the worker's reaches them
// all. The mail and the push still owed for those rows go with them, since both
// find their recipients through the rows.
const EventTypeEpisodeNotificationsRemoval = "episode_notifications_removal"

// notificationRemovalBatchSize is how many rows one statement deletes.
const notificationRemovalBatchSize = 1000

// EpisodeSubjectKey is the identity of the notices about one episode's
// publication: the readers following it are told it was published, and the
// staff that its scheduled publication failed.
func EpisodeSubjectKey(episodePublicID string) string {
	return "episode:" + episodePublicID
}

// EpisodeReviewSubjectKey is the identity of the notice that one review round
// was sent back.
func EpisodeReviewSubjectKey(reviewID uuid.UUID) string {
	return "episode_review:" + reviewID.String()
}

// EpisodeNotificationsRemoval names what the deleted episode's notifications
// are filed under, and is the JSON body of the event. The comments and the
// review rounds are deleted with the episode, so the deletion reads them before
// they go.
type EpisodeNotificationsRemoval struct {
	TenantID         uuid.UUID   `json:"tenant_id"`
	EpisodePublicID  string      `json:"episode_id"`
	CommentPublicIDs []string    `json:"comment_ids"`
	ReviewIDs        []uuid.UUID `json:"review_ids"`
}

func (r EpisodeNotificationsRemoval) validate() error {
	if r.TenantID == uuid.Nil {
		return errors.New("episode notifications removal names no tenant")
	}
	if strings.TrimSpace(r.EpisodePublicID) == "" {
		return errors.New("episode notifications removal names no episode")
	}
	return nil
}

// EpisodeNotificationsRemovalIdempotencyKey is the outbox key for one deleted
// episode's event. An episode is deleted once, so the tenant and the episode
// are the whole identity.
func EpisodeNotificationsRemovalIdempotencyKey(tenantID uuid.UUID, episodePublicID string) string {
	return EventTypeEpisodeNotificationsRemoval + ":" + tenantID.String() + ":" + episodePublicID
}

// episodeNotificationsRemovalQueuer is the insert
// [QueueEpisodeNotificationsRemoval] runs.
type episodeNotificationsRemovalQueuer interface {
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

// QueueEpisodeNotificationsRemoval records, on the querier of the deletion,
// the event that removes the episode's notifications, so a deletion that rolls
// back removes nothing.
func QueueEpisodeNotificationsRemoval(ctx context.Context, q episodeNotificationsRemovalQueuer, r EpisodeNotificationsRemoval) error {
	if err := r.validate(); err != nil {
		return err
	}
	payload, err := json.Marshal(r)
	if err != nil {
		return fmt.Errorf("encode episode notifications removal payload: %w", err)
	}
	eventID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("allocate outbox event id: %w", err)
	}
	_, err = q.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             eventID,
		TenantID:       uuid.NullUUID{UUID: r.TenantID, Valid: true},
		EventType:      EventTypeEpisodeNotificationsRemoval,
		Payload:        payload,
		IdempotencyKey: EpisodeNotificationsRemovalIdempotencyKey(r.TenantID, r.EpisodePublicID),
		AvailableAt:    time.Now().UTC(),
	})
	// The insert is a no-op when the same key is already queued, and :one then
	// returns no rows.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("queue episode notifications removal: %w", err)
	}
	return nil
}

// NotificationRemovalHandlerConfig is what the worker resolves once at startup
// for the notification removal handler.
type NotificationRemovalHandlerConfig struct {
	DB *sql.DB
}

// notificationRemover is the deletes the handler runs, named so a test can
// drive it without a database behind it.
type notificationRemover interface {
	DeleteNotificationsBySubjects(ctx context.Context, arg dbmodels.DeleteNotificationsBySubjectsParams) (int64, error)
	DeleteNotificationsBySubjectPrefix(ctx context.Context, arg dbmodels.DeleteNotificationsBySubjectPrefixParams) (int64, error)
}

// NewEpisodeNotificationsRemovalHandler deletes every notification filed under
// the deleted episode, its comments, or its review rounds.
//
// Deleting what is already gone deletes nothing, so a redelivered event
// completes as the first one did.
func NewEpisodeNotificationsRemovalHandler(cfg NotificationRemovalHandlerConfig) Handler {
	if cfg.DB == nil {
		// A plain error rather than a [Permanent] one, because an operator
		// restarting the worker with a database makes the event deliverable.
		return func(context.Context, dbmodels.OutboxEvent) error {
			return errors.New("episode notifications removal handler database is not configured")
		}
	}
	return episodeNotificationsRemovalHandler(dbmodels.New(cfg.DB), notificationRemovalBatchSize)
}

func episodeNotificationsRemovalHandler(queries notificationRemover, batchSize int32) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		var r EpisodeNotificationsRemoval
		if err := json.Unmarshal(event.Payload, &r); err != nil {
			return Permanent(fmt.Errorf("decode episode notifications removal payload: %w", err))
		}
		if !event.TenantID.Valid || r.TenantID != event.TenantID.UUID {
			return Permanent(errors.New("episode notifications removal payload tenant_id does not match the event"))
		}
		if err := r.validate(); err != nil {
			return Permanent(err)
		}

		commentKeys := make([]string, 0, len(r.CommentPublicIDs))
		for _, id := range r.CommentPublicIDs {
			commentKeys = append(commentKeys, CommentAuthorSubjectKey(id))
		}
		reviewKeys := make([]string, 0, len(r.ReviewIDs))
		for _, id := range r.ReviewIDs {
			reviewKeys = append(reviewKeys, EpisodeReviewSubjectKey(id))
		}
		bySubject := []struct {
			types []string
			keys  []string
		}{
			{[]string{NotificationTypeEpisodePublished, NotificationTypeEpisodePublishFailed}, []string{EpisodeSubjectKey(r.EpisodePublicID)}},
			{[]string{NotificationTypeCommentApproved}, commentKeys},
			{[]string{NotificationTypeEpisodeReviewReturned}, reviewKeys},
		}
		for _, group := range bySubject {
			if len(group.keys) == 0 {
				continue
			}
			if err := deleteInBatches(batchSize, func() (int64, error) {
				return queries.DeleteNotificationsBySubjects(ctx, dbmodels.DeleteNotificationsBySubjectsParams{
					TenantID:          r.TenantID,
					NotificationTypes: group.types,
					SubjectKeys:       group.keys,
					BatchSize:         batchSize,
				})
			}); err != nil {
				return fmt.Errorf("delete %s notifications: %w", strings.Join(group.types, ", "), err)
			}
		}
		if err := deleteInBatches(batchSize, func() (int64, error) {
			return queries.DeleteNotificationsBySubjectPrefix(ctx, dbmodels.DeleteNotificationsBySubjectPrefixParams{
				TenantID:          r.TenantID,
				NotificationTypes: []string{NotificationTypeCommentAwaitingApproval, NotificationTypeCommentReported},
				SubjectKeyPrefix:  staffCommentSubjectKeyPrefix(r.EpisodePublicID),
				BatchSize:         batchSize,
			})
		}); err != nil {
			return fmt.Errorf("delete staff comment notifications: %w", err)
		}
		return nil
	}
}

// deleteInBatches runs a batched delete until one deletes less than a whole
// batch.
func deleteInBatches(batchSize int32, deleteBatch func() (int64, error)) error {
	for {
		deleted, err := deleteBatch()
		if err != nil {
			return err
		}
		if deleted < int64(batchSize) {
			return nil
		}
	}
}

// episodeExistenceChecker is the read [episodeDeletedSince] runs.
type episodeExistenceChecker interface {
	EpisodeExistsByPublicID(ctx context.Context, arg dbmodels.EpisodeExistsByPublicIDParams) (bool, error)
}

// episodeDeletedSince reports whether the episode an event about it was queued
// for has been deleted since. A handler that would file a notification about
// it files none then: the deletion queued the removal of the episode's
// notifications, which may already have run, and a row filed after it would
// link to a page that is no longer there. An event that names no episode is
// filed as it always was.
func episodeDeletedSince(ctx context.Context, queries episodeExistenceChecker, tenantID uuid.UUID, episodePublicID string) (bool, error) {
	episodePublicID = strings.TrimSpace(episodePublicID)
	if episodePublicID == "" {
		return false, nil
	}
	exists, err := queries.EpisodeExistsByPublicID(ctx, dbmodels.EpisodeExistsByPublicIDParams{
		TenantID: tenantID,
		PublicID: episodePublicID,
	})
	if err != nil {
		return false, fmt.Errorf("check the episode still exists: %w", err)
	}
	return !exists, nil
}
