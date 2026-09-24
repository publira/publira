package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// A tenant whose devices do not fit in one job is delivered to across as many
// jobs as it takes: the paging below leaves every job room for one page only.
// The event finishes without an attempt charged, and no device hears twice.
func TestMemberPushNotificationDeliversAcrossJobs(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "PUSHJOBS0001", "push-jobs.example.com", "Push Jobs Tenant")
	queries := dbmodels.New(pg.DB)
	const subjectKey = "episode:EPISODE00001"

	var tokens []string
	for i := range 5 {
		user := pg.SeedEndUser(t, tenant.ID, fmt.Sprintf("PUSHJOBSU%03d", i), fmt.Sprintf("reader%d@push-jobs.example.com", i), fmt.Sprintf("Reader %d", i))
		if err := queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
			ID:               uuid.Must(uuid.NewV7()),
			TenantID:         tenant.ID,
			UserID:           user.ID,
			NotificationType: "episode_published",
			SubjectKey:       subjectKey,
			Payload:          json.RawMessage(`{"episode_id":"EPISODE00001"}`),
		}); err != nil {
			t.Fatalf("CreateNotification: %v", err)
		}
		token := fmt.Sprintf("device-%d", i)
		if _, err := queries.UpsertUserPushDevice(ctx, dbmodels.UpsertUserPushDeviceParams{
			TenantID: tenant.ID,
			UserID:   user.ID,
			Token:    token,
			Platform: "android",
		}); err != nil {
			t.Fatalf("UpsertUserPushDevice: %v", err)
		}
		tokens = append(tokens, token)
	}

	payload, err := json.Marshal(MemberPushNotificationPayload{
		TenantID:         tenant.ID.String(),
		NotificationType: "episode_published",
		SubjectKey:       subjectKey,
		SeriesID:         "SERIES000001",
		SeriesTitle:      "Seed Series",
		EpisodeID:        "EPISODE00001",
		EpisodeTitle:     "Episode One",
	})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenant.ID, Valid: true},
		EventType:      EventTypeMemberPushNotification,
		Payload:        payload,
		IdempotencyKey: "push:episode_published:" + subjectKey,
		AvailableAt:    time.Now().UTC().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent: %v", err)
	}

	sender := &stubPushSender{}
	handlers := NewRegistry()
	handlers.Register(EventTypeMemberPushNotification, newMemberPushNotificationHandler(
		PushHandlerConfig{DB: pg.DB, Sender: sender},
		queries,
		memberPushPaging{pageSize: 2, sendTimeout: time.Second, reserve: time.Hour},
	))
	w, err := Start(ctx, pg.DB, Config{
		Handlers:          handlers,
		MaxAttempts:       1,
		DrainInterval:     50 * time.Millisecond,
		FetchCooldown:     10 * time.Millisecond,
		FetchPollInterval: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("start worker: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer stopCancel()
		if err := w.Stop(stopCtx); err != nil {
			t.Errorf("stop worker: %v", err)
		}
	})

	var got dbmodels.OutboxEvent
	for got.Status != StatusDone {
		if got.Status == StatusDead {
			t.Fatalf("event is dead: %s", got.LastError.String)
		}
		if ctx.Err() != nil {
			t.Fatalf("event status = %q after %d resumes, want %q", got.Status, w.Metrics().Resumed.Load(), StatusDone)
		}
		time.Sleep(20 * time.Millisecond)
		if got, err = queries.GetOutboxEvent(ctx, event.ID); err != nil {
			t.Fatalf("GetOutboxEvent: %v", err)
		}
	}

	if got.Attempts != 0 {
		t.Fatalf("attempts = %d, want 0", got.Attempts)
	}
	if resumed := w.Metrics().Resumed.Load(); resumed != 2 {
		t.Fatalf("resumes = %d, want one per page before the last (2)", resumed)
	}
	for _, token := range tokens {
		sender.sentTo(t, token)
	}
}
