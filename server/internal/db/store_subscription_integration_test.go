package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// previousReleaseRecordSubscriptionFromStripe is RecordSubscriptionFromStripe
// as v0.6.0 ships it, which names no provider and none of a store's columns.
// Its server runs it for every Stripe webhook for as long as an upgrade leaves
// that server running, and again after one is rolled back.
const previousReleaseRecordSubscriptionFromStripe = `
INSERT INTO subscriptions (
        id,
        tenant_id,
        user_id,
        plan_id,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_price_id,
        status,
        current_period_end,
        cancel_at_period_end
    )
VALUES (
        $1,
        $2,
        (
            SELECT u.id
            FROM users u
            WHERE u.tenant_id = $2
                AND u.id = $3
        ),
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10
    ) ON CONFLICT (tenant_id, stripe_subscription_id) DO
UPDATE
SET plan_id = EXCLUDED.plan_id,
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    stripe_price_id = EXCLUDED.stripe_price_id,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    updated_at = NOW()
RETURNING id`

// previousReleaseUserHoldsLiveSubscription,
// previousReleaseListBilledStripeSubscriptionIDsForUser, and
// previousReleaseGetLatestStripeCustomerIDForUser are the v0.6.0 reads of a
// reader's subscriptions: whether the reader may start a checkout, which
// subscriptions closing the account cancels through Stripe, and the Stripe
// customer a checkout and the billing portal name.
const (
	previousReleaseUserHoldsLiveSubscription = `
SELECT EXISTS (
        SELECT 1
        FROM billed_subscriptions
        WHERE tenant_id = $1
            AND user_id = $2
    ) AS holds`
	previousReleaseListBilledStripeSubscriptionIDsForUser = `
SELECT stripe_subscription_id
FROM billed_subscriptions
WHERE tenant_id = $1
    AND user_id = $2
    AND stripe_subscription_id IS NOT NULL
ORDER BY created_at,
    id`
	previousReleaseGetLatestStripeCustomerIDForUser = `
SELECT stripe_customer_id
FROM subscriptions
WHERE tenant_id = $1
    AND user_id = $2
    AND stripe_customer_id IS NOT NULL
ORDER BY created_at DESC,
    id DESC
LIMIT 1`
)

// The previous release goes on recording Stripe subscriptions on the schema
// that also holds store ones: its insert, which names no provider, records a
// Stripe one, and a redelivered notification updates it.
func TestPreviousReleaseRecordsAStripeSubscriptionBesideStoreOnes(t *testing.T) {
	pg := testutil.StartIsolatedPostgres(t)
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")
	reader := pg.SeedEndUser(t, tenant.ID, "READER000001", "reader@example.com", "Reader")
	plan := pg.SeedSubscriptionPlan(t, tenant.ID, testutil.SubscriptionPlanSeed{AppStoreProductID: "com.example.reader.monthly"})
	pg.SeedSubscription(t, tenant.ID, reader.ID, plan.ID, testutil.SubscriptionSeed{Provider: "app_store", StoreSubscriptionID: "2000000500000001"})

	record := func(status string) uuid.UUID {
		t.Helper()
		var id uuid.UUID
		if err := pg.DB.QueryRowContext(ctx, previousReleaseRecordSubscriptionFromStripe,
			uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, plan.ID,
			"cus_previous", "sub_previous", "price_previous", status, time.Now().AddDate(0, 1, 0), false,
		).Scan(&id); err != nil {
			t.Fatalf("previous release's insert of a %s subscription: %v", status, err)
		}
		return id
	}
	first := record("active")
	if again := record("past_due"); again != first {
		t.Fatalf("the redelivered notification recorded %s, want the update of %s", again, first)
	}
	var provider, status string
	var isTest bool
	if err := pg.DB.QueryRowContext(ctx, "SELECT provider, status, is_test FROM subscriptions WHERE id = $1", first).Scan(&provider, &status, &isTest); err != nil {
		t.Fatalf("read the subscription: %v", err)
	}
	if provider != "stripe" || status != "past_due" || isTest {
		t.Fatalf("previous release's subscription = %s %s test=%v, want a stripe one, past due", provider, status, isTest)
	}
}

// The previous release reads a store subscription the way this one does: as a
// subscription the reader holds, so it refuses them a second one through the
// web checkout, and as no Stripe customer or Stripe subscription, so the
// billing portal and the cancellations an account deletion queues name only
// what Stripe bills, even when a store subscription is the reader's latest.
func TestPreviousReleaseReadsAStoreSubscriptionAsHeldAndNotStripes(t *testing.T) {
	pg := testutil.StartIsolatedPostgres(t)
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")
	stripeReader := pg.SeedEndUser(t, tenant.ID, "READER000001", "stripe@example.com", "Stripe")
	storeReader := pg.SeedEndUser(t, tenant.ID, "READER000002", "store@example.com", "Store")
	plan := pg.SeedSubscriptionPlan(t, tenant.ID, testutil.SubscriptionPlanSeed{GooglePlayProductID: "plan_monthly"})
	pg.SeedSubscription(t, tenant.ID, stripeReader.ID, plan.ID, testutil.SubscriptionSeed{StripeSubscriptionID: "sub_billed", StripeCustomerID: "cus_billed"})
	// The store reader once subscribed through Stripe, and their latest
	// subscription is the store one.
	pg.SeedSubscription(t, tenant.ID, storeReader.ID, plan.ID, testutil.SubscriptionSeed{StripeSubscriptionID: "sub_ended", StripeCustomerID: "cus_earlier", Status: "canceled"})
	storeID := pg.SeedSubscription(t, tenant.ID, storeReader.ID, plan.ID, testutil.SubscriptionSeed{Provider: "google_play"})
	if _, err := pg.DB.ExecContext(ctx, "UPDATE subscriptions SET created_at = now() + interval '1 minute' WHERE id = $1", storeID); err != nil {
		t.Fatalf("make the store subscription the latest: %v", err)
	}

	holds := func(readerID uuid.UUID) bool {
		t.Helper()
		var held bool
		if err := pg.DB.QueryRowContext(ctx, previousReleaseUserHoldsLiveSubscription, tenant.ID, readerID).Scan(&held); err != nil {
			t.Fatalf("previous release's UserHoldsLiveSubscription: %v", err)
		}
		return held
	}
	if !holds(stripeReader.ID) || !holds(storeReader.ID) {
		t.Fatalf("previous release holds: stripe %v, store %v, want both readers subscribed", holds(stripeReader.ID), holds(storeReader.ID))
	}

	billed := func(readerID uuid.UUID) []string {
		t.Helper()
		rows, err := pg.DB.QueryContext(ctx, previousReleaseListBilledStripeSubscriptionIDsForUser, tenant.ID, readerID)
		if err != nil {
			t.Fatalf("previous release's ListBilledStripeSubscriptionIDsForUser: %v", err)
		}
		defer rows.Close() //nolint:errcheck
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatalf("scan a billed subscription: %v", err)
			}
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("read the billed subscriptions: %v", err)
		}
		return ids
	}
	if got := billed(stripeReader.ID); len(got) != 1 || got[0] != "sub_billed" {
		t.Fatalf("billed Stripe subscriptions of the Stripe subscriber = %v, want sub_billed", got)
	}
	if got := billed(storeReader.ID); len(got) != 0 {
		t.Fatalf("billed Stripe subscriptions of the store subscriber = %v, want none", got)
	}

	var customerID string
	if err := pg.DB.QueryRowContext(ctx, previousReleaseGetLatestStripeCustomerIDForUser, tenant.ID, storeReader.ID).Scan(&customerID); err != nil {
		t.Fatalf("previous release's GetLatestStripeCustomerIDForUser: %v", err)
	}
	if customerID != "cus_earlier" {
		t.Fatalf("previous release's Stripe customer of the store subscriber = %q, want cus_earlier", customerID)
	}
}

// A subscription names the ids of whoever bills it and nothing of anyone
// else's, and only a store's can be a test one.
func TestSubscriptionNamesOnlyTheIDsOfItsProvider(t *testing.T) {
	pg := testutil.StartIsolatedPostgres(t)
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")
	reader := pg.SeedEndUser(t, tenant.ID, "READER000001", "reader@example.com", "Reader")
	plan := pg.SeedSubscriptionPlan(t, tenant.ID, testutil.SubscriptionPlanSeed{})

	for name, insert := range map[string]string{
		"a store subscription naming a Stripe customer": `
			INSERT INTO subscriptions (id, tenant_id, user_id, plan_id, provider, store_subscription_id, store_product_id, stripe_customer_id, status)
			VALUES ($1, $2, $3, $4, 'app_store', '2000000500000001', 'com.example.reader.monthly', 'cus_x', 'active')`,
		"a store subscription naming no product": `
			INSERT INTO subscriptions (id, tenant_id, user_id, plan_id, provider, store_subscription_id, status)
			VALUES ($1, $2, $3, $4, 'google_play', 'token', 'active')`,
		"a Stripe subscription naming a store's subscription": `
			INSERT INTO subscriptions (id, tenant_id, user_id, plan_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, store_subscription_id, status)
			VALUES ($1, $2, $3, $4, 'cus_x', 'sub_x', 'price_x', '2000000500000001', 'active')`,
		"a test Stripe subscription": `
			INSERT INTO subscriptions (id, tenant_id, user_id, plan_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, is_test, status)
			VALUES ($1, $2, $3, $4, 'cus_x', 'sub_x', 'price_x', true, 'active')`,
		"a provider nobody knows": `
			INSERT INTO subscriptions (id, tenant_id, user_id, plan_id, provider, store_subscription_id, store_product_id, status)
			VALUES ($1, $2, $3, $4, 'paypal', 'x', 'y', 'active')`,
	} {
		if _, err := pg.DB.ExecContext(ctx, insert, uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, plan.ID); err == nil {
			t.Errorf("%s was stored", name)
		}
	}
}
