package outbox

import (
	"context"
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
	if len(queries.created) != 0 {
		t.Fatalf("notifications written = %d, want 0", len(queries.created))
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
	users              []dbmodels.ListAnnouncementRecipientsRow
	listedTenant       uuid.NullUUID
	listedAnnouncement uuid.UUID
	listCalls          int
	listErr            error
	created            []dbmodels.CreateNotificationParams
	createErr          error
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
