package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
)

// EventTypeDataExportReadyNotification tells a reader that the archive of
// what the install keeps about them, which they asked for, is ready.
//
// The worker's maintenance role queues it in the transaction that records the
// archive, and the outbox drain writes the row, for the reason
// EventTypeCommentApprovedNotification gives: the row is written by the
// connection notifications are always written by.
const EventTypeDataExportReadyNotification = "data_export_ready_notification"

// NotificationTypeDataExportReady is the notifications.notification_type of a
// reader's ready archive. It reaches the bell and the mail whatever the
// reader's notification settings say, since they asked for it, and it is not
// pushed.
const NotificationTypeDataExportReady = "data_export_ready"

// DataExportSubjectKey is the identity one archive's notification has.
func DataExportSubjectKey(dataExportID uuid.UUID) string {
	return "data_export:" + dataExportID.String()
}

// DataExportReadyNotification is the JSON body of the event.
type DataExportReadyNotification struct {
	TenantID     uuid.UUID `json:"tenant_id"`
	UserID       uuid.UUID `json:"user_id"`
	DataExportID uuid.UUID `json:"data_export_id"`
	// ExpiresAt is when the archive is deleted, which the inbox and the mail
	// tell the reader.
	ExpiresAt time.Time `json:"expires_at"`
}

func (n DataExportReadyNotification) validate() error {
	if n.TenantID == uuid.Nil {
		return errors.New("data export notification names no tenant")
	}
	if n.UserID == uuid.Nil {
		return errors.New("data export notification names no reader")
	}
	if n.DataExportID == uuid.Nil {
		return errors.New("data export notification names no archive")
	}
	if n.ExpiresAt.IsZero() {
		return errors.New("data export notification names no expiry")
	}
	return nil
}

// dataExportReadyQueuer is the insert [QueueDataExportReadyNotification] runs.
type dataExportReadyQueuer interface {
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

// QueueDataExportReadyNotification records, on the querier that records the
// archive, the event that tells its reader it is ready.
func QueueDataExportReadyNotification(ctx context.Context, q dataExportReadyQueuer, n DataExportReadyNotification) error {
	if err := n.validate(); err != nil {
		return err
	}
	payload, err := json.Marshal(n)
	if err != nil {
		return fmt.Errorf("encode data export notification payload: %w", err)
	}
	eventID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("allocate outbox event id: %w", err)
	}
	_, err = q.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             eventID,
		TenantID:       uuid.NullUUID{UUID: n.TenantID, Valid: true},
		EventType:      EventTypeDataExportReadyNotification,
		Payload:        payload,
		IdempotencyKey: EventTypeDataExportReadyNotification + ":" + n.TenantID.String() + ":" + n.DataExportID.String(),
		AvailableAt:    time.Now().UTC(),
	})
	// The insert is a no-op when the same key is already queued, and :one then
	// returns no rows.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("queue data export notification: %w", err)
	}
	return nil
}

// DataExportReadyNotificationHandlerConfig is what the worker resolves once
// at startup for the handler.
type DataExportReadyNotificationHandlerConfig struct {
	DB *sql.DB
}

// NewDataExportReadyNotificationHandler writes the bell notification and
// queues the mail a ready archive owes its reader.
func NewDataExportReadyNotificationHandler(cfg DataExportReadyNotificationHandlerConfig) Handler {
	if cfg.DB == nil {
		// A plain error rather than a [Permanent] one, because an operator
		// restarting the worker with a database makes the event deliverable.
		return func(context.Context, dbmodels.OutboxEvent) error {
			return errors.New("data export notification handler database is not configured")
		}
	}
	return dataExportReadyNotificationHandler(dbmodels.New(cfg.DB))
}

// dataExportNotifier is the inserts the handler runs.
type dataExportNotifier interface {
	CreateNotification(ctx context.Context, arg dbmodels.CreateNotificationParams) error
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

func dataExportReadyNotificationHandler(queries dataExportNotifier) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		var n DataExportReadyNotification
		if err := json.Unmarshal(event.Payload, &n); err != nil {
			return Permanent(fmt.Errorf("decode data export notification payload: %w", err))
		}
		if !event.TenantID.Valid || n.TenantID != event.TenantID.UUID {
			return Permanent(errors.New("data export notification payload tenant_id does not match the event"))
		}
		if err := n.validate(); err != nil {
			return Permanent(err)
		}
		return notifyDataExportReady(ctx, queries, n)
	}
}

// dataExportNotificationBody is what the storefront and the app read back.
type dataExportNotificationBody struct {
	ExpiresAt string `json:"expires_at"`
}

// notifyDataExportReady writes the reader's bell notification and queues the
// mail that mirrors it. A reader whose account was deleted after the archive
// was recorded is owed neither: the insert's foreign key refuses the row, and
// the purge takes the archive.
func notifyDataExportReady(ctx context.Context, queries dataExportNotifier, n DataExportReadyNotification) error {
	category, err := NotificationCategoryFor(NotificationTypeDataExportReady)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(dataExportNotificationBody{ExpiresAt: n.ExpiresAt.UTC().Format(time.RFC3339)})
	if err != nil {
		return fmt.Errorf("encode data export notification: %w", err)
	}
	notificationID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("allocate notification id: %w", err)
	}
	subjectKey := DataExportSubjectKey(n.DataExportID)
	if err := queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               notificationID,
		TenantID:         n.TenantID,
		UserID:           n.UserID,
		NotificationType: NotificationTypeDataExportReady,
		SubjectKey:       subjectKey,
		Payload:          payload,
		Category:         category,
	}); err != nil {
		if dberr.IsForeignKeyViolation(err) {
			return nil
		}
		return fmt.Errorf("insert data export notification: %w", err)
	}
	return queueNotificationEmail(ctx, queries, n.TenantID, NotificationTypeDataExportReady, subjectKey)
}
