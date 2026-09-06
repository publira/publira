package publishepisodes

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

func TestPublishSuccessEnqueuesOneMemberPushEvent(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	events := listMemberPushEvents(t, pg)
	if len(events) != 1 {
		t.Fatalf("member push events = %d, want 1", len(events))
	}
	event := events[0]
	wantKey := "push:" + notificationTypeEpisodePublished + ":episode:" + env.episode.PublicID
	if event.IdempotencyKey != wantKey {
		t.Fatalf("idempotency_key = %q, want %q", event.IdempotencyKey, wantKey)
	}
	if !event.TenantID.Valid || event.TenantID.UUID != env.tenant.ID {
		t.Fatalf("tenant_id = %v, want %s", event.TenantID, env.tenant.ID)
	}
	if event.Status != "pending" {
		t.Fatalf("status = %q, want pending", event.Status)
	}

	var payload outbox.MemberPushNotificationPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		t.Fatalf("payload: %v", err)
	}
	want := outbox.MemberPushNotificationPayload{
		TenantID:         env.tenant.ID.String(),
		NotificationType: notificationTypeEpisodePublished,
		SubjectKey:       "episode:" + env.episode.PublicID,
		SeriesID:         env.series.PublicID,
		SeriesTitle:      env.series.Title,
		EpisodeID:        env.episode.PublicID,
		EpisodeTitle:     env.episode.Title,
	}
	if payload != want {
		t.Fatalf("payload = %+v, want %+v", payload, want)
	}
}

func TestPublishRerunDoesNotEnqueueASecondMemberPushEvent(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	// The listing is published now, so a second cycle finds nothing due. Ask
	// for the same episode's push directly, which is what a re-run would do.
	if err := r.enqueueMemberPush(ctx, r.queries, env.readyRow(), "episode:"+env.episode.PublicID); err != nil {
		t.Fatalf("enqueue member push: %v", err)
	}

	if events := listMemberPushEvents(t, pg); len(events) != 1 {
		t.Fatalf("member push events = %d, want 1", len(events))
	}
}

func TestPublishWithoutMembersEnqueuesNoMemberPushEvent(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	deleteTenantMembers(t, pg, env.tenant.ID)
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusPublished {
		t.Fatalf("listing status = %q, want %s", got, testutil.EpisodeStatusPublished)
	}
	if events := listMemberPushEvents(t, pg); len(events) != 0 {
		t.Fatalf("member push events = %d, want 0", len(events))
	}
}

func deleteTenantMembers(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := pg.DB.ExecContext(ctx, `
		DELETE FROM users u
		WHERE u.tenant_id = $1
			AND NOT EXISTS (SELECT 1 FROM tenant_user_roles r WHERE r.user_id = u.id)
	`, tenantID)
	if err != nil {
		t.Fatalf("delete members: %v", err)
	}
}

func listMemberPushEvents(t *testing.T, pg *testutil.PostgresEnv) []dbmodels.OutboxEvent {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := pg.DB.QueryContext(ctx, `
		SELECT id, tenant_id, event_type, payload, idempotency_key, status
		FROM outbox_events
		WHERE event_type = $1
		ORDER BY idempotency_key
	`, outbox.EventTypeMemberPushNotification)
	if err != nil {
		t.Fatalf("list outbox events: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var events []dbmodels.OutboxEvent
	for rows.Next() {
		var event dbmodels.OutboxEvent
		if err := rows.Scan(
			&event.ID,
			&event.TenantID,
			&event.EventType,
			&event.Payload,
			&event.IdempotencyKey,
			&event.Status,
		); err != nil {
			t.Fatalf("scan outbox event: %v", err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("outbox events: %v", err)
	}
	return events
}
