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
// It is drained here rather than written by the RPC itself — CreateEpisode, or
// UpdateEpisodePublishSchedule given a time that has passed — because the
// console's connection cannot see the followers: every follow table is
// isolated to the reader who follows.
const EventTypeEpisodePublishedNotification = "episode_published_notification"

// NotificationTypeEpisodePublished is the notifications.notification_type a
// published episode writes, to its followers and to the tenant's admins alike.
const NotificationTypeEpisodePublished = "episode_published"

// NotificationTypeEpisodePublishFailed is the notification the scheduled
// publication job writes, to the tenant's admins and to the platform's
// operators, for an episode it gave up publishing.
const NotificationTypeEpisodePublishFailed = "episode_publish_failed"

// EpisodePublishedIdempotencyKey is the outbox key for one episode's event.
// The episode id is unique across every tenant, and the key is the same every
// time the console publishes the episode, so one taken down and published
// again is not announced a second time.
func EpisodePublishedIdempotencyKey(episodeID uuid.UUID) string {
	return EventTypeEpisodePublishedNotification + ":" + episodeID.String()
}

// SeriesPublicationIdempotencyKey is the outbox key for the announcement of an
// episode published while its series was not public, queued when the series
// becomes public. It names the series' publication instant beside the episode,
// because the console's own event for the episode may already hold
// [EpisodePublishedIdempotencyKey], drained while no reader could open it, and
// a series taken down and published again before the event drained still owes
// the announcement at its new instant.
func SeriesPublicationIdempotencyKey(episodeID uuid.UUID, seriesPublishedAt time.Time) string {
	return EpisodePublishedIdempotencyKey(episodeID) + ":series:" + seriesPublishedAt.UTC().Format(time.RFC3339Nano)
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
	ListPublishedEpisodeSurfaces(ctx context.Context, arg dbmodels.ListPublishedEpisodeSurfacesParams) ([]string, error)
	ListEpisodeFollowerIDs(ctx context.Context, arg dbmodels.ListEpisodeFollowerIDsParams) ([]uuid.UUID, error)
	ListEpisodeCreatorFollowerIDs(ctx context.Context, arg dbmodels.ListEpisodeCreatorFollowerIDsParams) ([]uuid.UUID, error)
	CreateNotificationsForRecipients(ctx context.Context, arg dbmodels.CreateNotificationsForRecipientsParams) error
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

// NotifyEpisodeFollowers writes one notification per reader who asked to hear
// about this episode — a follower of the episode, of its series, or of a
// creator credited on it — and queues the push and the mail that mirror them. A tenant
// whose readers follow nothing publishes silently, which is the point: a
// follow is the request to be told. So does an episode no reader can open yet,
// because its series is not public or it is shown on no surface: neither
// recipient query answers anybody for it.
//
// The recipients are resolved per category, because the follow that earned a
// row is what its reader's preferences are asked about and a union of the
// follows would no longer say which one it was. A reader who follows the
// episode or its series is filed under followed_episodes, and one who follows
// only a credited creator under followed_creators. Every recipient gets a row,
// whatever their inbox cell says, because the push resolves its devices from
// the rows; the cell decides whether the row is listed.
//
// Each notification is filed for the surfaces the episode is shown on, so one
// shown on the app alone is listed in the app's inbox and pushed to the app,
// and neither listed on the site nor sent as a Web Push.
//
// The publication that runs this records, in its own transaction, the
// announcement an episode of a series that is not public owes, and
// [QueueSeriesPublicationAnnouncements] queues it once the series is public.
// The fan-out leaves that record alone: it drains after the publication, and a
// series published in between has to find the debt where the publication left
// it.
//
// The recipients arrive a page at a time and each page is written in one
// insert as it lands. The notification and the push both key on the episode,
// so a second run over the same episode writes nothing new.
func NotifyEpisodeFollowers(ctx context.Context, q EpisodeFollowerQuerier, publication EpisodePublication, pageSize int32) error {
	filer, ok, err := newEpisodeFollowerFiler(ctx, q, publication, pageSize)
	if err != nil || !ok {
		return err
	}
	var cursor episodeFollowerCursor
	for done := false; !done; {
		if cursor, done, err = filer.filePage(ctx, q, cursor); err != nil {
			return err
		}
	}
	return filer.finish(ctx, q, cursor)
}

// episodeFollowerCursor is how far a walk over an episode's followers has got:
// which recipient query it is on, and the last reader that query filed.
type episodeFollowerCursor struct {
	// Creators is set once every follower of the episode and its series is
	// filed, and the walk is on the followers of its creators.
	Creators bool      `json:"creators,omitempty"`
	UserID   uuid.UUID `json:"user_id"`
	// Notified is set once the walk has filed anybody, which is what the push
	// and the mail are queued for.
	Notified bool `json:"notified,omitempty"`
}

// episodeFollowerFiler files one published episode's notification for its
// followers, a page of them at a time.
type episodeFollowerFiler struct {
	publication  EpisodePublication
	subjectKey   string
	payload      string
	availability sql.NullString
	pageSize     int32
}

// newEpisodeFollowerFiler answers false when the episode is shown on no
// surface: no reader can open it, so neither recipient query would answer
// anybody.
func newEpisodeFollowerFiler(
	ctx context.Context,
	q EpisodeFollowerQuerier,
	publication EpisodePublication,
	pageSize int32,
) (episodeFollowerFiler, bool, error) {
	payload, err := json.Marshal(EpisodePublishedNotificationBody{
		EpisodeID:    publication.EpisodePublicID,
		EpisodeTitle: publication.EpisodeTitle,
		SeriesID:     publication.SeriesPublicID,
		SeriesTitle:  publication.SeriesTitle,
	})
	if err != nil {
		return episodeFollowerFiler{}, false, fmt.Errorf("encode payload: %w", err)
	}
	surfaces, err := q.ListPublishedEpisodeSurfaces(ctx, dbmodels.ListPublishedEpisodeSurfacesParams{
		TenantID:  publication.TenantID,
		EpisodeID: publication.EpisodeID,
	})
	if err != nil {
		return episodeFollowerFiler{}, false, fmt.Errorf("list episode surfaces: %w", err)
	}
	if len(surfaces) == 0 {
		return episodeFollowerFiler{}, false, nil
	}
	return episodeFollowerFiler{
		publication:  publication,
		subjectKey:   EpisodeSubjectKey(publication.EpisodePublicID),
		payload:      string(payload),
		availability: sql.NullString{String: notificationAvailability(surfaces), Valid: true},
		pageSize:     pageSize,
	}, true, nil
}

// filePage files the page of followers past cursor, and answers the cursor
// after it and whether every follower is filed. A page that runs out of the
// followers of the episode and its series goes straight on to those of its
// creators, so a walk ends a call only on a full page or on the last one. The
// nil UUID sorts below every UUID, so the zero cursor starts each recipient
// query at its first reader.
func (f episodeFollowerFiler) filePage(
	ctx context.Context,
	q EpisodeFollowerQuerier,
	cursor episodeFollowerCursor,
) (episodeFollowerCursor, bool, error) {
	for {
		category, followers, err := f.listPage(ctx, q, cursor)
		if err != nil {
			return cursor, false, err
		}
		if len(followers) > 0 {
			if err := f.file(ctx, q, category, followers); err != nil {
				return cursor, false, err
			}
			cursor.Notified = true
		}
		if int32(len(followers)) == f.pageSize {
			cursor.UserID = followers[len(followers)-1]
			return cursor, false, nil
		}
		if cursor.Creators {
			return cursor, true, nil
		}
		cursor = episodeFollowerCursor{Creators: true, Notified: cursor.Notified}
	}
}

func (f episodeFollowerFiler) listPage(
	ctx context.Context,
	q EpisodeFollowerQuerier,
	cursor episodeFollowerCursor,
) (NotificationCategory, []uuid.UUID, error) {
	if !cursor.Creators {
		followers, err := q.ListEpisodeFollowerIDs(ctx, dbmodels.ListEpisodeFollowerIDsParams{
			TenantID:    f.publication.TenantID,
			EpisodeID:   f.publication.EpisodeID,
			AfterUserID: cursor.UserID,
			Limit:       f.pageSize,
		})
		if err != nil {
			return "", nil, fmt.Errorf("list the followers of the episode and its series: %w", err)
		}
		return NotificationCategoryFollowedEpisodes, followers, nil
	}
	followers, err := q.ListEpisodeCreatorFollowerIDs(ctx, dbmodels.ListEpisodeCreatorFollowerIDsParams{
		TenantID:    f.publication.TenantID,
		EpisodeID:   f.publication.EpisodeID,
		AfterUserID: cursor.UserID,
		Limit:       f.pageSize,
	})
	if err != nil {
		return "", nil, fmt.Errorf("list the followers of its creators: %w", err)
	}
	return NotificationCategoryFollowedCreators, followers, nil
}

func (f episodeFollowerFiler) file(
	ctx context.Context,
	q EpisodeFollowerQuerier,
	category NotificationCategory,
	followers []uuid.UUID,
) error {
	filedUnder, err := NotificationCategoryFor(NotificationTypeEpisodePublished, category)
	if err != nil {
		return err
	}
	payloads := make([]string, len(followers))
	for i := range payloads {
		payloads[i] = f.payload
	}
	if err := q.CreateNotificationsForRecipients(ctx, dbmodels.CreateNotificationsForRecipientsParams{
		TenantID:         f.publication.TenantID,
		NotificationType: NotificationTypeEpisodePublished,
		SubjectKey:       f.subjectKey,
		Availability:     f.availability,
		Category:         filedUnder,
		UserIds:          followers,
		Payloads:         payloads,
	}); err != nil {
		return fmt.Errorf("insert %s notifications: %w", category, err)
	}
	return nil
}

// finish queues the push and the mail that mirror the rows, once every
// follower is filed and if anybody was.
func (f episodeFollowerFiler) finish(ctx context.Context, q EpisodeFollowerQuerier, cursor episodeFollowerCursor) error {
	if !cursor.Notified {
		return nil
	}
	if err := enqueueEpisodePublishedPush(ctx, q, f.publication, f.subjectKey); err != nil {
		return err
	}
	return queueNotificationEmail(ctx, q, f.publication.TenantID, NotificationTypeEpisodePublished, f.subjectKey)
}

// SeriesPublicationQuerier is the statements
// [QueueSeriesPublicationAnnouncements] runs.
type SeriesPublicationQuerier interface {
	RedateEpisodesForSeriesPublication(ctx context.Context, arg dbmodels.RedateEpisodesForSeriesPublicationParams) ([]dbmodels.RedateEpisodesForSeriesPublicationRow, error)
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
	ClearEpisodeAnnouncementsOwed(ctx context.Context, arg dbmodels.ClearEpisodeAnnouncementsOwedParams) error
}

// QueueSeriesPublicationAnnouncements is what a series becoming public owes
// the episodes published while it was not: each is dated from the series'
// publication instant, and its announcement is queued as the event the console
// queues for an episode it publishes at once, for the same handler to fan out.
// What they owed is cleared only once every announcement is queued, so a call
// that fails part way leaves them owed and is repeated in full; the events key
// on the series' instant, so a repeat queues nothing twice. It answers how
// many episodes it queued.
//
// It runs on the querier of the write that made the series public, or of the
// apply-series-publications job once a scheduled instant has passed, so the
// new dates reach the caches that write drops. An episode whose followers were
// already told about it owes nothing and is not among them, and a series that
// is not public yet queues nothing.
func QueueSeriesPublicationAnnouncements(ctx context.Context, q SeriesPublicationQuerier, tenantID, seriesID uuid.UUID) (int, error) {
	episodes, err := q.RedateEpisodesForSeriesPublication(ctx, dbmodels.RedateEpisodesForSeriesPublicationParams{
		TenantID: tenantID,
		SeriesID: seriesID,
	})
	if err != nil {
		return 0, fmt.Errorf("redate episodes for series publication: %w", err)
	}
	for _, episode := range episodes {
		payload, err := json.Marshal(EpisodePublishedNotificationPayload{
			TenantID:  tenantID.String(),
			EpisodeID: episode.EpisodeID.String(),
		})
		if err != nil {
			return 0, fmt.Errorf("encode episode published notification payload: %w", err)
		}
		eventID, err := uuid.NewV7()
		if err != nil {
			return 0, fmt.Errorf("allocate outbox event id: %w", err)
		}
		_, err = q.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
			ID:             eventID,
			TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
			EventType:      EventTypeEpisodePublishedNotification,
			Payload:        payload,
			IdempotencyKey: SeriesPublicationIdempotencyKey(episode.EpisodeID, episode.SeriesPublishedAt),
			AvailableAt:    time.Now().UTC(),
		})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("queue announcement of episode %s: %w", episode.EpisodeID, err)
		}
	}
	if len(episodes) == 0 {
		return 0, nil
	}
	episodeIDs := make([]uuid.UUID, 0, len(episodes))
	for _, episode := range episodes {
		episodeIDs = append(episodeIDs, episode.EpisodeID)
	}
	if err := q.ClearEpisodeAnnouncementsOwed(ctx, dbmodels.ClearEpisodeAnnouncementsOwedParams{
		TenantID:   tenantID,
		EpisodeIds: episodeIDs,
	}); err != nil {
		return 0, fmt.Errorf("clear the announcements the episodes owed: %w", err)
	}
	return len(episodes), nil
}

// notificationAvailability is the notifications.availability that shows a
// notification on surfaces, a list naming at least one. 'all' is both the site
// and the app, so a list naming more than one surface is all of them.
func notificationAvailability(surfaces []string) string {
	if len(surfaces) == 1 {
		return surfaces[0]
	}
	return "all"
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
	GetPublishedEpisodeForFollowerNotification(ctx context.Context, arg dbmodels.GetPublishedEpisodeForFollowerNotificationParams) (dbmodels.GetPublishedEpisodeForFollowerNotificationRow, error)
}

// episodeFollowerPageQuerier is the statements one page of the handler's
// fan-out runs, in the transaction that holds the episode: the page, and the
// cursor that records it.
type episodeFollowerPageQuerier interface {
	EpisodeFollowerQuerier
	fanOutProgressRecorder
}

// NewEpisodePublishedNotificationHandler tells the followers of an episode the
// console published at once.
//
// Each page of followers is filed in a transaction of its own that holds the
// episode and records how far the walk has got, and an episode whose followers
// do not fit in one job is filed across as many as it takes: the push and the
// mail are queued with the last page.
func NewEpisodePublishedNotificationHandler(cfg EpisodePublishedNotificationHandlerConfig) Handler {
	if cfg.DB == nil {
		// A plain error rather than a [Permanent] one, because an operator
		// restarting the worker with a database makes the event deliverable.
		return func(context.Context, dbmodels.OutboxEvent) error {
			return errors.New("episode published notification handler database is not configured")
		}
	}
	return episodePublishedNotificationHandler(cfg, dbmodels.New(cfg.DB),
		holdEpisodeOn(cfg.DB, func(q *dbmodels.Queries) episodeFollowerPageQuerier { return q }),
		defaultFanOutPaging)
}

func episodePublishedNotificationHandler(
	cfg EpisodePublishedNotificationHandlerConfig,
	queries episodePublishedNotificationQuerier,
	hold episodeHold[episodeFollowerPageQuerier],
	paging fanOutPaging,
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

		publication := EpisodePublication{
			TenantID:        tenantID,
			EpisodeID:       episode.EpisodeID,
			EpisodePublicID: episode.EpisodePublicID,
			EpisodeTitle:    episode.EpisodeTitle,
			SeriesPublicID:  episode.SeriesPublicID,
			SeriesTitle:     episode.SeriesTitle,
		}
		var cursor episodeFollowerCursor
		if err := parseFanOutCursor(event, &cursor); err != nil {
			return Permanent(err)
		}
		for first := true; ; first = false {
			if !first && !paging.hasRoomForPage(ctx) {
				return ErrResume
			}
			done := false
			held, err := hold(ctx, tenantID, episode.EpisodePublicID, func(q episodeFollowerPageQuerier) error {
				filer, ok, err := newEpisodeFollowerFiler(ctx, q, publication, paging.pageSize)
				if err != nil {
					return err
				}
				if !ok {
					done = true
					return nil
				}
				next, finished, err := filer.filePage(ctx, q, cursor)
				if err != nil {
					return err
				}
				if finished {
					done = true
					return filer.finish(ctx, q, next)
				}
				cursor = next
				return recordFanOutProgress(ctx, q, event, next)
			})
			if err != nil {
				return err
			}
			if !held {
				logEpisodePublished(ctx, cfg.Logger, "episode was deleted; followers are not notified", event,
					"episode_id", episodeID.String())
				return nil
			}
			if done {
				return nil
			}
		}
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
