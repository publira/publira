package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/push"
)

// EventTypeMemberPushNotification mirrors one member notification onto the
// devices that reader registered.
//
// A push never exists without its `notifications` row: the row is the record
// and the push is one delivery of it, so a Firebase outage loses the alert and
// not the notification. That is also why the event is drained here rather than
// sent inline by `batch publish-episodes` — the retries, the backoff, and the
// dead state already live in this worker, and a publish run must not wait on
// Firebase.
const EventTypeMemberPushNotification = "member_push_notification"

// Notification types that reach a device. The mobile app is the reader app, so
// only member-facing types are on the list: a tenant administrator and an
// operator read their console bell instead. A member type added later stays
// silent until it is named here, rather than shipping a surprise push.
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

// PushSender is the part of [push.Client] this handler uses, so a test can
// stand in for Firebase.
type PushSender interface {
	Send(ctx context.Context, message push.Message) error
}

// PushHandlerConfig is what the worker resolves once at startup for the push
// handler. A process with no Firebase credential registers no handler at all,
// so Sender is never nil in a registered one.
type PushHandlerConfig struct {
	DB     *sql.DB
	Sender PushSender
	Logger *slog.Logger
}

// pushDeviceQuerier is the statement pair the handler runs, named so a test can
// drive the send loop without a database behind it.
type pushDeviceQuerier interface {
	ListPushDevicesForNotification(
		ctx context.Context,
		arg dbmodels.ListPushDevicesForNotificationParams,
	) ([]dbmodels.ListPushDevicesForNotificationRow, error)
	DeleteUserPushDeviceByToken(ctx context.Context, token string) (int64, error)
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
	return newMemberPushNotificationHandler(cfg, dbmodels.New(cfg.DB))
}

func newMemberPushNotificationHandler(cfg PushHandlerConfig, queries pushDeviceQuerier) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.Sender == nil {
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

		devices, err := queries.ListPushDevicesForNotification(ctx, dbmodels.ListPushDevicesForNotificationParams{
			TenantID:         tenantID,
			NotificationType: notificationType,
			SubjectKey:       subjectKey,
		})
		if err != nil {
			return fmt.Errorf("list push devices: %w", err)
		}

		var failures []error
		for _, device := range devices {
			sendErr := cfg.Sender.Send(ctx, push.Message{
				Token: device.Token,
				Title: payload.SeriesTitle,
				Body:  payload.EpisodeTitle,
				Data:  memberPushData(device.NotificationID, notificationType, payload),
			})
			switch {
			case sendErr == nil:
			case errors.Is(sendErr, push.ErrTokenGone):
				if _, delErr := queries.DeleteUserPushDeviceByToken(ctx, device.Token); delErr != nil {
					failures = append(failures, fmt.Errorf("delete revoked push device: %w", delErr))
					continue
				}
				logPush(ctx, cfg.Logger, "removed revoked push device", event,
					"user_id", device.UserID.String())
			default:
				failures = append(failures, sendErr)
			}
		}
		if len(failures) > 0 {
			// Retrying re-sends to the devices that already took the message.
			// FCM has no delivery record to consult, and losing the alert for
			// the rest of a tenant's members is the worse of the two.
			return fmt.Errorf("send member push notification to %d of %d devices failed: %w",
				len(failures), len(devices), errors.Join(failures...))
		}
		return nil
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
