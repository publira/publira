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

func TestEpisodePublishedNotificationWritesOneRowPerFollowerAndOnePush(t *testing.T) {
	tenantID := uuid.New()
	episodeID := uuid.New()
	first := uuid.New()
	second := uuid.New()
	queries := newStubEpisodePublishedQuerier(episodeID, first, second)

	handler := episodePublishedNotificationHandler(EpisodePublishedNotificationHandlerConfig{}, queries, DefaultEpisodeFollowerPageSize)
	if err := handler(context.Background(), episodePublishedEvent(t, tenantID, episodeID)); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if queries.lookedUp != (dbmodels.GetPublishedEpisodeForFollowerNotificationParams{TenantID: tenantID, ID: episodeID}) {
		t.Fatalf("episode looked up as %+v", queries.lookedUp)
	}
	if len(queries.created) != 2 {
		t.Fatalf("notifications written = %d, want 2", len(queries.created))
	}
	for i, recipient := range []uuid.UUID{first, second} {
		row := queries.created[i]
		if row.UserID != recipient || row.TenantID != tenantID {
			t.Fatalf("notification %d addressed %s in %s, want %s in %s", i, row.UserID, row.TenantID, recipient, tenantID)
		}
		if row.NotificationType != NotificationTypeEpisodePublished {
			t.Fatalf("notification %d type = %q", i, row.NotificationType)
		}
		if row.SubjectKey != "episode:EP001" {
			t.Fatalf("notification %d subject_key = %q", i, row.SubjectKey)
		}
	}
	var body EpisodePublishedNotificationBody
	if err := json.Unmarshal(queries.created[0].Payload, &body); err != nil {
		t.Fatalf("decode notification payload: %v", err)
	}
	wantBody := EpisodePublishedNotificationBody{
		EpisodeID:    "EP001",
		EpisodeTitle: "Episode 1",
		SeriesID:     "SERIES001",
		SeriesTitle:  "Series",
	}
	if body != wantBody {
		t.Fatalf("payload = %+v, want %+v", body, wantBody)
	}

	if len(queries.outbox) != 1 {
		t.Fatalf("outbox events = %d, want 1", len(queries.outbox))
	}
	push := queries.outbox[0]
	if push.EventType != EventTypeMemberPushNotification {
		t.Fatalf("outbox event type = %q, want %q", push.EventType, EventTypeMemberPushNotification)
	}
	if push.IdempotencyKey != "push:episode_published:episode:EP001" {
		t.Fatalf("push idempotency_key = %q", push.IdempotencyKey)
	}
	if !push.TenantID.Valid || push.TenantID.UUID != tenantID {
		t.Fatalf("push tenant_id = %v, want %s", push.TenantID, tenantID)
	}
}

func TestEpisodePublishedNotificationWalksEveryFollowerPage(t *testing.T) {
	episodeID := uuid.New()
	queries := newStubEpisodePublishedQuerier(episodeID, uuid.New(), uuid.New(), uuid.New())

	handler := episodePublishedNotificationHandler(EpisodePublishedNotificationHandlerConfig{}, queries, 2)
	if err := handler(context.Background(), episodePublishedEvent(t, uuid.New(), episodeID)); err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(queries.created) != 3 {
		t.Fatalf("notifications written = %d, want 3", len(queries.created))
	}
	if queries.listCalls != 2 {
		t.Fatalf("follower pages read = %d, want 2", queries.listCalls)
	}
}

func TestEpisodePublishedNotificationQueuesNoPushWithoutFollowers(t *testing.T) {
	episodeID := uuid.New()
	queries := newStubEpisodePublishedQuerier(episodeID)

	handler := episodePublishedNotificationHandler(EpisodePublishedNotificationHandlerConfig{}, queries, DefaultEpisodeFollowerPageSize)
	if err := handler(context.Background(), episodePublishedEvent(t, uuid.New(), episodeID)); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.created) != 0 || len(queries.outbox) != 0 {
		t.Fatalf("notifications, outbox events = %d, %d, want 0, 0", len(queries.created), len(queries.outbox))
	}
}

func TestEpisodePublishedNotificationCompletesForAnEpisodeNoLongerPublished(t *testing.T) {
	queries := newStubEpisodePublishedQuerier(uuid.New(), uuid.New())
	queries.getErr = sql.ErrNoRows

	handler := episodePublishedNotificationHandler(EpisodePublishedNotificationHandlerConfig{}, queries, DefaultEpisodeFollowerPageSize)
	if err := handler(context.Background(), episodePublishedEvent(t, uuid.New(), uuid.New())); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.created) != 0 || len(queries.outbox) != 0 {
		t.Fatalf("notifications, outbox events = %d, %d, want 0, 0", len(queries.created), len(queries.outbox))
	}
}

func TestEpisodePublishedNotificationRetriesAFailedLookup(t *testing.T) {
	queries := newStubEpisodePublishedQuerier(uuid.New())
	queries.getErr = errors.New("connection refused")

	handler := episodePublishedNotificationHandler(EpisodePublishedNotificationHandlerConfig{}, queries, DefaultEpisodeFollowerPageSize)
	err := handler(context.Background(), episodePublishedEvent(t, uuid.New(), uuid.New()))
	if err == nil || IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable error", err)
	}
}

func TestEpisodePublishedNotificationRejectsAPayloadNamingAnotherTenant(t *testing.T) {
	episodeID := uuid.New()
	queries := newStubEpisodePublishedQuerier(episodeID, uuid.New())

	handler := episodePublishedNotificationHandler(EpisodePublishedNotificationHandlerConfig{}, queries, DefaultEpisodeFollowerPageSize)
	event := episodePublishedEvent(t, uuid.New(), episodeID)
	event.TenantID = uuid.NullUUID{UUID: uuid.New(), Valid: true}

	if err := handler(context.Background(), event); !IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
	if len(queries.created) != 0 {
		t.Fatalf("notifications written = %d, want 0", len(queries.created))
	}
}

func episodePublishedEvent(t *testing.T, tenantID, episodeID uuid.UUID) dbmodels.OutboxEvent {
	t.Helper()

	payload, err := json.Marshal(EpisodePublishedNotificationPayload{
		TenantID:  tenantID.String(),
		EpisodeID: episodeID.String(),
	})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.New(),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      EventTypeEpisodePublishedNotification,
		Payload:        payload,
		IdempotencyKey: EpisodePublishedIdempotencyKey(episodeID),
		Status:         StatusProcessing,
	}
}

type stubEpisodePublishedQuerier struct {
	episode   dbmodels.GetPublishedEpisodeForFollowerNotificationRow
	getErr    error
	lookedUp  dbmodels.GetPublishedEpisodeForFollowerNotificationParams
	followers []uuid.UUID
	listCalls int
	created   []dbmodels.CreateNotificationParams
	outbox    []dbmodels.InsertOutboxEventParams
}

func newStubEpisodePublishedQuerier(episodeID uuid.UUID, followers ...uuid.UUID) *stubEpisodePublishedQuerier {
	return &stubEpisodePublishedQuerier{
		episode: dbmodels.GetPublishedEpisodeForFollowerNotificationRow{
			EpisodeID:       episodeID,
			EpisodePublicID: "EP001",
			EpisodeTitle:    "Episode 1",
			SeriesPublicID:  "SERIES001",
			SeriesTitle:     "Series",
		},
		followers: followers,
	}
}

func (s *stubEpisodePublishedQuerier) GetPublishedEpisodeForFollowerNotification(
	_ context.Context,
	arg dbmodels.GetPublishedEpisodeForFollowerNotificationParams,
) (dbmodels.GetPublishedEpisodeForFollowerNotificationRow, error) {
	s.lookedUp = arg
	if s.getErr != nil {
		return dbmodels.GetPublishedEpisodeForFollowerNotificationRow{}, s.getErr
	}
	return s.episode, nil
}

// ListEpisodeFollowerIDs answers the keyset the fan-out pages with, so a stub
// holding more than one page's worth is walked the way the database would be.
func (s *stubEpisodePublishedQuerier) ListEpisodeFollowerIDs(
	_ context.Context,
	arg dbmodels.ListEpisodeFollowerIDsParams,
) ([]uuid.UUID, error) {
	s.listCalls++
	start := 0
	if arg.AfterUserID != uuid.Nil {
		for i, id := range s.followers {
			if id == arg.AfterUserID {
				start = i + 1
				break
			}
		}
	}
	end := min(start+int(arg.Limit), len(s.followers))
	return s.followers[start:end], nil
}

func (s *stubEpisodePublishedQuerier) CreateNotification(
	_ context.Context,
	arg dbmodels.CreateNotificationParams,
) error {
	s.created = append(s.created, arg)
	return nil
}

func (s *stubEpisodePublishedQuerier) InsertOutboxEvent(
	_ context.Context,
	arg dbmodels.InsertOutboxEventParams,
) (dbmodels.OutboxEvent, error) {
	s.outbox = append(s.outbox, arg)
	return dbmodels.OutboxEvent{}, nil
}
