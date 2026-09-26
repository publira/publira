package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before a
// purchase named its provider, and the last of the migrations that moved it
// there.
const (
	beforePurchaseProviderVersion = 20260925163824
	purchaseProviderVersion       = 20260926031722
)

// providerPurchase is what the provider-neutral columns of one purchase hold.
type providerPurchase struct {
	provider   sql.NullString
	checkoutID sql.NullString
	paymentID  sql.NullString
}

func readProviderPurchase(t *testing.T, pg *testutil.PostgresEnv, purchaseID uuid.UUID) providerPurchase {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var got providerPurchase
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT provider, provider_checkout_id, provider_payment_id
		FROM purchases
		WHERE id = $1
	`, purchaseID).Scan(&got.provider, &got.checkoutID, &got.paymentID); err != nil {
		t.Fatalf("read purchase %s: %v", purchaseID, err)
	}
	return got
}

// A Stripe purchase made before purchases named their provider keeps its ids
// and is recognized as a Stripe one, and a refund held for it is still found
// by the same payment. Without that, a redelivered checkout.session.completed
// would no longer meet the purchase it already created, and a charge.refunded
// would find nothing to revoke.
func TestPurchaseProviderMigrationKeepsStripePurchases(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Behind the migrations under test, so the rows seeded below are rows they
	// find rather than rows written through them.
	pg.MigrateTo(t, beforePurchaseProviderVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	paid := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Paid", Status: testutil.EpisodeStatusPublished})
	granted := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0002", Title: "Granted", Status: testutil.EpisodeStatusPublished})
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	stripePurchaseID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, stripe_checkout_session_id, stripe_payment_intent_id)
		VALUES ($1, $2, $3, $4, 500, 'cs_test_migrated', 'pi_test_migrated')
	`, stripePurchaseID, tenant.ID, reader.ID, paid.ID); err != nil {
		t.Fatalf("insert Stripe purchase: %v", err)
	}
	grantID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase)
		VALUES ($1, $2, $3, $4, 300)
	`, grantID, tenant.ID, reader.ID, granted.ID); err != nil {
		t.Fatalf("insert admin grant: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO unapplied_stripe_refunds (tenant_id, stripe_payment_intent_id, refunded_amount)
		VALUES ($1, 'pi_test_held', 200)
	`, tenant.ID); err != nil {
		t.Fatalf("insert held refund: %v", err)
	}

	pg.MigrateTo(t, purchaseProviderVersion)

	want := providerPurchase{
		provider:   sql.NullString{String: "stripe", Valid: true},
		checkoutID: sql.NullString{String: "cs_test_migrated", Valid: true},
		paymentID:  sql.NullString{String: "pi_test_migrated", Valid: true},
	}
	if got := readProviderPurchase(t, pg, stripePurchaseID); got != want {
		t.Fatalf("migrated Stripe purchase = %+v, want %+v", got, want)
	}
	// An admin grant paid through no provider, and must not be claimed by one.
	if got := readProviderPurchase(t, pg, grantID); got != (providerPurchase{}) {
		t.Fatalf("migrated admin grant = %+v, want no provider and no ids", got)
	}

	var heldProvider string
	var heldAmount int32
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT provider, refunded_amount
		FROM unapplied_refunds
		WHERE tenant_id = $1
			AND provider_payment_id = 'pi_test_held'
	`, tenant.ID).Scan(&heldProvider, &heldAmount); err != nil {
		t.Fatalf("read held refund: %v", err)
	}
	if heldProvider != "stripe" || heldAmount != 200 {
		t.Fatalf("held refund = (%q, %d), want (\"stripe\", 200)", heldProvider, heldAmount)
	}

	// The checkout is still one purchase: a second row for it is refused, as a
	// redelivered notification must be.
	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, provider, provider_checkout_id)
		VALUES ($1, $2, $3, $4, 500, 'stripe', 'cs_test_migrated')
	`, uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, granted.ID)
	if !isUniqueViolation(err) {
		t.Fatalf("second purchase of the same checkout: err = %v, want a unique violation", err)
	}

	// And the way back puts the ids where the Stripe-named schema reads them.
	pg.MigrateTo(t, beforePurchaseProviderVersion)

	var checkoutID, paymentID string
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT stripe_checkout_session_id, stripe_payment_intent_id
		FROM purchases
		WHERE id = $1
	`, stripePurchaseID).Scan(&checkoutID, &paymentID); err != nil {
		t.Fatalf("read reverted Stripe purchase: %v", err)
	}
	if checkoutID != "cs_test_migrated" || paymentID != "pi_test_migrated" {
		t.Fatalf("reverted Stripe purchase = (%q, %q), want (\"cs_test_migrated\", \"pi_test_migrated\")", checkoutID, paymentID)
	}
	var heldCount int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(*)
		FROM unapplied_stripe_refunds
		WHERE tenant_id = $1
			AND stripe_payment_intent_id = 'pi_test_held'
	`, tenant.ID).Scan(&heldCount); err != nil {
		t.Fatalf("count reverted held refunds: %v", err)
	}
	if heldCount != 1 {
		t.Fatalf("reverted held refunds = %d, want 1", heldCount)
	}
}
