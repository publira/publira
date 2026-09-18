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

func TestAnnouncementNotificationWritesOneRowPerTenantUser(t *testing.T) {
	tenantID := uuid.New()
	announcementID := uuid.New()
	first := uuid.New()
	second := uuid.New()
	queries := &stubAnnouncementQuerier{users: []uuid.UUID{first, second}}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	if err := handler(context.Background(), announcementEvent(t, tenantID, announcementID, "")); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(queries.created) != 2 {
		t.Fatalf("notifications written = %d, want 2", len(queries.created))
	}
	if queries.listedTenant.UUID != tenantID || !queries.listedTenant.Valid {
		t.Fatalf("recipients looked up for %v, want %s", queries.listedTenant, tenantID)
	}
	for i, recipient := range []uuid.UUID{first, second} {
		row := queries.created[i]
		if row.UserID != recipient {
			t.Fatalf("notification %d addressed %s, want %s", i, row.UserID, recipient)
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
	}

	// The inbox assembles its copy from the type plus this field, so the row
	// carries the title and nothing the event used to route itself.
	var body map[string]string
	if err := json.Unmarshal(queries.created[0].Payload, &body); err != nil {
		t.Fatalf("decode notification payload: %v", err)
	}
	want := map[string]string{"announcement_title": "Scheduled maintenance"}
	if len(body) != len(want) || body["announcement_title"] != want["announcement_title"] {
		t.Fatalf("payload = %v, want exactly %v", body, want)
	}
}

func TestAnnouncementNotificationWalksEveryRecipientPage(t *testing.T) {
	// A full page means there may be another behind it, so the handler asks
	// again from the last user it saw rather than stopping at the first page.
	users := make([]uuid.UUID, announcementRecipientPageSize+1)
	for i := range users {
		users[i] = uuid.New()
	}
	queries := &stubAnnouncementQuerier{users: users}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	if err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New(), "")); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(queries.created) != len(users) {
		t.Fatalf("notifications written = %d, want %d", len(queries.created), len(users))
	}
	if queries.listCalls != 2 {
		t.Fatalf("recipient queries = %d, want 2", queries.listCalls)
	}
}

func TestAnnouncementNotificationAddressesOnlyTheNamedRecipient(t *testing.T) {
	tenantID := uuid.New()
	target := uuid.New()
	queries := &stubAnnouncementQuerier{
		users:       []uuid.UUID{uuid.New(), uuid.New()},
		tenantUsers: map[uuid.UUID]struct{}{target: {}},
	}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	event := announcementEvent(t, tenantID, uuid.New(), target.String())
	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(queries.created) != 1 {
		t.Fatalf("notifications written = %d, want 1", len(queries.created))
	}
	if queries.created[0].UserID != target {
		t.Fatalf("notification addressed %s, want %s", queries.created[0].UserID, target)
	}
	if queries.listCalls != 0 {
		t.Fatalf("recipient queries = %d, want 0 for a targeted announcement", queries.listCalls)
	}
	if queries.resolvedTenant.UUID != tenantID || !queries.resolvedTenant.Valid {
		t.Fatalf("target resolved inside %v, want tenant %s", queries.resolvedTenant, tenantID)
	}
}

// `notifications` keeps the tenant and the user as two separate foreign keys,
// so a recipient from another tenant is a row the database would accept. The
// event names a recipient the handler did not resolve itself, so it is refused
// here rather than retried: no redelivery moves that user into this tenant.
func TestAnnouncementNotificationRejectsATargetOfAnotherTenant(t *testing.T) {
	queries := &stubAnnouncementQuerier{tenantUsers: map[uuid.UUID]struct{}{}}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	event := announcementEvent(t, uuid.New(), uuid.New(), uuid.New().String())

	if err := handler(context.Background(), event); !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
	if len(queries.created) != 0 {
		t.Fatalf("notifications written = %d, want 0", len(queries.created))
	}
}

func TestAnnouncementNotificationRetriesAFailedTargetLookup(t *testing.T) {
	queries := &stubAnnouncementQuerier{resolveErr: errors.New("connection refused")}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New(), uuid.New().String()))
	if err == nil {
		t.Fatal("handler error = nil, want a retriable error")
	}
	if IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable error", err)
	}
}

func TestAnnouncementNotificationCompletesWhenTheTenantHasNoUsers(t *testing.T) {
	queries := &stubAnnouncementQuerier{}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	if err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New(), "")); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.created) != 0 {
		t.Fatalf("notifications written = %d, want 0", len(queries.created))
	}
}

func TestAnnouncementNotificationRetriesAFailedLookup(t *testing.T) {
	queries := &stubAnnouncementQuerier{listErr: errors.New("connection refused")}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	err := handler(context.Background(), announcementEvent(t, uuid.New(), uuid.New(), ""))
	if err == nil {
		t.Fatal("handler error = nil, want a retriable error")
	}
	if IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable error", err)
	}
}

func TestAnnouncementNotificationRejectsAPayloadNamingAnotherTenant(t *testing.T) {
	queries := &stubAnnouncementQuerier{users: []uuid.UUID{uuid.New()}}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	event := announcementEvent(t, uuid.New(), uuid.New(), "")
	event.TenantID = uuid.NullUUID{UUID: uuid.New(), Valid: true}

	if err := handler(context.Background(), event); !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
	if len(queries.created) != 0 {
		t.Fatalf("notifications written = %d, want 0", len(queries.created))
	}
}

func TestAnnouncementNotificationRejectsAPayloadWithoutAnAnnouncement(t *testing.T) {
	queries := &stubAnnouncementQuerier{users: []uuid.UUID{uuid.New()}}
	tenantID := uuid.New()
	payload, err := json.Marshal(AnnouncementNotificationPayload{TenantID: tenantID.String()})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}

	handler := announcementNotificationHandler(AnnouncementNotificationHandlerConfig{}, queries)
	event := announcementEvent(t, tenantID, uuid.New(), "")
	event.Payload = payload

	if err := handler(context.Background(), event); !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
}

func announcementEvent(
	t *testing.T,
	tenantID, announcementID uuid.UUID,
	targetUserID string,
) dbmodels.OutboxEvent {
	t.Helper()

	payload, err := json.Marshal(AnnouncementNotificationPayload{
		TenantID:       tenantID.String(),
		AnnouncementID: announcementID.String(),
		TargetUserID:   targetUserID,
		Title:          "Scheduled maintenance",
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
	users          []uuid.UUID
	listedTenant   uuid.NullUUID
	listCalls      int
	listErr        error
	tenantUsers    map[uuid.UUID]struct{}
	resolvedTenant uuid.NullUUID
	resolveErr     error
	created        []dbmodels.CreateNotificationParams
	createErr      error
}

// GetTenantUserID answers only for the users the stub was given, so a target
// outside them reads the way the database reports one of another tenant.
func (s *stubAnnouncementQuerier) GetTenantUserID(
	_ context.Context,
	arg dbmodels.GetTenantUserIDParams,
) (uuid.UUID, error) {
	if s.resolveErr != nil {
		return uuid.Nil, s.resolveErr
	}
	s.resolvedTenant = arg.TenantID
	if _, ok := s.tenantUsers[arg.UserID]; !ok {
		return uuid.Nil, sql.ErrNoRows
	}
	return arg.UserID, nil
}

// ListTenantUserIDs answers the keyset the handler pages with, so a stub
// holding more than one page's worth is walked the way the database would be.
func (s *stubAnnouncementQuerier) ListTenantUserIDs(
	_ context.Context,
	arg dbmodels.ListTenantUserIDsParams,
) ([]uuid.UUID, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	s.listCalls++
	s.listedTenant = arg.TenantID

	start := 0
	if arg.AfterUserID != uuid.Nil {
		for i, id := range s.users {
			if id == arg.AfterUserID {
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
