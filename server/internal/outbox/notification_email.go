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
	"github.com/publira/publira/server/internal/emailrenderer"
)

// EventTypeNotificationEmail mails one reader notification to each of its
// recipients whose email cell for the row's category is on.
//
// Like a push, a mail never exists without its `notifications` row: the fan-out
// that writes the rows queues this event beside them, on the same querier, and
// the recipients are resolved from the rows when it drains. One event per
// notification, not per reader, for the same reason the push has one.
const EventTypeNotificationEmail = "notification_email"

// notificationSettingsPath is the storefront page a reader changes which
// notifications reach them on, linked from every notification mail.
const notificationSettingsPath = "/settings/notifications"

// announcementsPath is where a mailed announcement takes the reader: the inbox,
// as the bell's row does, because the row names no announcement of its own.
const announcementsPath = "/announcements"

// NotificationEmailPayload names the notification whose rows the mail goes to.
type NotificationEmailPayload struct {
	TenantID         string `json:"tenant_id"`
	NotificationType string `json:"notification_type"`
	SubjectKey       string `json:"subject_key"`
}

// NotificationEmailIdempotencyKey is the outbox key for one notification's
// mail. It is the notification's own identity, so a fan-out that runs again
// over the same subject queues no second mail. The tenant is part of it
// because a subject key is unique only within its tenant.
func NotificationEmailIdempotencyKey(tenantID uuid.UUID, notificationType, subjectKey string) string {
	return EventTypeNotificationEmail + ":" + tenantID.String() + ":" + notificationType + ":" + subjectKey
}

// notificationEmailQueuer is the insert [queueNotificationEmail] runs.
type notificationEmailQueuer interface {
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

// queueNotificationEmail schedules the mail for the notification rows a
// fan-out wrote, on the querier that wrote them.
func queueNotificationEmail(ctx context.Context, q notificationEmailQueuer, tenantID uuid.UUID, notificationType, subjectKey string) error {
	payload, err := json.Marshal(NotificationEmailPayload{
		TenantID:         tenantID.String(),
		NotificationType: notificationType,
		SubjectKey:       subjectKey,
	})
	if err != nil {
		return fmt.Errorf("encode notification email payload: %w", err)
	}
	eventID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("allocate outbox event id: %w", err)
	}
	_, err = q.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             eventID,
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      EventTypeNotificationEmail,
		Payload:        payload,
		IdempotencyKey: NotificationEmailIdempotencyKey(tenantID, notificationType, subjectKey),
		AvailableAt:    time.Now().UTC(),
	})
	// The insert is a no-op when the same key is already queued, and :one then
	// returns no rows.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("queue notification email: %w", err)
	}
	return nil
}

// notificationEmailLinks are the storefront links every notification mail
// carries: the one its button opens, and the reader's notification settings.
type notificationEmailLinks struct {
	tenant   dbmodels.Tenant
	settings string
}

func (l notificationEmailLinks) site(path string) (string, error) {
	link, err := tenantSiteURL(l.tenant, path)
	if err != nil {
		return "", fmt.Errorf("build %s url: %w", path, err)
	}
	return link, nil
}

// notificationEmailTemplates words the mail of each notification type that is
// mailed, from the row's payload. A type missing here is never mailed, the way
// a type missing from the push allowlist is never pushed.
var notificationEmailTemplates = map[string]func(row dbmodels.ListNotificationEmailRecipientsRow, links notificationEmailLinks) (string, map[string]any, error){
	NotificationTypeEpisodePublished:   episodePublishedEmail,
	NotificationTypeAnnouncementPosted: announcementPostedEmail,
	NotificationTypeCommentApproved:    commentApprovedEmail,
}

func episodePublishedEmail(row dbmodels.ListNotificationEmailRecipientsRow, links notificationEmailLinks) (string, map[string]any, error) {
	var body EpisodePublishedNotificationBody
	if err := json.Unmarshal(row.Payload, &body); err != nil {
		return "", nil, Permanent(fmt.Errorf("decode episode published notification: %w", err))
	}
	episodeURL, err := links.site(episodePath(body.SeriesID, body.EpisodeID))
	if err != nil {
		return "", nil, err
	}
	return "reader_episode_published", map[string]any{
		"episode_title": body.EpisodeTitle,
		"episode_url":   episodeURL,
		"series_title":  body.SeriesTitle,
		"settings_url":  links.settings,
	}, nil
}

// announcementPostedEmail says when the announcement was sent to every reader,
// and links no settings then, because they could not have kept it out.
func announcementPostedEmail(row dbmodels.ListNotificationEmailRecipientsRow, links notificationEmailLinks) (string, map[string]any, error) {
	var body announcementNotificationBody
	if err := json.Unmarshal(row.Payload, &body); err != nil {
		return "", nil, Permanent(fmt.Errorf("decode announcement notification: %w", err))
	}
	announcementsURL, err := links.site(announcementsPath)
	if err != nil {
		return "", nil, err
	}
	everyone := row.Category == string(NotificationCategoryEveryone)
	data := map[string]any{
		"announcement_title": body.AnnouncementTitle,
		"announcements_url":  announcementsURL,
		"sent_to_everyone":   everyone,
	}
	if !everyone {
		data["settings_url"] = links.settings
	}
	return "reader_announcement_posted", data, nil
}

func commentApprovedEmail(row dbmodels.ListNotificationEmailRecipientsRow, links notificationEmailLinks) (string, map[string]any, error) {
	var body commentAuthorNotificationBody
	if err := json.Unmarshal(row.Payload, &body); err != nil {
		return "", nil, Permanent(fmt.Errorf("decode comment approved notification: %w", err))
	}
	episodeURL, err := links.site(episodePath(body.SeriesID, body.EpisodeID))
	if err != nil {
		return "", nil, err
	}
	return "reader_comment_approved", map[string]any{
		"episode_title": body.EpisodeTitle,
		"episode_url":   episodeURL,
		"series_title":  body.SeriesTitle,
		"settings_url":  links.settings,
	}, nil
}

// episodePath is the viewer of one episode, where the bell's row for it links.
func episodePath(seriesPublicID, episodePublicID string) string {
	return "/series/" + seriesPublicID + "/episodes/" + episodePublicID
}

// notificationEmailQuerier is the statements the handler runs, named so a test
// can drive the send loop without a database behind it.
type notificationEmailQuerier interface {
	ListNotificationEmailRecipients(ctx context.Context, arg dbmodels.ListNotificationEmailRecipientsParams) ([]dbmodels.ListNotificationEmailRecipientsRow, error)
	MarkNotificationEmailed(ctx context.Context, arg dbmodels.MarkNotificationEmailedParams) error
	RecordOutboxEventProgress(ctx context.Context, arg dbmodels.RecordOutboxEventProgressParams) (int64, error)
}

// notificationEmailPaging is how the handler walks a notification's recipients
// within the time one outbox job is given.
type notificationEmailPaging struct {
	pageSize int32
	// sendTimeout bounds one mail, so the handler knows whether the job has
	// time for the next one.
	sendTimeout time.Duration
	// reserve is the time the run needs besides its sends: recording the
	// cursor, and the worker's own write once the run returns.
	reserve time.Duration
}

var defaultNotificationEmailPaging = notificationEmailPaging{
	pageSize:    100,
	sendTimeout: 30 * time.Second,
	reserve:     5 * time.Second,
}

// NewNotificationEmailHandler mails one reader notification to every
// recipient whose email cell for it is on, from the tenant's SMTP settings and
// in the tenant's language, as every mail to a reader is.
func NewNotificationEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	resolve := func(ctx context.Context, tenantID uuid.UUID) (tenantDelivery, error) {
		return resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
	}
	return newNotificationEmailHandler(cfg, queries, resolve, defaultNotificationEmailPaging)
}

func newNotificationEmailHandler(
	cfg EmailHandlerConfig,
	queries notificationEmailQuerier,
	resolve func(ctx context.Context, tenantID uuid.UUID) (tenantDelivery, error),
	paging notificationEmailPaging,
) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("notification email"); err != nil {
			return err
		}
		var payload NotificationEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode notification email payload: %w", err))
		}
		tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
		if err != nil {
			return Permanent(err)
		}
		notificationType := strings.TrimSpace(payload.NotificationType)
		subjectKey := strings.TrimSpace(payload.SubjectKey)
		if notificationType == "" || subjectKey == "" {
			return Permanent(errors.New("notification email payload names no notification"))
		}
		compose, ok := notificationEmailTemplates[notificationType]
		if !ok {
			return Permanent(fmt.Errorf("notification type %q is not mailed", notificationType))
		}

		delivery, err := resolve(ctx, tenantID)
		if err != nil {
			return err
		}
		settingsURL, err := tenantSiteURL(delivery.tenant, notificationSettingsPath)
		if err != nil {
			return fmt.Errorf("build notification settings url: %w", err)
		}
		links := notificationEmailLinks{tenant: delivery.tenant, settings: settingsURL}

		cursor, err := parseNotificationEmailCursor(event.ProgressCursor)
		if err != nil {
			return Permanent(err)
		}
		record := func(cursor *notificationEmailCursor) error {
			progress := sql.NullString{}
			if cursor != nil {
				encoded, err := json.Marshal(cursor)
				if err != nil {
					return fmt.Errorf("encode notification email progress: %w", err)
				}
				progress = sql.NullString{String: string(encoded), Valid: true}
			}
			recorded, err := queries.RecordOutboxEventProgress(ctx, dbmodels.RecordOutboxEventProgressParams{
				ID:             event.ID,
				ProgressCursor: progress,
			})
			if err != nil {
				return fmt.Errorf("record notification email progress: %w", err)
			}
			if recorded == 0 {
				return errors.New("record notification email progress: the event is no longer claimed by this run")
			}
			return nil
		}

		// A mailed row is marked, so a retry mails nobody twice; the cursor only
		// keeps a run from asking again about a recipient it failed, and says
		// whether any run of this pass failed one. A pass that failed somebody
		// ends by starting the cursor over and failing, so the retry walks every
		// recipient again and mails the ones still owed.
		var failures []error
		attempted, sent := 0, 0
		// Every mail of the run so far failed, which is what a relay that is
		// down looks like. The recorded cursor is left where the run found it,
		// so the retry asks about the same recipients again.
		outage := func() error {
			return fmt.Errorf("send notification email to all %d recipients failed: %w",
				attempted, errors.Join(failures...))
		}
		for {
			recipients, err := queries.ListNotificationEmailRecipients(ctx, dbmodels.ListNotificationEmailRecipientsParams{
				TenantID:         tenantID,
				NotificationType: notificationType,
				SubjectKey:       subjectKey,
				AfterUserID:      cursor.UserID,
				PageSize:         paging.pageSize,
			})
			if err != nil {
				return fmt.Errorf("list notification email recipients: %w", err)
			}
			for _, recipient := range recipients {
				if attempted > 0 && !notificationEmailHasRoom(ctx, paging) {
					if sent == 0 {
						return outage()
					}
					if err := record(&cursor); err != nil {
						return err
					}
					return ErrResume
				}
				attempted++
				err := sendNotificationEmail(ctx, cfg, delivery, links, compose, recipient, paging.sendTimeout)
				switch {
				case IsPermanent(err):
					return err
				case err != nil:
					failures = append(failures, fmt.Errorf("mail %s: %w", recipient.UserID, err))
					cursor.Failed = true
				default:
					if err := queries.MarkNotificationEmailed(ctx, dbmodels.MarkNotificationEmailedParams{
						TenantID: tenantID,
						ID:       recipient.NotificationID,
					}); err != nil {
						return fmt.Errorf("mark notification emailed: %w", err)
					}
					sent++
				}
				cursor.UserID = recipient.UserID
			}
			if sent == 0 && len(failures) > 0 {
				return outage()
			}
			if int32(len(recipients)) < paging.pageSize {
				break
			}
		}
		if !cursor.Failed {
			return nil
		}
		if err := record(nil); err != nil {
			return err
		}
		if len(failures) == 0 {
			return errors.New("notification email failed to reach some recipients in an earlier run")
		}
		return fmt.Errorf("notification email reached %d recipients and failed %d: %w",
			sent, len(failures), errors.Join(failures...))
	}
}

// sendNotificationEmail mails one recipient their row, within the time one
// send is given.
func sendNotificationEmail(
	ctx context.Context,
	cfg EmailHandlerConfig,
	delivery tenantDelivery,
	links notificationEmailLinks,
	compose func(row dbmodels.ListNotificationEmailRecipientsRow, links notificationEmailLinks) (string, map[string]any, error),
	recipient dbmodels.ListNotificationEmailRecipientsRow,
	timeout time.Duration,
) error {
	template, data, err := compose(recipient, links)
	if err != nil {
		return err
	}
	data["tenant_name"] = delivery.tenantName
	sendCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return deliverEmail(sendCtx, cfg, delivery.settings, recipient.Email, emailrenderer.Request{
		Template: template,
		Locale:   delivery.locale,
		Data:     data,
		TimeZone: delivery.timeZone,
	})
}

// notificationEmailCursor is the last recipient a run asked about, and whether
// a run of the current pass failed to mail anybody.
type notificationEmailCursor struct {
	UserID uuid.UUID `json:"user_id"`
	Failed bool      `json:"failed,omitempty"`
}

// parseNotificationEmailCursor reads the recorded cursor; an event with none
// starts before every recipient.
func parseNotificationEmailCursor(recorded sql.NullString) (notificationEmailCursor, error) {
	var cursor notificationEmailCursor
	if !recorded.Valid {
		return cursor, nil
	}
	if err := json.Unmarshal([]byte(recorded.String), &cursor); err != nil {
		return cursor, fmt.Errorf("decode notification email progress cursor: %w", err)
	}
	return cursor, nil
}

// notificationEmailHasRoom reports whether the job has time for one more mail
// at its slowest. A run always sends its first mail, so every run moves on.
func notificationEmailHasRoom(ctx context.Context, paging notificationEmailPaging) bool {
	deadline, ok := ctx.Deadline()
	return !ok || time.Until(deadline) >= paging.sendTimeout+paging.reserve
}
