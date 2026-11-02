package scheduledannouncements

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/testutil"
)

type recordedDrop struct {
	tenantID uuid.UUID
	tags     []string
}

type stubRecorder struct {
	drops []recordedDrop
}

func (s *stubRecorder) Record(_ context.Context, _ revalidate.OutboxQuerier, tenantID uuid.UUID, tags []string) (revalidate.Owed, error) {
	s.drops = append(s.drops, recordedDrop{tenantID: tenantID, tags: tags})
	return revalidate.Owed{}, nil
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// insertScheduledAnnouncement writes an announcement the console scheduled
// for deliverAt and has not delivered.
func insertScheduledAnnouncement(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, deliverAt time.Time, pinned bool, audience *string) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(t.Context(), `
		INSERT INTO announcements (id, tenant_id, announcement_type, pinned, audience, deliver_at, delivered_at)
		VALUES ($1, $2, 'announcement', $3, $4::jsonb, $5, NULL)
	`, id, tenantID, pinned, audience, deliverAt); err != nil {
		t.Fatalf("insert scheduled announcement: %v", err)
	}
	return id
}

func deliveredAt(t *testing.T, pg *testutil.PostgresEnv, id uuid.UUID) sql.NullTime {
	t.Helper()
	var at sql.NullTime
	if err := pg.DB.QueryRowContext(t.Context(), "SELECT delivered_at FROM announcements WHERE id = $1", id).Scan(&at); err != nil {
		t.Fatalf("read delivered_at: %v", err)
	}
	return at
}

func queuedKeys(t *testing.T, pg *testutil.PostgresEnv) []string {
	t.Helper()
	rows, err := pg.DB.QueryContext(t.Context(), `
		SELECT idempotency_key FROM outbox_events
		WHERE event_type IN ($1, $2)
		ORDER BY idempotency_key
	`, outbox.EventTypeAnnouncementNotification, outbox.EventTypeTargetedAnnouncementNotification)
	if err != nil {
		t.Fatalf("list announcement events: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			t.Fatalf("scan announcement event: %v", err)
		}
		keys = append(keys, key)
	}
	return keys
}

// A pass delivers every announcement whose time has passed, on the ticker
// role's own connection: it records the announcement as delivered, queues the
// event of the type its audience calls for, and owes the drops of the inboxes
// and, for a pinned one, of the banner. An announcement whose time is still
// ahead is left as it is, and a second pass finds nothing left to deliver.
func TestRunOnceDeliversEveryAnnouncementThatIsDue(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "SCHEDANN0001", "scheduled.example.com", "Scheduled Tenant")
	audience := `{"version": 1, "conditions": [{"type": "never_purchased"}]}`
	pinned := insertScheduledAnnouncement(t, pg, tenant.ID, time.Now().Add(-time.Minute), true, nil)
	targeted := insertScheduledAnnouncement(t, pg, tenant.ID, time.Now().Add(-2*time.Minute), false, &audience)
	later := insertScheduledAnnouncement(t, pg, tenant.ID, time.Now().Add(time.Hour), false, nil)

	reval := &stubRecorder{}
	runner := New(pg.OpenTickerDB(t), reval, quietLogger())
	runner.RunOnce(t.Context())

	for _, id := range []uuid.UUID{pinned, targeted} {
		if !deliveredAt(t, pg, id).Valid {
			t.Fatalf("announcement %s was not delivered", id)
		}
	}
	if deliveredAt(t, pg, later).Valid {
		t.Fatalf("announcement %s was delivered before its time", later)
	}
	wantKeys := []string{outbox.AnnouncementIdempotencyKey(pinned), outbox.TargetedAnnouncementIdempotencyKey(targeted)}
	slices.Sort(wantKeys)
	if got := queuedKeys(t, pg); !slices.Equal(got, wantKeys) {
		t.Fatalf("queued %v, want %v", got, wantKeys)
	}
	// The listing is ordered by deliver_at, so the targeted one, due first, is
	// delivered first.
	wantDrops := []recordedDrop{
		{tenantID: tenant.ID, tags: RevalidateTags(tenant.ID, false)},
		{tenantID: tenant.ID, tags: RevalidateTags(tenant.ID, true)},
	}
	if !slices.EqualFunc(reval.drops, wantDrops, func(a, b recordedDrop) bool {
		return a.tenantID == b.tenantID && slices.Equal(a.tags, b.tags)
	}) {
		t.Fatalf("drops = %v, want %v", reval.drops, wantDrops)
	}

	runner.RunOnce(t.Context())
	if got := queuedKeys(t, pg); !slices.Equal(got, wantKeys) {
		t.Fatalf("a second pass queued %v, want only %v", got, wantKeys)
	}
	if len(reval.drops) != len(wantDrops) {
		t.Fatalf("a second pass owed %d more drops, want none", len(reval.drops)-len(wantDrops))
	}
}

// An announcement the console delivered, deleted, or put off to a later time
// after the listing is passed over: the mark finds no row still due, and
// nothing is queued.
func TestDeliverPassesOverAnAnnouncementNoLongerDue(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "SCHEDANN0002", "passed-over.example.com", "Passed Over Tenant")
	for _, tc := range []struct {
		name   string
		change string
	}{
		{"delivered", "UPDATE announcements SET delivered_at = now() WHERE id = $1"},
		{"deleted", "DELETE FROM announcements WHERE id = $1"},
		{"put off", "UPDATE announcements SET deliver_at = now() + interval '1 hour' WHERE id = $1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := insertScheduledAnnouncement(t, pg, tenant.ID, time.Now().Add(-time.Minute), false, nil)
			if _, err := pg.DB.ExecContext(t.Context(), tc.change, id); err != nil {
				t.Fatalf("change announcement: %v", err)
			}

			reval := &stubRecorder{}
			delivered, err := New(pg.OpenTickerDB(t), reval, quietLogger()).deliver(t.Context(), id)
			if err != nil {
				t.Fatalf("deliver: %v", err)
			}
			if delivered {
				t.Fatal("deliver reported an announcement no longer due as delivered")
			}
			if got := queuedKeys(t, pg); len(got) != 0 {
				t.Fatalf("queued %v, want nothing", got)
			}
			if len(reval.drops) != 0 {
				t.Fatalf("owed %v, want nothing", reval.drops)
			}
		})
	}
}
