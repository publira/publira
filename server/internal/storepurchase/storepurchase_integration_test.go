package storepurchase_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/storepurchase"
	"github.com/publira/publira/server/internal/testutil"
)

// A refund that arrives while the confirmation of the same transaction is
// still writing its purchase waits for that confirmation, and then lands on
// the purchase rather than in the hold the confirmation has already looked in.
func TestRecordRefundWaitsForTheConfirmationOfTheSameTransaction(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()

	tenant := pg.SeedTenant(t, "LOCKTENANT01", "lock-tenant.example.com", "Lock Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "LOCKSERIES01"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "LOCKEPISODE1", Price: 300})
	reader := pg.SeedEndUser(t, tenant.ID, "LOCKREADER01", "reader@lock-tenant.example.com", "Reader")
	const transactionID = "2000000000000900"

	// The confirmation takes the lock and writes its purchase, and has found no
	// held refund, but has not committed.
	confirmation, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin confirmation: %v", err)
	}
	defer confirmation.Rollback() //nolint:errcheck
	confirmationQueries := dbmodels.New(confirmation)
	if err := storepurchase.LockTransaction(ctx, confirmationQueries, tenant.ID, storepurchase.StoreAppStore, transactionID); err != nil {
		t.Fatalf("LockTransaction: %v", err)
	}
	purchase, err := confirmationQueries.CreateStorePurchase(ctx, dbmodels.CreateStorePurchaseParams{
		ID:                 uuid.New(),
		TenantID:           tenant.ID,
		UserID:             reader.ID,
		EpisodeID:          episode.ID,
		PriceAtPurchase:    300,
		Store:              storepurchase.StoreAppStore,
		StoreTransactionID: transactionID,
	})
	if err != nil {
		t.Fatalf("CreateStorePurchase: %v", err)
	}
	if held, err := storepurchase.ApplyHeldRefund(ctx, confirmationQueries, tenant.ID, purchase.ID, storepurchase.StoreAppStore, transactionID); err != nil || held {
		t.Fatalf("ApplyHeldRefund = %v, %v, want nothing held yet", held, err)
	}

	type result struct {
		applied bool
		err     error
	}
	refunded := make(chan result, 1)
	go func() {
		tx, err := pg.DB.BeginTx(ctx, nil)
		if err != nil {
			refunded <- result{err: err}
			return
		}
		defer tx.Rollback() //nolint:errcheck
		applied, err := storepurchase.RecordRefund(ctx, dbmodels.New(tx), tenant.ID, storepurchase.StoreAppStore, transactionID)
		if err == nil {
			err = tx.Commit()
		}
		refunded <- result{applied: applied, err: err}
	}()

	select {
	case r := <-refunded:
		t.Fatalf("the refund finished while the confirmation was open: %+v", r)
	case <-time.After(500 * time.Millisecond):
	}
	if err := confirmation.Commit(); err != nil {
		t.Fatalf("commit confirmation: %v", err)
	}

	r := <-refunded
	if r.err != nil || !r.applied {
		t.Fatalf("RecordRefund = %v, %v, want it applied to the committed purchase", r.applied, r.err)
	}
	var refundedAt, held int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT (SELECT count(*) FROM purchases WHERE id = $1 AND refunded_at IS NOT NULL),
			(SELECT count(*) FROM unapplied_store_refunds)
	`, purchase.ID).Scan(&refundedAt, &held); err != nil {
		t.Fatalf("read result: %v", err)
	}
	if refundedAt != 1 || held != 0 {
		t.Fatalf("refunded purchases = %d, held refunds = %d, want 1 and 0", refundedAt, held)
	}
}
