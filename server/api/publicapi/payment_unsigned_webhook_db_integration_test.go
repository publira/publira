package publicapi

import (
	"net/http"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest/readbacktest"
	"github.com/publira/publira/server/internal/platformpolicy"
)

// deliverFrom delivers payload as the client at address, the way the edge in
// front of the server names it.
func (e storedCheckoutEnv) deliverFrom(t *testing.T, address string, payload []byte) error {
	t.Helper()
	ctx, info := connect.NewClientContext(t.Context())
	info.RequestHeader().Set("X-Forwarded-For", address)
	_, err := e.purchases.ProcessPaymentWebhook(ctx, paymentWebhookRequest(e.tenant.ID.String(), e.fixture.Provider().Declaration().ID, payload, http.Header{}))
	return err
}

// unsignedFixtures are the fakes of each shape a provider that signs no
// notification takes: naming a payment's notification by its checkout and a
// refund's by the payment, naming both by the checkout, and naming both by the
// payment the reader's browser made.
var unsignedFixtures = map[string]func(testing.TB) readbackFixture{
	readbacktest.ID:           func(t testing.TB) readbackFixture { return readbacktest.NewFixture(t) },
	readbacktest.IDByCheckout: func(t testing.TB) readbackFixture { return readbacktest.NewFixtureByCheckout(t) },
	readbacktest.IDInBrowser:  func(t testing.TB) readbackFixture { return readbacktest.NewFixtureInBrowser(t) },
}

// A notification anyone could have sent that names nothing of the tenant's is
// refused before the provider is asked anything about it, so sending one
// spends nothing of the tenant's quota with the provider.
func TestDBAnUnsignedNotificationOfNothingTheTenantStartedIsNotRead(t *testing.T) {
	t.Parallel()

	for id, newFixture := range unsignedFixtures {
		t.Run(id, func(t *testing.T) {
			t.Parallel()

			env := newStoredCheckoutEnvWith(t, newFixture(t), func(*platformpolicy.Policy) {})
			api := env.fixture.API()
			never := paymentprovider.StoredCheckoutID("never started")
			payment := api.Pay(env.credentials, never, "payment_never", 500, "USD", false, time.Now())
			refunds := env.fixture.Provider().(paymentprovider.RefundFollower).RefundNotification(api.PaymentID(never, "payment_never"))
			for name, payload := range map[string][]byte{"payment": payment, "refunds": refunds} {
				if err := env.deliver(t, payload); connect.CodeOf(err) != connect.CodeInvalidArgument {
					t.Fatalf("%s: delivery error = %v, want InvalidArgument", name, err)
				}
			}
			if got := api.NotificationReads(); got != 0 {
				t.Fatalf("notifications read from the provider = %d, want 0", got)
			}
			if got := env.count(t, "SELECT count(*) FROM purchases WHERE tenant_id = $1"); got != 0 {
				t.Fatalf("purchases = %d, want 0", got)
			}
		})
	}
}

// A notification of a checkout the tenant started is read from the provider
// as before, and so is one of the payment the purchase recorded.
func TestDBAnUnsignedNotificationOfACheckoutTheTenantStartedIsRead(t *testing.T) {
	t.Parallel()

	for id, newFixture := range unsignedFixtures {
		t.Run(id, func(t *testing.T) {
			t.Parallel()

			env := newStoredCheckoutEnvWith(t, newFixture(t), func(*platformpolicy.Policy) {})
			api := env.fixture.API()
			checkoutID := env.start(t)
			payload := api.Pay(env.credentials, checkoutID, "payment_started", 500, "USD", false, time.Now())
			if _, browser := env.fixture.Provider().(paymentprovider.BrowserCheckout); browser {
				payload = api.Authorize(env.credentials, checkoutID, "payment_started", 500, "USD", false, time.Now())
			}
			if err := env.deliver(t, payload); err != nil {
				t.Fatalf("payment: %v", err)
			}
			if got := env.count(t, "SELECT count(*) FROM purchases WHERE tenant_id = $1"); got != 1 {
				t.Fatalf("purchases = %d, want 1", got)
			}
			refunds := env.fixture.Provider().(paymentprovider.RefundFollower).RefundNotification(api.PaymentID(checkoutID, "payment_started"))
			if err := env.deliver(t, refunds); err != nil {
				t.Fatalf("refunds: %v", err)
			}
			if got := api.NotificationReads(); got != 2 {
				t.Fatalf("notifications read from the provider = %d, want 2", got)
			}
		})
	}
}

// A provider whose notifications name only the payment, which the reader's
// browser makes before the server has kept it, is asked about a payment the
// server knows nothing of only while a checkout of the tenant's can still be
// paid and keeps no payment.
func TestDBAnUnsignedNotificationOfAnUnknownPaymentIsReadOnlyWhileACheckoutAwaitsOne(t *testing.T) {
	t.Parallel()

	t.Run("a checkout that keeps its payment", func(t *testing.T) {
		t.Parallel()

		env := newStoredCheckoutEnvWith(t, readbacktest.NewFixtureInBrowser(t), func(*platformpolicy.Policy) {})
		api := env.fixture.API()
		checkoutID := env.start(t)
		if err := env.deliver(t, api.Authorize(env.credentials, checkoutID, "payment_kept", 500, "USD", false, time.Now())); err != nil {
			t.Fatalf("payment: %v", err)
		}
		stray := api.Authorize(env.credentials, checkoutID, "payment_stray", 500, "USD", false, time.Now())
		if err := env.deliver(t, stray); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("delivery error = %v, want InvalidArgument", err)
		}
		if got := api.NotificationReads(); got != 1 {
			t.Fatalf("notifications read from the provider = %d, want 1, the payment kept", got)
		}
	})

	t.Run("a checkout that can no longer be paid", func(t *testing.T) {
		t.Parallel()

		env := newStoredCheckoutEnvWith(t, readbacktest.NewFixtureInBrowser(t), func(*platformpolicy.Policy) {})
		api := env.fixture.API()
		checkoutID := env.start(t)
		if _, err := env.pg.DB.ExecContext(t.Context(),
			`UPDATE payment_checkouts SET last_started_at = now() - make_interval(secs => $2) WHERE tenant_id = $1`,
			env.tenant.ID, (readbacktest.CheckoutLifetime + time.Minute).Seconds(),
		); err != nil {
			t.Fatalf("lapse the checkout: %v", err)
		}
		late := api.Authorize(env.credentials, checkoutID, "payment_late", 500, "USD", false, time.Now())
		if err := env.deliver(t, late); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("delivery error = %v, want InvalidArgument", err)
		}
		if got := api.NotificationReads(); got != 0 {
			t.Fatalf("notifications read from the provider = %d, want 0", got)
		}
	})
}

// One client spends its allowance of unsigned notifications at the tenant
// whatever the notifications name, and another client keeps its own.
func TestDBUnsignedNotificationsFromOneClientSpendItsAllowance(t *testing.T) {
	t.Parallel()

	env := newStoredCheckoutEnvWith(t, readbacktest.NewFixtureByCheckout(t), func(policy *platformpolicy.Policy) {
		policy.PaymentWebhookPerClient = platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1}
	})
	api := env.fixture.API()
	checkoutID := env.start(t)
	payload := api.Pay(env.credentials, checkoutID, "payment_allowance", 500, "USD", false, time.Now())
	if err := env.deliverFrom(t, "203.0.113.7", payload); err != nil {
		t.Fatalf("first delivery: %v", err)
	}
	if err := env.deliverFrom(t, "203.0.113.7", payload); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("second delivery error = %v, want ResourceExhausted", err)
	}
	if got := api.NotificationReads(); got != 1 {
		t.Fatalf("notifications read from the provider = %d, want 1", got)
	}
	if err := env.deliverFrom(t, "203.0.113.8", payload); err != nil {
		t.Fatalf("delivery from another client: %v", err)
	}
	if got := api.NotificationReads(); got != 2 {
		t.Fatalf("notifications read from the provider = %d, want 2", got)
	}
}
