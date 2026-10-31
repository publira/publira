package dbtest

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// A subscription a store bills names no Stripe customer, subscription, or
// price. The reads of the reader's Stripe customer and of the Stripe
// subscriptions an account deletion cancels pass such a row over, even when it
// is the reader's latest.
func TestStripeSubscriptionReadsPassOverAnotherProvidersSubscription(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := pg.DB

	tenant := pg.SeedTenant(t, "TENANTSUB01", "tenant-sub.example.com", "Tenant Subscriptions")
	plan := pg.SeedSubscriptionPlan(t, tenant.ID, testutil.SubscriptionPlanSeed{Published: true})
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERSUB01", "reader@tenant-sub.example.com", "Reader")
	pg.SeedSubscription(t, tenant.ID, reader.ID, plan.ID, testutil.SubscriptionSeed{
		StripeCustomerID:     "cus_web",
		StripeSubscriptionID: "sub_web",
	})

	storeID := pg.SeedSubscription(t, tenant.ID, reader.ID, plan.ID, testutil.SubscriptionSeed{Provider: "app_store"})
	mustExec(t, ctx, db, "UPDATE subscriptions SET created_at = now() + interval '1 minute' WHERE id = $1", storeID)

	queries := dbmodels.New(db)
	user := uuid.NullUUID{UUID: reader.ID, Valid: true}

	customerID, err := queries.GetLatestStripeCustomerIDForUser(ctx, dbmodels.GetLatestStripeCustomerIDForUserParams{TenantID: tenant.ID, UserID: user})
	if err != nil {
		t.Fatalf("GetLatestStripeCustomerIDForUser: %v", err)
	}
	if customerID != "cus_web" {
		t.Fatalf("GetLatestStripeCustomerIDForUser = %q, want cus_web", customerID)
	}

	subscriptionIDs, err := queries.ListBilledStripeSubscriptionIDsForUser(ctx, dbmodels.ListBilledStripeSubscriptionIDsForUserParams{TenantID: tenant.ID, UserID: user})
	if err != nil {
		t.Fatalf("ListBilledStripeSubscriptionIDsForUser: %v", err)
	}
	if want := []string{"sub_web"}; !slices.Equal(subscriptionIDs, want) {
		t.Fatalf("ListBilledStripeSubscriptionIDsForUser = %v, want %v", subscriptionIDs, want)
	}
}
