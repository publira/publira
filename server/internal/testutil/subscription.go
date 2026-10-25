package testutil

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/publicid"
)

// SubscriptionPlanSeed describes a subscription plan to insert. A zero seed is
// an unpublished monthly plan of the whole catalog at 980 JPY.
type SubscriptionPlanSeed struct {
	Name          string
	StripePriceID string
	PriceAmount   int32
	// Scope is all, label, or series; empty is all. LabelIDs and SeriesIDs are
	// stored as its targets.
	Scope     string
	LabelIDs  []uuid.UUID
	SeriesIDs []uuid.UUID
	Published bool
}

// SubscriptionPlan is a seeded subscription_plans row.
type SubscriptionPlan struct {
	ID            uuid.UUID
	PublicID      string
	StripePriceID string
}

// SeedSubscriptionPlan inserts a plan and its targets, the way
// CreateSubscriptionPlan stores them.
func (e *PostgresEnv) SeedSubscriptionPlan(t *testing.T, tenantID uuid.UUID, seed SubscriptionPlanSeed) SubscriptionPlan {
	t.Helper()
	e.requireDB(t)

	publicID, err := publicid.New()
	if err != nil {
		t.Fatalf("publicid.New: %v", err)
	}
	plan := SubscriptionPlan{
		ID:            uuid.Must(uuid.NewV7()),
		PublicID:      publicID,
		StripePriceID: defaultIfEmpty(seed.StripePriceID, "price_"+publicID),
	}
	priceAmount := seed.PriceAmount
	if priceAmount == 0 {
		priceAmount = 980
	}

	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO subscription_plans (id, tenant_id, public_id, name, stripe_price_id, price_amount, currency, recurring_interval, recurring_interval_count, scope, is_published)
		VALUES ($1, $2, $3, $4, $5, $6, 'JPY', 'month', 1, $7, $8)
	`, plan.ID, tenantID, publicID, defaultIfEmpty(seed.Name, "Monthly plan"), plan.StripePriceID, priceAmount, defaultIfEmpty(seed.Scope, "all"), seed.Published); err != nil {
		t.Fatalf("insert subscription plan %s: %v", publicID, err)
	}
	for _, labelID := range seed.LabelIDs {
		if _, err := e.DB.ExecContext(ctx,
			"INSERT INTO subscription_plan_targets (tenant_id, plan_id, label_id) VALUES ($1, $2, $3)", tenantID, plan.ID, labelID,
		); err != nil {
			t.Fatalf("insert label target of subscription plan %s: %v", publicID, err)
		}
	}
	for _, seriesID := range seed.SeriesIDs {
		if _, err := e.DB.ExecContext(ctx,
			"INSERT INTO subscription_plan_targets (tenant_id, plan_id, series_id) VALUES ($1, $2, $3)", tenantID, plan.ID, seriesID,
		); err != nil {
			t.Fatalf("insert series target of subscription plan %s: %v", publicID, err)
		}
	}
	return plan
}

// SubscriptionSeed describes a subscription to insert. A zero seed is an
// active one whose period ends in a month.
type SubscriptionSeed struct {
	StripeSubscriptionID string
	StripeCustomerID     string
	StripePriceID        string
	Status               string
	CurrentPeriodEnd     time.Time
}

// SeedSubscription inserts a reader's subscription to a plan, the way Stripe's
// webhook records one, and answers its id.
func (e *PostgresEnv) SeedSubscription(t *testing.T, tenantID, userID, planID uuid.UUID, seed SubscriptionSeed) uuid.UUID {
	t.Helper()
	e.requireDB(t)

	id := uuid.Must(uuid.NewV7())
	periodEnd := seed.CurrentPeriodEnd
	if periodEnd.IsZero() {
		periodEnd = time.Now().AddDate(0, 1, 0)
	}

	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO subscriptions (id, tenant_id, user_id, plan_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, id, tenantID, userID, planID,
		defaultIfEmpty(seed.StripeCustomerID, "cus_"+id.String()),
		defaultIfEmpty(seed.StripeSubscriptionID, "sub_"+id.String()),
		defaultIfEmpty(seed.StripePriceID, "price_"+id.String()),
		defaultIfEmpty(seed.Status, "active"),
		periodEnd,
	); err != nil {
		t.Fatalf("insert subscription: %v", err)
	}
	return id
}
