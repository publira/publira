package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fcmsettings"
	"github.com/publira/publira/server/internal/push"
)

// EventTypeMemberPushNotification mirrors one member notification onto the
// devices that reader registered.
//
// A push never exists without its `notifications` row: the row is the record
// and the push is one delivery of it, so a Firebase outage loses the alert and
// not the notification. That is also why the event is drained here rather than
// sent inline by the scheduled publication job — the retries, the backoff, and the
// dead state already live in this worker, and a publish run must not wait on
// Firebase.
const EventTypeMemberPushNotification = "member_push_notification"

// Notification types that reach a device. The mobile app is the reader app, so
// only member-facing types are on the list: a tenant administrator and an
// operator read their console bell instead. A member type added later stays
// silent until it is named here, rather than shipping a surprise push.
//
// comment_approved and comment_hidden are member-facing and still absent:
// they tell a reader what happened to their own comment, and that belongs in
// the bell rather than on a lock screen.
var pushedNotificationTypes = map[string]struct{}{
	"episode_published": {},
}

// MemberPushNotificationPayload names the notification rows the push mirrors
// and carries what the message shows and routes to.
//
// One event per episode, not per member: the per-member work is already the
// notification insert, and the recipients are resolved from those rows when
// this event is drained.
type MemberPushNotificationPayload struct {
	TenantID         string `json:"tenant_id"`
	NotificationType string `json:"notification_type"`
	SubjectKey       string `json:"subject_key"`
	SeriesID         string `json:"series_id"`
	SeriesTitle      string `json:"series_title"`
	EpisodeID        string `json:"episode_id"`
	EpisodeTitle     string `json:"episode_title"`
}

// PushSender sends to a device with the Firebase credentials of the tenant it
// belongs to. It reports [fcmsettings.ErrNotConfigured] for a tenant with none,
// which the handler takes as mobile push being off for that tenant.
type PushSender interface {
	Send(ctx context.Context, tenantID uuid.UUID, message push.Message) error
}

// WebPushSender delivers to a browser subscription. The worker's reports Web
// Push that is not configured rather than being absent.
type WebPushSender interface {
	Send(ctx context.Context, subscription push.WebPushSubscription, message push.WebPushMessage) error
}

// PushHandlerConfig is what the worker resolves once at startup for the push
// handler. Both senders resolve their credentials per delivery.
type PushHandlerConfig struct {
	DB        *sql.DB
	Sender    PushSender
	WebSender WebPushSender
	Logger    *slog.Logger
}

// pushDeviceQuerier is the statements the handler runs, named so a test can
// drive the send loop without a database behind it.
type pushDeviceQuerier interface {
	ListPushDevicesForNotification(
		ctx context.Context,
		arg dbmodels.ListPushDevicesForNotificationParams,
	) ([]dbmodels.ListPushDevicesForNotificationRow, error)
	DeleteUserPushDeviceByToken(ctx context.Context, token string) (int64, error)
	RecordOutboxEventProgress(ctx context.Context, arg dbmodels.RecordOutboxEventProgressParams) (int64, error)
}

// memberPushPaging is how the handler walks a tenant's devices within the time
// one outbox job is given.
type memberPushPaging struct {
	// pageSize is both how many devices a page lists and how many sends run at
	// once, so every send of a page starts together and the page lasts at most
	// one sendTimeout.
	pageSize int32
	// sendTimeout bounds one send, below the push clients' own timeout, so
	// that the handler knows how long a page can take.
	sendTimeout time.Duration
	// reserve is the time a page needs besides its sends: listing it,
	// recording the cursor, and the worker's own write once the run returns.
	reserve time.Duration
}

var defaultMemberPushPaging = memberPushPaging{
	pageSize:    50,
	sendTimeout: 10 * time.Second,
	reserve:     5 * time.Second,
}

// NewMemberPushNotificationHandler delivers one member notification to every
// device its recipients registered.
//
// The message is the tenant's own content rather than copy: the title is the
// series and the body is the episode. The server holds no message catalog in
// Go — the localized copy this repository owns is rendered by the email
// renderer for mail and compiled into the app for screens — and a title
// rendered in the tenant's language would reach a reader whose device is set
// to another one. Content is what both readers can read.
func NewMemberPushNotificationHandler(cfg PushHandlerConfig) Handler {
	if cfg.DB == nil {
		// Reported per event rather than at registration, and as a plain error
		// rather than a [Permanent] one, because an operator restarting the
		// worker with a database makes a pending event deliverable again.
		return func(context.Context, dbmodels.OutboxEvent) error {
			return errors.New("member push notification handler database is not configured")
		}
	}
	return newMemberPushNotificationHandler(cfg, dbmodels.New(cfg.DB), defaultMemberPushPaging)
}

func newMemberPushNotificationHandler(cfg PushHandlerConfig, queries pushDeviceQuerier, paging memberPushPaging) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.Sender == nil && cfg.WebSender == nil {
			return errors.New("member push notification handler sender is not configured")
		}

		var payload MemberPushNotificationPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode member push notification payload: %w", err))
		}
		tenantID, err := memberPushTenantID(event, payload.TenantID)
		if err != nil {
			return Permanent(err)
		}
		notificationType := strings.TrimSpace(payload.NotificationType)
		subjectKey := strings.TrimSpace(payload.SubjectKey)
		if notificationType == "" || subjectKey == "" {
			return Permanent(errors.New("member push notification payload names no notification"))
		}
		if _, ok := pushedNotificationTypes[notificationType]; !ok {
			// Not a fault: the notification row still exists and the bell still
			// shows it. The event completes so it does not retry into the dead
			// state over a decision that will not change.
			logPush(ctx, cfg.Logger, "dropped member push notification; type is not pushed",
				event, "notification_type", notificationType)
			return nil
		}

		send := memberPushSender{cfg: cfg, queries: queries, event: event, tenantID: tenantID,
			notificationType: notificationType, payload: payload, sendTimeout: paging.sendTimeout}

		// FCM keeps no delivery record, so only the cursor keeps a reached device
		// from a second message. It moves after each page unless the run so far
		// has settled nothing and failed somewhere, as in an outage, so a retry
		// resends only what nobody received; the devices a partly successful run
		// could not reach lose this alert, which the bell still shows.
		cursor := event.ProgressCursor.String
		var failures []error
		attempted, settled, skipped := 0, 0, 0
		finished := false
		for first := true; first || memberPushHasRoomForPage(ctx, paging); first = false {
			devices, err := queries.ListPushDevicesForNotification(ctx, dbmodels.ListPushDevicesForNotificationParams{
				TenantID:         tenantID,
				AfterToken:       cursor,
				NotificationType: notificationType,
				SubjectKey:       subjectKey,
				PageSize:         paging.pageSize,
			})
			if err != nil {
				return fmt.Errorf("list push devices: %w", err)
			}
			for _, outcome := range send.page(ctx, devices) {
				switch {
				case outcome.err != nil:
					failures = append(failures, outcome.err)
				case outcome.skipped:
					skipped++
				default:
					settled++
				}
			}
			attempted += len(devices)
			if len(devices) < int(paging.pageSize) {
				finished = true
				break
			}
			cursor = devices[len(devices)-1].Token
			if settled == 0 && len(failures) > 0 {
				continue
			}
			recorded, err := queries.RecordOutboxEventProgress(ctx, dbmodels.RecordOutboxEventProgressParams{
				ID:             event.ID,
				ProgressCursor: sql.NullString{String: cursor, Valid: true},
			})
			if err != nil {
				return fmt.Errorf("record member push progress: %w", err)
			}
			if recorded == 0 {
				return errors.New("record member push progress: the event is no longer claimed by this run")
			}
		}
		if skipped > 0 {
			// The devices stay registered: the tenant may connect its Firebase
			// project later, and its app is still installed.
			logPush(ctx, cfg.Logger, "skipped mobile devices; the tenant has no FCM credentials", event,
				"skipped", skipped)
		}
		if len(failures) > 0 {
			joined := errors.Join(failures...)
			if settled == 0 {
				return fmt.Errorf("send member push notification to all %d devices failed: %w",
					attempted, joined)
			}
			if cfg.Logger != nil {
				cfg.Logger.WarnContext(ctx, "member push notification reached some devices and not others",
					"event_id", event.ID,
					"event_type", event.EventType,
					"idempotency_key", event.IdempotencyKey,
					"settled", settled,
					"failed", len(failures),
					"error", joined,
				)
			}
		}
		if !finished {
			return ErrResume
		}
		return nil
	}
}

// memberPushHasRoomForPage reports whether the job has time for one more page
// at its slowest. A run always takes its first page, so every run moves the
// cursor even when its budget is shorter than that.
func memberPushHasRoomForPage(ctx context.Context, paging memberPushPaging) bool {
	deadline, ok := ctx.Deadline()
	return !ok || time.Until(deadline) >= paging.sendTimeout+paging.reserve
}

// memberPushSender sends one event's message to a page of devices.
type memberPushSender struct {
	cfg              PushHandlerConfig
	queries          pushDeviceQuerier
	event            dbmodels.OutboxEvent
	tenantID         uuid.UUID
	notificationType string
	payload          MemberPushNotificationPayload
	sendTimeout      time.Duration
}

// memberPushOutcome is what became of one device. A device is settled when
// neither field is set: it took the message, or it was revoked and removed.
type memberPushOutcome struct {
	skipped bool
	err     error
}

// page sends to every device at once and answers once all of them are done.
func (s memberPushSender) page(ctx context.Context, devices []dbmodels.ListPushDevicesForNotificationRow) []memberPushOutcome {
	outcomes := make([]memberPushOutcome, len(devices))
	var wg sync.WaitGroup
	for i, device := range devices {
		wg.Go(func() {
			outcomes[i] = s.device(ctx, device)
		})
	}
	wg.Wait()
	return outcomes
}

func (s memberPushSender) device(ctx context.Context, device dbmodels.ListPushDevicesForNotificationRow) memberPushOutcome {
	sendCtx, cancel := context.WithTimeout(ctx, s.sendTimeout)
	defer cancel()

	data := memberPushData(device.NotificationID, s.notificationType, s.payload)
	var sendErr error
	switch device.Platform {
	case "android", "ios":
		if s.cfg.Sender == nil {
			sendErr = errors.New("FCM sender is not configured")
		} else {
			sendErr = s.cfg.Sender.Send(sendCtx, s.tenantID, push.Message{Token: device.Token, Title: s.payload.SeriesTitle, Body: s.payload.EpisodeTitle, Data: data})
		}
	case "web":
		if s.cfg.WebSender == nil {
			sendErr = errors.New("web push sender is not configured")
		} else {
			sendErr = s.cfg.WebSender.Send(sendCtx, push.WebPushSubscription{Endpoint: device.Endpoint.String, P256dh: device.P256dh.String, Auth: device.Auth.String}, push.WebPushMessage{Title: s.payload.SeriesTitle, Body: s.payload.EpisodeTitle, Data: data})
		}
	default:
		sendErr = fmt.Errorf("unsupported push platform %q", device.Platform)
	}
	switch {
	case sendErr == nil:
		return memberPushOutcome{}
	case errors.Is(sendErr, fcmsettings.ErrNotConfigured):
		return memberPushOutcome{skipped: true}
	case errors.Is(sendErr, push.ErrTokenGone), errors.Is(sendErr, push.ErrEndpointGone):
		if _, err := s.queries.DeleteUserPushDeviceByToken(ctx, device.Token); err != nil {
			return memberPushOutcome{err: fmt.Errorf("delete revoked push device: %w", err)}
		}
		logPush(ctx, s.cfg.Logger, "removed revoked push device", s.event,
			"user_id", device.UserID.String())
		return memberPushOutcome{}
	default:
		return memberPushOutcome{err: sendErr}
	}
}

// memberPushData is the routing block the app reads once the reader taps the
// notification. `route` is the viewer path, which is nested under the series
// route so the back gesture lands on the series rather than leaving the app.
func memberPushData(
	notificationID uuid.UUID,
	notificationType string,
	payload MemberPushNotificationPayload,
) map[string]string {
	data := map[string]string{
		"notification_id":   notificationID.String(),
		"notification_type": notificationType,
	}
	seriesID := strings.TrimSpace(payload.SeriesID)
	episodeID := strings.TrimSpace(payload.EpisodeID)
	if seriesID != "" {
		data["series_id"] = seriesID
	}
	if episodeID != "" {
		data["episode_id"] = episodeID
	}
	if seriesID != "" && episodeID != "" {
		data["route"] = fmt.Sprintf("/series/%s/episodes/%s", seriesID, episodeID)
	}
	return data
}

// memberPushTenantID takes the tenant from the event row and checks the
// payload agrees. The table already enforces the pair, so a disagreement is a
// row written around the producer.
func memberPushTenantID(event dbmodels.OutboxEvent, payloadTenantID string) (uuid.UUID, error) {
	if !event.TenantID.Valid {
		return uuid.Nil, errors.New("member push notification event carries no tenant")
	}
	parsed, err := uuid.Parse(strings.TrimSpace(payloadTenantID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("member push notification payload tenant_id is invalid: %w", err)
	}
	if parsed != event.TenantID.UUID {
		return uuid.Nil, errors.New("member push notification payload tenant_id does not match the event")
	}
	return event.TenantID.UUID, nil
}

func logPush(ctx context.Context, logger *slog.Logger, message string, event dbmodels.OutboxEvent, attrs ...any) {
	if logger == nil {
		return
	}
	logger.InfoContext(ctx, message, append([]any{
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
	}, attrs...)...)
}
