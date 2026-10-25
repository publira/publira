package outbox_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"slices"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

// subscriptionCancelFixture is a tenant selling through Stripe, whose API is
// the contract fixture's fake.
type subscriptionCancelFixture struct {
	pg        *testutil.PostgresEnv
	encryptor *secretcrypto.Manager
	stripe    *stripetest.Fixture
	secretKey string
	tenantID  uuid.UUID
}

func newSubscriptionCancelFixture(t *testing.T) *subscriptionCancelFixture {
	t.Helper()
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{6}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	tenant := pg.SeedTenant(t, "SUBCANCEL01", "subscription-cancel.example.com", "Subscription Cancel")
	f := &subscriptionCancelFixture{
		pg:        pg,
		encryptor: encryptor,
		stripe:    stripetest.NewFixture(t),
		tenantID:  tenant.ID,
	}
	f.secretKey = f.stripe.Credentials()[stripe.FieldSecretKey]
	f.savePaymentSettings(t, f.stripe.Credentials(), true)
	return f
}

func (f *subscriptionCancelFixture) savePaymentSettings(t *testing.T, credentials paymentprovider.Credentials, enabled bool) {
	t.Helper()
	if _, err := paymentsettings.New(dbmodels.New(f.pg.DB), f.encryptor, f.registry(), nil, slog.Default()).Upsert(context.Background(), f.tenantID, paymentsettings.UpdateInput{
		Provider: stripe.ID,
		Enabled:  enabled,
		Fields: []paymentsettings.FieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: secretupdate.Replace, Value: credentials[stripe.FieldSecretKey]},
			{Name: stripe.FieldWebhookSecret, Mode: secretupdate.Replace, Value: credentials[stripe.FieldWebhookSecret]},
		},
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("save payment settings: %v", err)
	}
}

func (f *subscriptionCancelFixture) registry() *paymentprovider.Registry {
	return paymentprovider.NewRegistry(f.stripe.Provider())
}

func (f *subscriptionCancelFixture) handler(t *testing.T) outbox.Handler {
	return outbox.NewSubscriptionCancelHandler(outbox.SubscriptionCancelHandlerConfig{
		DB:        f.pg.OpenOutboxDB(t),
		Encryptor: f.encryptor,
		Providers: f.registry(),
	})
}

// subscribe puts a subscription in status on the tenant's Stripe account.
func (f *subscriptionCancelFixture) subscribe(id, status string) {
	f.stripe.API.SetSubscription(f.secretKey, stripetest.Subscription{
		ID:         id,
		CustomerID: "cus_" + id,
		PriceID:    "price_monthly",
		Status:     status,
		Metadata:   stripetest.SubscriptionMetadata(f.tenantID, uuid.New(), uuid.New(), "price_monthly"),
	})
}

func (f *subscriptionCancelFixture) event(t *testing.T, subscriptionID string) dbmodels.OutboxEvent {
	t.Helper()
	body, err := json.Marshal(outbox.SubscriptionCancelPayload{TenantID: f.tenantID.String(), SubscriptionID: subscriptionID})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  uuid.NullUUID{UUID: f.tenantID, Valid: true},
		EventType: outbox.EventTypeSubscriptionCancel,
		Payload:   body,
	}
}

func (f *subscriptionCancelFixture) status(t *testing.T, id string) string {
	t.Helper()
	subscription, ok := f.stripe.API.Subscription(f.secretKey, id)
	if !ok {
		t.Fatalf("the account holds no subscription %s", id)
	}
	return subscription.Status
}

func TestSubscriptionCancelEndsABilledSubscriptionNow(t *testing.T) {
	f := newSubscriptionCancelFixture(t)
	handle := f.handler(t)
	for _, status := range []string{"trialing", "active", "past_due", "unpaid", "paused"} {
		t.Run(status, func(t *testing.T) {
			id := "sub_" + status
			f.subscribe(id, status)
			if err := handle(context.Background(), f.event(t, id)); err != nil {
				t.Fatalf("handle: %v", err)
			}
			if got := f.status(t, id); got != "canceled" {
				t.Fatalf("status = %q, want canceled", got)
			}
		})
	}
}

// A delivery that repeats one already sent, or follows a cancellation made
// meanwhile, finds nothing left to bill and asks Stripe for nothing.
func TestSubscriptionCancelLeavesASubscriptionThatIsNoLongerBilled(t *testing.T) {
	f := newSubscriptionCancelFixture(t)
	handle := f.handler(t)
	f.subscribe("sub_once", "active")
	f.subscribe("sub_expired", "incomplete_expired")

	for _, id := range []string{"sub_once", "sub_once", "sub_expired"} {
		if err := handle(context.Background(), f.event(t, id)); err != nil {
			t.Fatalf("handle %s: %v", id, err)
		}
	}
	got := f.stripe.API.SubscriptionCancellations()
	if len(got) != 1 || got[0].SubscriptionID != "sub_once" {
		t.Fatalf("cancellations = %+v, want sub_once's once", got)
	}
}

// A cancellation Stripe does not take this time is retried as any failure is.
func TestSubscriptionCancelIsRetriedWhenStripeFails(t *testing.T) {
	f := newSubscriptionCancelFixture(t)
	handle := f.handler(t)
	f.subscribe("sub_retry", "active")
	event := f.event(t, "sub_retry")

	f.stripe.API.FailNextSubscriptionCancel(f.secretKey, "sub_retry")
	if err := handle(context.Background(), event); err == nil || outbox.IsPermanent(err) || outbox.IsBlocked(err) {
		t.Fatalf("handle while Stripe fails = %v, want an ordinary error to retry", err)
	}
	if err := handle(context.Background(), event); err != nil {
		t.Fatalf("handle once Stripe takes it: %v", err)
	}
	if got := f.status(t, "sub_retry"); got != "canceled" {
		t.Fatalf("status = %q, want canceled", got)
	}
}

// What only the tenant can put right blocks the cancellation instead of
// spending its retries, so it is still owed when the tenant does: payments
// switched off, a key Stripe refuses, and a key of another account, which
// holds no such subscription.
func TestSubscriptionCancelWaitsForTheTenantsSettings(t *testing.T) {
	f := newSubscriptionCancelFixture(t)
	handle := f.handler(t)
	f.subscribe("sub_blocked", "active")
	event := f.event(t, "sub_blocked")

	blocked := func(t *testing.T, while string) {
		t.Helper()
		if err := handle(context.Background(), event); !outbox.IsBlocked(err) {
			t.Fatalf("handle while %s = %v, want it blocked", while, err)
		}
	}
	f.savePaymentSettings(t, f.stripe.Credentials(), false)
	blocked(t, "payments are off")
	f.savePaymentSettings(t, f.stripe.OtherCredentials(), true)
	blocked(t, "the settings name another account")
	f.savePaymentSettings(t, f.stripe.Credentials(), true)
	f.stripe.API.RevokeSecretKey(f.secretKey)
	blocked(t, "Stripe refuses the key")
	if got := f.status(t, "sub_blocked"); got != "active" {
		t.Fatalf("status while blocked = %q, want active", got)
	}

	f.stripe.API.RestoreSecretKey(f.secretKey)
	if err := handle(context.Background(), event); err != nil {
		t.Fatalf("handle once the settings are back: %v", err)
	}
	if got := f.status(t, "sub_blocked"); got != "canceled" {
		t.Fatalf("status = %q, want canceled", got)
	}
}

// A deleted account's subscriptions are canceled by the statuses the provider
// goes on billing, which billed_subscriptions and paymentprovider spell apart.
func TestQueueSubscriptionCancellationsForUserQueuesTheBilledOnes(t *testing.T) {
	f := newSubscriptionCancelFixture(t)
	reader := f.pg.SeedEndUser(t, f.tenantID, "SUBREADER01", "reader@subscription-cancel.example.com", "Reader")
	other := f.pg.SeedEndUser(t, f.tenantID, "SUBREADER02", "other@subscription-cancel.example.com", "Other")
	plan := f.pg.SeedSubscriptionPlan(t, f.tenantID, testutil.SubscriptionPlanSeed{Published: true})
	var want []string
	for _, status := range []paymentprovider.SubscriptionStatus{
		paymentprovider.SubscriptionIncomplete,
		paymentprovider.SubscriptionIncompleteExpired,
		paymentprovider.SubscriptionTrialing,
		paymentprovider.SubscriptionActive,
		paymentprovider.SubscriptionPastDue,
		paymentprovider.SubscriptionCanceled,
		paymentprovider.SubscriptionUnpaid,
		paymentprovider.SubscriptionPaused,
	} {
		id := "sub_" + string(status)
		f.pg.SeedSubscription(t, f.tenantID, reader.ID, plan.ID, testutil.SubscriptionSeed{StripeSubscriptionID: id, Status: string(status)})
		if status.Billed() {
			want = append(want, id)
		}
	}
	f.pg.SeedSubscription(t, f.tenantID, other.ID, plan.ID, testutil.SubscriptionSeed{StripeSubscriptionID: "sub_other"})

	queries := dbmodels.New(f.pg.DB)
	for range 2 {
		if err := outbox.QueueSubscriptionCancellationsForUser(context.Background(), queries, f.tenantID, reader.ID); err != nil {
			t.Fatalf("QueueSubscriptionCancellationsForUser: %v", err)
		}
	}

	rows, err := f.pg.DB.QueryContext(context.Background(),
		"SELECT payload->>'subscription_id' FROM outbox_events WHERE tenant_id = $1 AND event_type = $2",
		f.tenantID, outbox.EventTypeSubscriptionCancel)
	if err != nil {
		t.Fatalf("read the queued cancellations: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var got []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got = append(got, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read the queued cancellations: %v", err)
	}
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("queued cancellations = %v, want one each of %v", got, want)
	}
}
