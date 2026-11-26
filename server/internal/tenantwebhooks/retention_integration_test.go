package tenantwebhooks_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantwebhooks"
	"github.com/publira/publira/server/internal/testutil"
)

// seedEndpoint saves an enabled endpoint of tenantID's subscribed to events.
func seedEndpoint(t *testing.T, ctx context.Context, pg *testutil.PostgresEnv, tenantID uuid.UUID, events ...string) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $2, 'https://crm.example.com/publira', 'sealed', 'whsec_••••', $3)
	`, id, tenantID, events); err != nil {
		t.Fatalf("insert webhook endpoint: %v", err)
	}
	return id
}

// A delivery whose payload names a reader — their address, their name — goes
// with the reader's account, whichever path deletes it, and one about no
// reader stays.
func TestDeliveriesNamingAReaderGoWithTheirAccount(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "HOOKKEEP01", "hook-keep.example.com", "Hook Keep")
	reader := pg.SeedEndUser(t, tenant.ID, "HOOKKEEPU1", "leaving@example.com", "Leaving reader")
	other := pg.SeedEndUser(t, tenant.ID, "HOOKKEEPU2", "staying@example.com", "Staying reader")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{Price: 500, Status: testutil.EpisodeStatusPublished})
	pg.SeedPurchase(t, tenant.ID, reader.ID, episode.ID, 500)
	var purchaseID uuid.UUID
	if err := pg.DB.QueryRowContext(ctx, `SELECT id FROM purchases WHERE tenant_id = $1 AND user_id = $2`, tenant.ID, reader.ID).Scan(&purchaseID); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	endpoint := seedEndpoint(t, ctx, pg, tenant.ID, tenantwebhooks.EventReaderSignedUp, tenantwebhooks.EventPurchaseCompleted)

	queries := dbmodels.New(pg.DB)
	if err := tenantwebhooks.QueueReaderSignedUp(ctx, queries, tenant.ID, reader.ID); err != nil {
		t.Fatalf("QueueReaderSignedUp: %v", err)
	}
	if err := tenantwebhooks.QueuePurchaseCompleted(ctx, queries, tenant.ID, purchaseID); err != nil {
		t.Fatalf("QueuePurchaseCompleted: %v", err)
	}
	if err := tenantwebhooks.QueueReaderSignedUp(ctx, queries, tenant.ID, other.ID); err != nil {
		t.Fatalf("QueueReaderSignedUp of the other reader: %v", err)
	}
	test, err := tenantwebhooks.QueueTest(ctx, queries, tenant.ID, endpoint)
	if err != nil {
		t.Fatalf("QueueTest: %v", err)
	}

	var named int
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM webhook_deliveries WHERE tenant_id = $1 AND reader_id = $2`, tenant.ID, reader.ID).Scan(&named); err != nil {
		t.Fatalf("count the deliveries naming the reader: %v", err)
	}
	if named != 2 {
		t.Fatalf("deliveries naming the reader = %d, want the sign-up and the purchase", named)
	}

	if err := queries.DeleteUserByID(ctx, reader.ID); err != nil {
		t.Fatalf("DeleteUserByID: %v", err)
	}

	rows, err := pg.DB.QueryContext(ctx, `SELECT id, reader_id FROM webhook_deliveries WHERE tenant_id = $1 ORDER BY created_at, id`, tenant.ID)
	if err != nil {
		t.Fatalf("list the deliveries left: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var left []uuid.NullUUID
	var testLeft bool
	for rows.Next() {
		var id uuid.UUID
		var readerID uuid.NullUUID
		if err := rows.Scan(&id, &readerID); err != nil {
			t.Fatalf("scan a delivery: %v", err)
		}
		left = append(left, readerID)
		testLeft = testLeft || id == test
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list the deliveries left: %v", err)
	}
	if len(left) != 2 || !testLeft {
		t.Fatalf("deliveries left = %v, want the other reader's sign-up and the test event", left)
	}
	for _, readerID := range left {
		if readerID.Valid && readerID.UUID != other.ID {
			t.Fatalf("a delivery naming %s outlived the account", readerID.UUID)
		}
	}
}

// The purge deletes the deliveries settled — delivered or given up — longer
// ago than the retention, and none the worker still owes, whatever their age.
// A dry run counts the same deliveries and deletes none.
func TestPurgeDeletesDeliveriesSettledPastTheRetention(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "HOOKPURGE1", "hook-purge.example.com", "Hook Purge")
	endpoint := seedEndpoint(t, ctx, pg, tenant.ID, tenantwebhooks.EventPurchaseCompleted)
	queries := dbmodels.New(pg.DB)

	now := time.Now().UTC()
	past := now.Add(-tenantwebhooks.DeliveryRetention - time.Hour)
	recent := now.Add(-tenantwebhooks.DeliveryRetention + time.Hour)
	long := now.Add(-2 * tenantwebhooks.DeliveryRetention)
	deliveries := map[string]struct {
		status    string
		updatedAt time.Time
		purged    bool
	}{
		"delivered past the retention":     {tenantwebhooks.StatusDelivered, past, true},
		"given up past the retention":      {tenantwebhooks.StatusDead, past, true},
		"another given up past it":         {tenantwebhooks.StatusDead, long, true},
		"delivered inside the retention":   {tenantwebhooks.StatusDelivered, recent, false},
		"given up inside the retention":    {tenantwebhooks.StatusDead, recent, false},
		"still failing past the retention": {tenantwebhooks.StatusFailed, long, false},
		"still pending past the retention": {tenantwebhooks.StatusPending, long, false},
	}
	ids := make(map[string]uuid.UUID, len(deliveries))
	for name, delivery := range deliveries {
		id, err := tenantwebhooks.QueueTest(ctx, queries, tenant.ID, endpoint)
		if err != nil {
			t.Fatalf("QueueTest %s: %v", name, err)
		}
		if _, err := pg.DB.ExecContext(ctx, `
			UPDATE webhook_deliveries
			SET status = $2,
				delivered_at = CASE WHEN $2 = 'delivered' THEN $3::timestamptz END,
				updated_at = $3
			WHERE id = $1
		`, id, delivery.status, delivery.updatedAt); err != nil {
			t.Fatalf("settle %s: %v", name, err)
		}
		ids[name] = id
	}

	purger := tenantwebhooks.NewPurger(pg.DB)
	dry, err := purger.Run(ctx, tenantwebhooks.PurgeOptions{Now: now, DryRun: true})
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if dry.RowCount != 3 {
		t.Fatalf("dry run counted %d deliveries, want 3", dry.RowCount)
	}
	var count int
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM webhook_deliveries WHERE tenant_id = $1`, tenant.ID).Scan(&count); err != nil {
		t.Fatalf("count the deliveries: %v", err)
	}
	if count != len(deliveries) {
		t.Fatalf("deliveries after the dry run = %d, want all %d", count, len(deliveries))
	}

	// A chunk of one makes the run drain over several statements.
	result, err := purger.Run(ctx, tenantwebhooks.PurgeOptions{Now: now, ChunkSize: 1})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result.RowCount != 3 || result.ChunkCount != 4 {
		t.Fatalf("purge = %d deliveries in %d chunks, want 3 in 4", result.RowCount, result.ChunkCount)
	}
	for name, delivery := range deliveries {
		var exists bool
		if err := pg.DB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM webhook_deliveries WHERE id = $1)`, ids[name]).Scan(&exists); err != nil {
			t.Fatalf("look up %s: %v", name, err)
		}
		if exists == delivery.purged {
			t.Fatalf("%s: kept = %v, want %v", name, exists, !delivery.purged)
		}
	}
}
