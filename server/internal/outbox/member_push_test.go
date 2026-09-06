package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/push"
)

func TestMemberPushNotificationSendsOneMessagePerDevice(t *testing.T) {
	tenantID := uuid.New()
	first := uuid.New()
	second := uuid.New()
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: first, UserID: uuid.New(), Token: "token-a", Platform: "android"},
		{NotificationID: second, UserID: uuid.New(), Token: "token-b", Platform: "ios"},
	}}
	sender := &stubPushSender{}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries)
	if err := handler(context.Background(), memberPushEvent(t, tenantID, "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(sender.sent) != 2 {
		t.Fatalf("messages sent = %d, want 2", len(sender.sent))
	}
	if got := queries.listed.NotificationType; got != "episode_published" {
		t.Fatalf("listed notification_type = %q", got)
	}
	if got := queries.listed.SubjectKey; got != "episode:EPISODE00001" {
		t.Fatalf("listed subject_key = %q", got)
	}
	if queries.listed.TenantID != tenantID {
		t.Fatalf("listed tenant_id = %s, want %s", queries.listed.TenantID, tenantID)
	}

	message := sender.sent[0]
	if message.Token != "token-a" {
		t.Fatalf("token = %q", message.Token)
	}
	if message.Title != "Seed Series" || message.Body != "Episode Three" {
		t.Fatalf("title/body = %q / %q", message.Title, message.Body)
	}
	want := map[string]string{
		"notification_id":   first.String(),
		"notification_type": "episode_published",
		"series_id":         "SERIES000001",
		"episode_id":        "EPISODE00001",
		"route":             "/series/SERIES000001/episodes/EPISODE00001",
	}
	for key, value := range want {
		if message.Data[key] != value {
			t.Fatalf("data[%q] = %q, want %q", key, message.Data[key], value)
		}
	}
	if len(message.Data) != len(want) {
		t.Fatalf("data = %v, want exactly %v", message.Data, want)
	}
	if sender.sent[1].Data["notification_id"] != second.String() {
		t.Fatalf("second message mirrors %q, want %s", sender.sent[1].Data["notification_id"], second)
	}
}

func TestMemberPushNotificationSkipsATypeThatIsNotPushed(t *testing.T) {
	queries := &stubPushDeviceQuerier{}
	sender := &stubPushSender{}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries)
	event := memberPushEvent(t, uuid.New(), "episode_publish_failed")
	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if queries.listCalls != 0 {
		t.Fatalf("device lookups = %d, want 0", queries.listCalls)
	}
	if len(sender.sent) != 0 {
		t.Fatalf("messages sent = %d, want 0", len(sender.sent))
	}
}

func TestMemberPushNotificationDeletesARevokedToken(t *testing.T) {
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "revoked", Platform: "android"},
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "live", Platform: "android"},
	}}
	sender := &stubPushSender{errs: map[string]error{"revoked": push.ErrTokenGone}}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries)
	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(queries.deleted) != 1 || queries.deleted[0] != "revoked" {
		t.Fatalf("deleted tokens = %v, want [revoked]", queries.deleted)
	}
}

func TestMemberPushNotificationRetriesWhenNothingWasDelivered(t *testing.T) {
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-a", Platform: "android"},
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-b", Platform: "android"},
	}}
	sender := &stubPushSender{errs: map[string]error{
		"token-a": errors.New("fcm is unavailable"),
		"token-b": errors.New("fcm is unavailable"),
	}}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries)
	err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published"))
	if err == nil {
		t.Fatal("handler error = nil, want an error")
	}
	if IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable error", err)
	}
	if len(queries.deleted) != 0 {
		t.Fatalf("deleted tokens = %v, want none", queries.deleted)
	}
}

func TestMemberPushNotificationCompletesWhenSomeDevicesTookIt(t *testing.T) {
	// A retry would re-send to every device that already took the message,
	// once per remaining attempt of the retry budget. A run that reached
	// someone therefore completes, and the devices it could not reach lose
	// this alert rather than every other reader being notified ten times.
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-a", Platform: "android"},
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-b", Platform: "android"},
	}}
	sender := &stubPushSender{errs: map[string]error{"token-b": errors.New("fcm rate limit")}}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries)
	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(sender.sent) != 1 || sender.sent[0].Token != "token-a" {
		t.Fatalf("messages sent = %+v, want only token-a", sender.sent)
	}
}

func TestMemberPushNotificationCompletesWhenOnlyARevokedTokenFailed(t *testing.T) {
	// Deleting a revoked device settles it as surely as a delivery does, so an
	// event whose every device is revoked has nothing left to retry for.
	queries := &stubPushDeviceQuerier{devices: []dbmodels.ListPushDevicesForNotificationRow{
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "revoked", Platform: "android"},
		{NotificationID: uuid.New(), UserID: uuid.New(), Token: "token-b", Platform: "android"},
	}}
	sender := &stubPushSender{errs: map[string]error{
		"revoked": push.ErrTokenGone,
		"token-b": errors.New("fcm rate limit"),
	}}

	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: sender}, queries)
	if err := handler(context.Background(), memberPushEvent(t, uuid.New(), "episode_published")); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.deleted) != 1 || queries.deleted[0] != "revoked" {
		t.Fatalf("deleted tokens = %v, want [revoked]", queries.deleted)
	}
}

func TestMemberPushNotificationRejectsAPayloadNamingAnotherTenant(t *testing.T) {
	queries := &stubPushDeviceQuerier{}
	handler := newMemberPushNotificationHandler(PushHandlerConfig{Sender: &stubPushSender{}}, queries)

	event := memberPushEvent(t, uuid.New(), "episode_published")
	event.TenantID = uuid.NullUUID{UUID: uuid.New(), Valid: true}
	err := handler(context.Background(), event)
	if !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
}

func memberPushEvent(t *testing.T, tenantID uuid.UUID, notificationType string) dbmodels.OutboxEvent {
	t.Helper()
	payload, err := json.Marshal(MemberPushNotificationPayload{
		TenantID:         tenantID.String(),
		NotificationType: notificationType,
		SubjectKey:       "episode:EPISODE00001",
		SeriesID:         "SERIES000001",
		SeriesTitle:      "Seed Series",
		EpisodeID:        "EPISODE00001",
		EpisodeTitle:     "Episode Three",
	})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.New(),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      EventTypeMemberPushNotification,
		Payload:        payload,
		IdempotencyKey: "push:" + notificationType + ":episode:EPISODE00001",
		Status:         StatusProcessing,
	}
}

type stubPushDeviceQuerier struct {
	devices   []dbmodels.ListPushDevicesForNotificationRow
	listed    dbmodels.ListPushDevicesForNotificationParams
	listCalls int
	deleted   []string
}

func (s *stubPushDeviceQuerier) ListPushDevicesForNotification(
	_ context.Context,
	arg dbmodels.ListPushDevicesForNotificationParams,
) ([]dbmodels.ListPushDevicesForNotificationRow, error) {
	s.listCalls++
	s.listed = arg
	return s.devices, nil
}

func (s *stubPushDeviceQuerier) DeleteUserPushDeviceByToken(_ context.Context, token string) (int64, error) {
	s.deleted = append(s.deleted, token)
	return 1, nil
}

type stubPushSender struct {
	sent []push.Message
	errs map[string]error
}

func (s *stubPushSender) Send(_ context.Context, message push.Message) error {
	if err, ok := s.errs[message.Token]; ok {
		return err
	}
	s.sent = append(s.sent, message)
	return nil
}
