package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestAnnouncementIdempotencyKeySeparatesAnnouncements(t *testing.T) {
	first := AnnouncementIdempotencyKey(uuid.New())
	second := AnnouncementIdempotencyKey(uuid.New())
	if first == second {
		t.Fatalf("two announcements share the key %q", first)
	}
}

func TestAnnouncementNotificationWritesOneRowPerTenantUserInTheirLocale(t *testing.T) {
	tenantID := uuid.New()
	announcementID := uuid.New()
	// The query answers each reader with the title of the translation their
	// last locale picks, so two readers of one announcement can be told it in
	// two languages.
	recipients := []dbmodels.ListAnnouncementRecipientsRow{
		{UserID: uuid.New(), Title: "Scheduled maintenance"},
		{UserID: uuid.New(), Title: "  Scheduled maintenance (ja)  "},
	}
	queries := &stubAnnouncementQuerier{users: recipients}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	if err := handler(context.Background(), announcementEvent(t, tenantID, announcementID)); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(queries.created) != 2 {
		t.Fatalf("notifications written = %d, want 2", len(queries.created))
	}
	if queries.listedTenant.UUID != tenantID || !queries.listedTenant.Valid {
		t.Fatalf("recipients looked up for %v, want %s", queries.listedTenant, tenantID)
	}
	if queries.listedAnnouncement != announcementID {
		t.Fatalf("recipients looked up for announcement %s, want %s", queries.listedAnnouncement, announcementID)
	}
	for i, want := range []string{"Scheduled maintenance", "Scheduled maintenance (ja)"} {
		row := queries.created[i]
		if row.UserID != recipients[i].UserID {
			t.Fatalf("notification %d addressed %s, want %s", i, row.UserID, recipients[i].UserID)
		}
		if row.TenantID != tenantID {
			t.Fatalf("notification %d carries tenant %s, want %s", i, row.TenantID, tenantID)
		}
		if row.NotificationType != NotificationTypeAnnouncementPosted {
			t.Fatalf("notification %d type = %q", i, row.NotificationType)
		}
		if row.SubjectKey != AnnouncementSubjectKey(announcementID) {
			t.Fatalf("notification %d subject_key = %q", i, row.SubjectKey)
		}

		// The inbox assembles its copy from the type plus this field, so the
		// row carries the reader's title and nothing the event used to route
		// itself.
		var body map[string]string
		if err := json.Unmarshal(row.Payload, &body); err != nil {
			t.Fatalf("decode notification %d payload: %v", i, err)
		}
		if len(body) != 1 || body["announcement_title"] != want {
			t.Fatalf("notification %d payload = %v, want exactly announcement_title %q", i, body, want)
		}
	}
	if len(queries.queued) != 1 {
		t.Fatalf("outbox events = %d, want the mail", len(queries.queued))
	}
	mail := queries.queued[0]
	if mail.EventType != EventTypeNotificationEmail {
		t.Fatalf("outbox event type = %q, want %q", mail.EventType, EventTypeNotificationEmail)
	}
	if want := NotificationEmailIdempotencyKey(tenantID, NotificationTypeAnnouncementPosted, AnnouncementSubjectKey(announcementID)); mail.IdempotencyKey != want {
		t.Fatalf("mail idempotency_key = %q, want %q", mail.IdempotencyKey, want)
	}
}

// The delivery decides the category the rows are filed under, which is what
// CreateNotification reads the reader's cell by: a preferred announcement
// answers to the announcements cell, and one for everyone to no cell at all.
func TestAnnouncementNotificationFilesItsRowsByItsDelivery(t *testing.T) {
	for _, tc := range []struct {
		delivery string
		want     NotificationCategory
	}{
		{delivery: AnnouncementDeliveryPreferred, want: NotificationCategoryAnnouncements},
		{delivery: AnnouncementDeliveryEveryone, want: NotificationCategoryEveryone},
	} {
		t.Run(tc.delivery, func(t *testing.T) {
			queries := &stubAnnouncementQuerier{
				delivery: tc.delivery,
				users:    []dbmodels.ListAnnouncementRecipientsRow{{UserID: uuid.New(), Title: "Terms of use updated"}},
			}

			handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
			if err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New())); err != nil {
				t.Fatalf("handler: %v", err)
			}
			if len(queries.created) != 1 {
				t.Fatalf("notifications written = %d, want 1", len(queries.created))
			}
			if got := queries.created[0].Category; got != string(tc.want) {
				t.Fatalf("category = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestAnnouncementNotificationRejectsADeliveryItDoesNotKnow(t *testing.T) {
	queries := &stubAnnouncementQuerier{
		delivery: "staff_only",
		users:    []dbmodels.ListAnnouncementRecipientsRow{{UserID: uuid.New(), Title: "Scheduled maintenance"}},
	}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	if err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New())); !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
	if len(queries.created) != 0 {
		t.Fatalf("notifications written = %d, want 0", len(queries.created))
	}
}

// An audience the worker cannot read is a dead event rather than an
// announcement delivered to nobody, or to everyone.
func TestAnnouncementNotificationRejectsAnAudienceItCannotRead(t *testing.T) {
	for name, audience := range map[string]string{
		"a later version":   `{"version": 2, "conditions": [{"type": "never_purchased"}]}`,
		"no conditions":     `{"version": 1, "conditions": []}`,
		"an unknown type":   `{"version": 1, "conditions": [{"type": "bought_coins"}]}`,
		"a type twice":      `{"version": 1, "conditions": [{"type": "never_purchased"}, {"type": "never_purchased"}]}`,
		"days out of range": `{"version": 1, "conditions": [{"type": "signed_up_within_days", "days": 0}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			queries := &stubAnnouncementQuerier{
				audience: json.RawMessage(audience),
				users:    []dbmodels.ListAnnouncementRecipientsRow{{UserID: uuid.New(), Title: "Scheduled maintenance"}},
			}

			handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
			if err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New())); !IsPermanent(err) {
				t.Fatalf("handler error = %v, want a permanent error", err)
			}
			if len(queries.created) != 0 || queries.listCalls != 0 {
				t.Fatalf("notifications written = %d after %d recipient queries, want none", len(queries.created), queries.listCalls)
			}
		})
	}
}

func TestAnnouncementNotificationCompletesWhenTheAnnouncementIsGone(t *testing.T) {
	queries := &stubAnnouncementQuerier{
		deliveryErr: sql.ErrNoRows,
		users:       []dbmodels.ListAnnouncementRecipientsRow{{UserID: uuid.New(), Title: "Scheduled maintenance"}},
	}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	if err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New())); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.created) != 0 {
		t.Fatalf("notifications written = %d, want 0", len(queries.created))
	}
}

func TestAnnouncementNotificationWalksEveryRecipientPage(t *testing.T) {
	// A full page means there may be another behind it, so the handler asks
	// again from the last user it saw rather than stopping at the first page.
	users := make([]dbmodels.ListAnnouncementRecipientsRow, announcementRecipientPageSize+1)
	for i := range users {
		users[i] = dbmodels.ListAnnouncementRecipientsRow{UserID: uuid.New(), Title: "Scheduled maintenance"}
	}
	queries := &stubAnnouncementQuerier{users: users}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	if err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New())); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(queries.created) != len(users) {
		t.Fatalf("notifications written = %d, want %d", len(queries.created), len(users))
	}
	if queries.listCalls != 2 {
		t.Fatalf("recipient queries = %d, want 2", queries.listCalls)
	}
}

func TestAnnouncementNotificationCompletesWhenTheTenantHasNoUsers(t *testing.T) {
	queries := &stubAnnouncementQuerier{}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	if err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New())); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.created) != 0 || len(queries.queued) != 0 {
		t.Fatalf("notifications, outbox events = %d, %d, want none", len(queries.created), len(queries.queued))
	}
}

// A retry evaluates the audience again. When it selects nobody now, the rows an
// earlier attempt wrote are still owed their mail.
func TestAnnouncementNotificationQueuesTheMailOfAnEarlierAttemptsRows(t *testing.T) {
	queries := &stubAnnouncementQuerier{
		audience: json.RawMessage(`{"version": 1, "conditions": [{"type": "never_purchased"}]}`),
		written:  true,
	}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	if err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New())); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.queued) != 1 || queries.queued[0].EventType != EventTypeNotificationEmail {
		t.Fatalf("outbox events = %v, want the one notification_email", queries.queued)
	}
}

func TestAnnouncementNotificationRetriesAFailedLookup(t *testing.T) {
	queries := &stubAnnouncementQuerier{listErr: errors.New("connection refused")}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New()))
	if err == nil {
		t.Fatal("handler error = nil, want a retriable error")
	}
	if IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable error", err)
	}
}

func TestAnnouncementNotificationRejectsAPayloadNamingAnotherTenant(t *testing.T) {
	queries := &stubAnnouncementQuerier{users: []dbmodels.ListAnnouncementRecipientsRow{{UserID: uuid.New(), Title: "Scheduled maintenance"}}}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	event := announcementEvent(t, uuid.New(), uuid.New())
	event.TenantID = uuid.NullUUID{UUID: uuid.New(), Valid: true}

	if err := handler(context.Background(), event); !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
	if len(queries.created) != 0 {
		t.Fatalf("notifications written = %d, want 0", len(queries.created))
	}
}

func TestAnnouncementNotificationRejectsAPayloadWithoutAnAnnouncement(t *testing.T) {
	queries := &stubAnnouncementQuerier{users: []dbmodels.ListAnnouncementRecipientsRow{{UserID: uuid.New(), Title: "Scheduled maintenance"}}}
	tenantID := uuid.New()
	payload, err := json.Marshal(AnnouncementNotificationPayload{TenantID: tenantID.String()})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	event := announcementEvent(t, tenantID, uuid.New())
	event.Payload = payload

	if err := handler(context.Background(), event); !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
}

func announcementEvent(
	t *testing.T,
	tenantID, announcementID uuid.UUID,
) dbmodels.OutboxEvent {
	t.Helper()

	payload, err := json.Marshal(AnnouncementNotificationPayload{
		TenantID:       tenantID.String(),
		AnnouncementID: announcementID.String(),
	})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.New(),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      EventTypeAnnouncementNotification,
		Payload:        payload,
		IdempotencyKey: AnnouncementIdempotencyKey(announcementID),
		Status:         StatusProcessing,
	}
}

type stubAnnouncementQuerier struct {
	// delivery is what GetAnnouncementDelivery answers, preferred when empty.
	delivery string
	// audience is the stored audience it answers, none when nil.
	audience json.RawMessage
	// written is what AnnouncementHasNotifications answers: whether an earlier
	// attempt already wrote a row for the announcement.
	written            bool
	deliveryErr        error
	users              []dbmodels.ListAnnouncementRecipientsRow
	listedTenant       uuid.NullUUID
	listedAnnouncement uuid.UUID
	listCalls          int
	listErr            error
	created            []dbmodels.CreateNotificationParams
	createErr          error
	queued             []dbmodels.InsertOutboxEventParams
}

func (s *stubAnnouncementQuerier) InsertOutboxEvent(
	_ context.Context,
	arg dbmodels.InsertOutboxEventParams,
) (dbmodels.OutboxEvent, error) {
	s.queued = append(s.queued, arg)
	return dbmodels.OutboxEvent{ID: arg.ID, EventType: arg.EventType}, nil
}

func (s *stubAnnouncementQuerier) GetAnnouncementDelivery(
	context.Context,
	dbmodels.GetAnnouncementDeliveryParams,
) (dbmodels.GetAnnouncementDeliveryRow, error) {
	if s.deliveryErr != nil {
		return dbmodels.GetAnnouncementDeliveryRow{}, s.deliveryErr
	}
	row := dbmodels.GetAnnouncementDeliveryRow{Delivery: s.delivery}
	if row.Delivery == "" {
		row.Delivery = AnnouncementDeliveryPreferred
	}
	if s.audience != nil {
		row.Audience = &s.audience
	}
	return row, nil
}

// ListAnnouncementRecipients answers the keyset the handler pages with, so a
// stub holding more than one page's worth is walked the way the database would
// be.
func (s *stubAnnouncementQuerier) ListAnnouncementRecipients(
	_ context.Context,
	arg dbmodels.ListAnnouncementRecipientsParams,
) ([]dbmodels.ListAnnouncementRecipientsRow, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	s.listCalls++
	s.listedTenant = arg.TenantID
	s.listedAnnouncement = arg.AnnouncementID

	start := 0
	if arg.AfterUserID != uuid.Nil {
		for i, recipient := range s.users {
			if recipient.UserID == arg.AfterUserID {
				start = i + 1
				break
			}
		}
	}
	end := min(start+int(arg.Limit), len(s.users))
	if start >= end {
		return nil, nil
	}
	return s.users[start:end], nil
}

func (s *stubAnnouncementQuerier) AnnouncementHasNotifications(
	context.Context,
	dbmodels.AnnouncementHasNotificationsParams,
) (bool, error) {
	return s.written || len(s.created) > 0, nil
}

func (s *stubAnnouncementQuerier) CreateNotification(
	_ context.Context,
	arg dbmodels.CreateNotificationParams,
) error {
	if s.createErr != nil {
		return s.createErr
	}
	s.created = append(s.created, arg)
	return nil
}
