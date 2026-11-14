package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestEpisodeSubjectKeysMatchWhatTheProducersFileUnder(t *testing.T) {
	reviewID := uuid.MustParse("01900000-0000-7000-8000-000000000001")
	if got := EpisodeSubjectKey("EPISODE00001"); got != "episode:EPISODE00001" {
		t.Fatalf("episode subject key = %q", got)
	}
	if got := EpisodeReviewSubjectKey(reviewID); got != "episode_review:"+reviewID.String() {
		t.Fatalf("review subject key = %q", got)
	}
	// Every window's staff alert key begins with the prefix the removal
	// deletes by, and another episode's does not.
	key := StaffCommentSubjectKey("EPISODE00001", time.Date(2026, 9, 8, 14, 30, 0, 0, time.UTC))
	if prefix := staffCommentSubjectKeyPrefix("EPISODE00001"); len(key) <= len(prefix) || key[:len(prefix)] != prefix {
		t.Fatalf("staff key %q does not begin with %q", key, prefix)
	}
	if prefix := staffCommentSubjectKeyPrefix("EPISODE0000"); key[:len(prefix)] == prefix {
		t.Fatalf("staff key %q begins with another episode's prefix %q", key, prefix)
	}
}

func TestEpisodeNotificationsRemovalDeletesEverySubjectInBatches(t *testing.T) {
	tenantID := uuid.New()
	reviewID := uuid.New()
	queries := &stubNotificationRemover{remaining: 5}
	handler := episodeNotificationsRemovalHandler(queries, 2)

	event := episodeNotificationsRemovalEvent(t, tenantID, EpisodeNotificationsRemoval{
		TenantID:         tenantID,
		EpisodePublicID:  "EPISODE00001",
		CommentPublicIDs: []string{"CMT000000001", "CMT000000002"},
		ReviewIDs:        []uuid.UUID{reviewID},
	})
	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler: %v", err)
	}

	var keys []string
	for _, call := range queries.bySubjects {
		if call.TenantID != tenantID {
			t.Fatalf("delete ran for tenant %s, want %s", call.TenantID, tenantID)
		}
		keys = append(keys, call.SubjectKeys...)
	}
	for _, want := range []string{"episode:EPISODE00001", "comment:CMT000000001", "comment:CMT000000002", "episode_review:" + reviewID.String()} {
		if !slices.Contains(keys, want) {
			t.Fatalf("subject keys deleted = %v, missing %q", keys, want)
		}
	}
	if len(queries.byPrefix) == 0 || queries.byPrefix[0].SubjectKeyPrefix != "episode:EPISODE00001:" {
		t.Fatalf("prefix deletes = %+v, want the episode's staff alert windows", queries.byPrefix)
	}
	// The first group had five rows to delete in batches of two, so it ran
	// until a batch came back short.
	if queries.firstGroupCalls != 3 {
		t.Fatalf("episode subject deletes = %d, want 3", queries.firstGroupCalls)
	}
}

// An episode with no comments and no returned rounds deletes by its own
// subjects alone, rather than sending an empty array.
func TestEpisodeNotificationsRemovalSkipsSubjectsItDoesNotName(t *testing.T) {
	tenantID := uuid.New()
	queries := &stubNotificationRemover{}
	handler := episodeNotificationsRemovalHandler(queries, 10)

	if err := handler(context.Background(), episodeNotificationsRemovalEvent(t, tenantID, EpisodeNotificationsRemoval{
		TenantID:        tenantID,
		EpisodePublicID: "EPISODE00001",
	})); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(queries.bySubjects) != 1 {
		t.Fatalf("subject deletes = %+v, want the episode's own", queries.bySubjects)
	}
	if len(queries.byPrefix) != 1 {
		t.Fatalf("prefix deletes = %+v, want one", queries.byPrefix)
	}
}

func TestEpisodeNotificationsRemovalRejectsAPoisonPayload(t *testing.T) {
	tenantID := uuid.New()
	cases := map[string]dbmodels.OutboxEvent{
		"another tenant": episodeNotificationsRemovalEvent(t, tenantID, EpisodeNotificationsRemoval{TenantID: uuid.New(), EpisodePublicID: "EPISODE00001"}),
		"no episode":     episodeNotificationsRemovalEvent(t, tenantID, EpisodeNotificationsRemoval{TenantID: tenantID}),
		"not json": {
			TenantID: uuid.NullUUID{UUID: tenantID, Valid: true},
			Payload:  []byte("{"),
		},
	}
	for name, event := range cases {
		t.Run(name, func(t *testing.T) {
			queries := &stubNotificationRemover{}
			err := episodeNotificationsRemovalHandler(queries, 10)(context.Background(), event)
			if !IsPermanent(err) {
				t.Fatalf("error = %v, want a permanent one", err)
			}
			if len(queries.bySubjects)+len(queries.byPrefix) != 0 {
				t.Fatal("a poison payload deleted notifications")
			}
		})
	}
}

func TestEpisodeNotificationsRemovalRetriesAFailedDelete(t *testing.T) {
	tenantID := uuid.New()
	queries := &stubNotificationRemover{err: errors.New("connection refused")}
	err := episodeNotificationsRemovalHandler(queries, 10)(context.Background(), episodeNotificationsRemovalEvent(t, tenantID, EpisodeNotificationsRemoval{
		TenantID:        tenantID,
		EpisodePublicID: "EPISODE00001",
	}))
	if err == nil || IsPermanent(err) {
		t.Fatalf("error = %v, want a retriable one", err)
	}
}

func TestQueueEpisodeNotificationsRemovalKeysTheEventOnTheEpisode(t *testing.T) {
	tenantID := uuid.New()
	queries := &stubCommentApprovedQueuer{}
	if err := QueueEpisodeNotificationsRemoval(context.Background(), queries, EpisodeNotificationsRemoval{
		TenantID:        tenantID,
		EpisodePublicID: "EPISODE00001",
	}); err != nil {
		t.Fatalf("queue: %v", err)
	}
	if len(queries.events) != 1 {
		t.Fatalf("events = %d, want 1", len(queries.events))
	}
	event := queries.events[0]
	if event.EventType != EventTypeEpisodeNotificationsRemoval {
		t.Fatalf("event type = %q", event.EventType)
	}
	if want := EpisodeNotificationsRemovalIdempotencyKey(tenantID, "EPISODE00001"); event.IdempotencyKey != want {
		t.Fatalf("idempotency key = %q, want %q", event.IdempotencyKey, want)
	}
	if !event.TenantID.Valid || event.TenantID.UUID != tenantID {
		t.Fatalf("tenant = %+v, want %s", event.TenantID, tenantID)
	}
}

func episodeNotificationsRemovalEvent(t *testing.T, tenantID uuid.UUID, r EpisodeNotificationsRemoval) dbmodels.OutboxEvent {
	t.Helper()
	payload, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:        uuid.New(),
		TenantID:  uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType: EventTypeEpisodeNotificationsRemoval,
		Payload:   payload,
		Status:    StatusProcessing,
	}
}

// stubNotificationRemover answers the first subject group's deletes out of
// remaining rows, and every other delete with none.
type stubNotificationRemover struct {
	remaining       int64
	firstGroupCalls int
	err             error
	bySubjects      []dbmodels.DeleteNotificationsBySubjectsParams
	byPrefix        []dbmodels.DeleteNotificationsBySubjectPrefixParams
}

func (s *stubNotificationRemover) DeleteNotificationsBySubjects(_ context.Context, arg dbmodels.DeleteNotificationsBySubjectsParams) (int64, error) {
	if s.err != nil {
		return 0, s.err
	}
	s.bySubjects = append(s.bySubjects, arg)
	if !slices.Contains(arg.NotificationTypes, NotificationTypeEpisodePublished) {
		return 0, nil
	}
	s.firstGroupCalls++
	deleted := min(s.remaining, int64(arg.BatchSize))
	s.remaining -= deleted
	return deleted, nil
}

func (s *stubNotificationRemover) DeleteNotificationsBySubjectPrefix(_ context.Context, arg dbmodels.DeleteNotificationsBySubjectPrefixParams) (int64, error) {
	if s.err != nil {
		return 0, s.err
	}
	s.byPrefix = append(s.byPrefix, arg)
	return 0, nil
}
