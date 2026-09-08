package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestStaffCommentSubjectKeyCollapsesAWholeHour(t *testing.T) {
	base := time.Date(2026, 9, 8, 14, 0, 0, 0, time.UTC)
	want := "episode:EPISODE00001:2026-09-08T14"

	for _, at := range []time.Time{
		base,
		base.Add(59*time.Minute + 59*time.Second),
		// A producer in another zone reports the same instant, so the window it
		// lands in has to be the same one.
		base.Add(30 * time.Minute).In(time.FixedZone("JST", 9*60*60)),
	} {
		if got := StaffCommentSubjectKey("EPISODE00001", at); got != want {
			t.Fatalf("subject key at %s = %q, want %q", at, got, want)
		}
	}

	if got := StaffCommentSubjectKey("EPISODE00001", base.Add(time.Hour)); got == want {
		t.Fatalf("the next hour reused the key %q", got)
	}
}

func TestStaffCommentIdempotencyKeySeparatesQueuesAndTenants(t *testing.T) {
	first := uuid.New()
	second := uuid.New()
	subjectKey := StaffCommentSubjectKey("EPISODE00001", time.Now())

	awaiting := StaffCommentIdempotencyKey(EventTypeCommentAwaitingApprovalNotification, first, subjectKey)
	reported := StaffCommentIdempotencyKey(EventTypeCommentReportedNotification, first, subjectKey)
	if awaiting == reported {
		t.Fatalf("the approval queue and the report queue share the key %q", awaiting)
	}

	// outbox_events.idempotency_key is unique across every tenant, so two
	// tenants whose episodes carry the same public ID must not collapse into
	// one event.
	other := StaffCommentIdempotencyKey(EventTypeCommentAwaitingApprovalNotification, second, subjectKey)
	if awaiting == other {
		t.Fatalf("two tenants share the key %q", awaiting)
	}
}

func TestStaffCommentNotificationWritesOneRowPerStaffMember(t *testing.T) {
	tenantID := uuid.New()
	first := uuid.New()
	second := uuid.New()
	queries := &stubStaffNotificationQuerier{staff: []uuid.UUID{first, second}}

	handler := staffCommentNotificationHandler(
		StaffNotificationHandlerConfig{}, NotificationTypeCommentAwaitingApproval, queries)
	if err := handler(context.Background(), staffCommentEvent(t, tenantID, EventTypeCommentAwaitingApprovalNotification)); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(queries.created) != 2 {
		t.Fatalf("notifications written = %d, want 2", len(queries.created))
	}
	if queries.listed != tenantID {
		t.Fatalf("staff looked up for %s, want %s", queries.listed, tenantID)
	}
	for i, recipient := range []uuid.UUID{first, second} {
		row := queries.created[i]
		if row.UserID != recipient {
			t.Fatalf("notification %d addressed %s, want %s", i, row.UserID, recipient)
		}
		if row.TenantID != tenantID {
			t.Fatalf("notification %d carries tenant %s, want %s", i, row.TenantID, tenantID)
		}
		if row.NotificationType != NotificationTypeCommentAwaitingApproval {
			t.Fatalf("notification %d type = %q", i, row.NotificationType)
		}
		if row.SubjectKey != "episode:EPISODE00001:2026-09-08T14" {
			t.Fatalf("notification %d subject_key = %q", i, row.SubjectKey)
		}
	}

	// The console assembles its copy from the type plus these fields, so the
	// alert has to carry the catalog names and nothing the event used to route
	// itself.
	var body map[string]string
	if err := json.Unmarshal(queries.created[0].Payload, &body); err != nil {
		t.Fatalf("decode notification payload: %v", err)
	}
	want := map[string]string{
		"episode_id":    "EPISODE00001",
		"episode_title": "Episode Three",
		"series_id":     "SERIES000001",
		"series_title":  "Seed Series",
	}
	for key, value := range want {
		if body[key] != value {
			t.Fatalf("payload[%q] = %q, want %q", key, body[key], value)
		}
	}
	if len(body) != len(want) {
		t.Fatalf("payload = %v, want exactly %v", body, want)
	}
}

func TestStaffCommentNotificationWritesTheReportedType(t *testing.T) {
	tenantID := uuid.New()
	queries := &stubStaffNotificationQuerier{staff: []uuid.UUID{uuid.New()}}

	handler := staffCommentNotificationHandler(
		StaffNotificationHandlerConfig{}, NotificationTypeCommentReported, queries)
	if err := handler(context.Background(), staffCommentEvent(t, tenantID, EventTypeCommentReportedNotification)); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if got := queries.created[0].NotificationType; got != NotificationTypeCommentReported {
		t.Fatalf("notification type = %q, want %q", got, NotificationTypeCommentReported)
	}
}

func TestStaffCommentNotificationTreatsAnExistingRowAsDone(t *testing.T) {
	// A redelivered event finds this window's row already written for everyone,
	// which CreateNotification reports as no rows rather than as a failure.
	queries := &stubStaffNotificationQuerier{
		staff:     []uuid.UUID{uuid.New()},
		createErr: sql.ErrNoRows,
	}

	handler := staffCommentNotificationHandler(
		StaffNotificationHandlerConfig{}, NotificationTypeCommentAwaitingApproval, queries)
	if err := handler(context.Background(), staffCommentEvent(t, uuid.New(), EventTypeCommentAwaitingApprovalNotification)); err != nil {
		t.Fatalf("handler: %v", err)
	}
}

func TestStaffCommentNotificationCompletesWhenTheTenantHasNoStaff(t *testing.T) {
	queries := &stubStaffNotificationQuerier{}

	handler := staffCommentNotificationHandler(
		StaffNotificationHandlerConfig{}, NotificationTypeCommentReported, queries)
	if err := handler(context.Background(), staffCommentEvent(t, uuid.New(), EventTypeCommentReportedNotification)); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.created) != 0 {
		t.Fatalf("notifications written = %d, want 0", len(queries.created))
	}
}

func TestStaffCommentNotificationRetriesAFailedLookup(t *testing.T) {
	queries := &stubStaffNotificationQuerier{listErr: errors.New("connection refused")}

	handler := staffCommentNotificationHandler(
		StaffNotificationHandlerConfig{}, NotificationTypeCommentReported, queries)
	err := handler(context.Background(), staffCommentEvent(t, uuid.New(), EventTypeCommentReportedNotification))
	if err == nil {
		t.Fatal("handler error = nil, want a retriable error")
	}
	if IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable error", err)
	}
}

func TestStaffCommentNotificationRejectsAPayloadNamingAnotherTenant(t *testing.T) {
	queries := &stubStaffNotificationQuerier{staff: []uuid.UUID{uuid.New()}}

	handler := staffCommentNotificationHandler(
		StaffNotificationHandlerConfig{}, NotificationTypeCommentAwaitingApproval, queries)
	event := staffCommentEvent(t, uuid.New(), EventTypeCommentAwaitingApprovalNotification)
	event.TenantID = uuid.NullUUID{UUID: uuid.New(), Valid: true}

	err := handler(context.Background(), event)
	if !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
	if len(queries.created) != 0 {
		t.Fatalf("notifications written = %d, want 0", len(queries.created))
	}
}

func TestStaffCommentNotificationRejectsAPayloadWithoutASubject(t *testing.T) {
	queries := &stubStaffNotificationQuerier{staff: []uuid.UUID{uuid.New()}}
	tenantID := uuid.New()
	payload, err := json.Marshal(StaffCommentNotificationPayload{TenantID: tenantID.String()})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}

	handler := staffCommentNotificationHandler(
		StaffNotificationHandlerConfig{}, NotificationTypeCommentAwaitingApproval, queries)
	event := staffCommentEvent(t, tenantID, EventTypeCommentAwaitingApprovalNotification)
	event.Payload = payload

	if err := handler(context.Background(), event); !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
}

func staffCommentEvent(t *testing.T, tenantID uuid.UUID, eventType string) dbmodels.OutboxEvent {
	t.Helper()

	subjectKey := StaffCommentSubjectKey("EPISODE00001", time.Date(2026, 9, 8, 14, 30, 0, 0, time.UTC))
	payload, err := json.Marshal(StaffCommentNotificationPayload{
		TenantID:     tenantID.String(),
		SubjectKey:   subjectKey,
		EpisodeID:    "EPISODE00001",
		EpisodeTitle: "Episode Three",
		SeriesID:     "SERIES000001",
		SeriesTitle:  "Seed Series",
	})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.New(),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      eventType,
		Payload:        payload,
		IdempotencyKey: StaffCommentIdempotencyKey(eventType, tenantID, subjectKey),
		Status:         StatusProcessing,
	}
}

type stubStaffNotificationQuerier struct {
	staff     []uuid.UUID
	listed    uuid.UUID
	listErr   error
	created   []dbmodels.CreateNotificationParams
	createErr error
}

func (s *stubStaffNotificationQuerier) ListTenantAdminIDs(_ context.Context, tenantID uuid.UUID) ([]uuid.UUID, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	s.listed = tenantID
	return s.staff, nil
}

func (s *stubStaffNotificationQuerier) CreateNotification(
	_ context.Context,
	arg dbmodels.CreateNotificationParams,
) (dbmodels.Notification, error) {
	if s.createErr != nil {
		return dbmodels.Notification{}, s.createErr
	}
	s.created = append(s.created, arg)
	return dbmodels.Notification{ID: arg.ID}, nil
}
