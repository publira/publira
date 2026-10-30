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

// A later release records a subscription a store bills with no Stripe
// customer, subscription, or price. The reads of the reader's Stripe customer
// and of the Stripe subscriptions an account deletion cancels pass such a row
// over, so this release keeps answering them on the schema that release
// leaves, during an upgrade or after a rollback.
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

	mustExec(t, ctx, db, `
		ALTER TABLE subscriptions
			ALTER COLUMN stripe_customer_id DROP NOT NULL,
			ALTER COLUMN stripe_subscription_id DROP NOT NULL,
			ALTER COLUMN stripe_price_id DROP NOT NULL
	`)
	mustExec(t, ctx, db, `
		INSERT INTO subscriptions (id, tenant_id, user_id, plan_id, status, current_period_end, created_at)
		VALUES ($1, $2, $3, $4, 'active', now() + interval '1 month', now() + interval '1 minute')
	`, uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, plan.ID)

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
