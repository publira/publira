package tenantwebhooks_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantwebhooks"
	"github.com/publira/publira/server/internal/testutil"
)

// A refund in part whose purchase another refund has taken further before the
// event is queued still says what its own refund left: the event is built
// from the row the refund's write returned, not from the purchase read again.
func TestQueuePurchaseRefundedCarriesTheRefundItRecorded(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "HOOKREFUND1", "hook-refund.example.com", "Hook Refund")
	reader := pg.SeedEndUser(t, tenant.ID, "HOOKREFUNDU1", "refund@example.com", "Refund reader")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{Price: 500, Status: testutil.EpisodeStatusPublished})
	pg.SeedPurchase(t, tenant.ID, reader.ID, episode.ID, 500)
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $2, 'https://crm.example.com/publira', 'sealed', 'whsec_••••', ARRAY['purchase.refunded'])
	`, uuid.Must(uuid.NewV7()), tenant.ID); err != nil {
		t.Fatalf("insert webhook endpoint: %v", err)
	}

	// The second refund, in full, has committed by the time the first one's
	// event is queued.
	var purchase dbmodels.Purchase
	if err := pg.DB.QueryRowContext(ctx, `
		UPDATE purchases SET refunded_amount = 500, refunded_at = now(), revoked_at = now(), revocation_reason = 'refund'
		WHERE tenant_id = $1
		RETURNING id, tenant_id
	`, tenant.ID).Scan(&purchase.ID, &purchase.TenantID); err != nil {
		t.Fatalf("refund the purchase in full: %v", err)
	}
	partial := purchase
	partial.RefundedAmount = sql.NullInt32{Int32: 200, Valid: true}

	queries := dbmodels.New(pg.DB)
	if err := tenantwebhooks.QueuePurchaseRefunded(ctx, queries, partial); err != nil {
		t.Fatalf("queue the refund in part: %v", err)
	}
	var refunded int
	var hasRefundedAt bool
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT (payload->'data'->>'refunded_amount')::integer, payload->'data' ? 'refunded_at'
		FROM webhook_deliveries WHERE tenant_id = $1
	`, tenant.ID).Scan(&refunded, &hasRefundedAt); err != nil {
		t.Fatalf("read the delivery: %v", err)
	}
	if refunded != 200 || hasRefundedAt {
		t.Fatalf("event of the refund in part = %d refunded, refunded_at set %v; want 200 and no refunded_at", refunded, hasRefundedAt)
	}
}
