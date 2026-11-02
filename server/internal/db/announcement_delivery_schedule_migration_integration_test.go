package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before an
// announcement could be scheduled, and the one that added its delivery times.
const (
	beforeAnnouncementDeliveryScheduleVersion = 20261102140921
	announcementDeliveryScheduleVersion       = 20261102153957
)

// Every announcement already posted comes out of the migration delivered when
// it was created, with no time asked for. A row the previous release's
// CreateAnnouncement writes afterwards, naming neither column, reads as
// delivered as it commits, since that release queued its event in the same
// transaction.
func TestAnnouncementDeliveryScheduleMigrationDeliversWhatWasPosted(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	pg.MigrateTo(t, beforeAnnouncementDeliveryScheduleVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := pg.DB

	tenant := pg.SeedTenantOnOlderSchema(t, "TENANTSCHED", "tenant-sched.example.com", "Tenant Sched")
	createdAt := time.Date(2026, 10, 30, 9, 0, 0, 0, time.UTC)
	mustExec(t, ctx, db, `
		INSERT INTO announcements (id, tenant_id, announcement_type, created_at)
		VALUES ('018f0f10-0000-7000-8000-0000000000a1', $1, 'announcement', $2)
	`, tenant.ID, createdAt)

	pg.MigrateTo(t, announcementDeliveryScheduleVersion)

	var deliverAt, deliveredAt sql.NullTime
	if err := db.QueryRowContext(ctx, `
		SELECT deliver_at, delivered_at FROM announcements WHERE id = '018f0f10-0000-7000-8000-0000000000a1'
	`).Scan(&deliverAt, &deliveredAt); err != nil {
		t.Fatalf("read existing announcement: %v", err)
	}
	if deliverAt.Valid {
		t.Fatalf("deliver_at = %v, want none on an announcement nobody scheduled", deliverAt.Time)
	}
	if !deliveredAt.Valid || !deliveredAt.Time.Equal(createdAt) {
		t.Fatalf("delivered_at = %v, want created_at %v", deliveredAt, createdAt)
	}

	mustExec(t, ctx, db, `
		INSERT INTO announcements (id, tenant_id, announcement_type)
		VALUES ('018f0f10-0000-7000-8000-0000000000a2', $1, 'announcement')
	`, tenant.ID)
	if err := db.QueryRowContext(ctx, `
		SELECT delivered_at FROM announcements WHERE id = '018f0f10-0000-7000-8000-0000000000a2'
	`).Scan(&deliveredAt); err != nil {
		t.Fatalf("read announcement written without the columns: %v", err)
	}
	if !deliveredAt.Valid {
		t.Fatal("delivered_at is empty on a row written without it, want it delivered as it commits")
	}
}
