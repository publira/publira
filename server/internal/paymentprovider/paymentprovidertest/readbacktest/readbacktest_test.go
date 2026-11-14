package readbacktest_test

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest/readbacktest"
)

// fixtures are the two shapes of the fake: one that names a payment by an id
// of its own, and one that names it by its checkout's.
var fixtures = map[string]func(testing.TB) *readbacktest.Fixture{
	readbacktest.ID:           readbacktest.NewFixture,
	readbacktest.IDByCheckout: readbacktest.NewFixtureByCheckout,
}

func TestReadBackProviderReadsItsNotifications(t *testing.T) {
	t.Parallel()

	for id, newFixture := range fixtures {
		t.Run(id, func(t *testing.T) {
			t.Parallel()
			fixture := newFixture(t)
			// The registry's rules hold for the fake as for a registered
			// provider.
			paymentprovider.NewRegistry(fixture.Provider())
			paymentprovidertest.RunParse(t, fixture)
		})
	}
}

func TestReadBackProviderReportsARefundItHasNotSettled(t *testing.T) {
	t.Parallel()

	for id, newFixture := range fixtures {
		t.Run(id, func(t *testing.T) {
			t.Parallel()
			fixture := newFixture(t)
			provider := fixture.Provider()
			follower := provider.(paymentprovider.RefundFollower)
			credentials := fixture.Credentials()
			fixture.API().Pay(credentials, "checkout_pending", "payment_pending", 500, "JPY", false, testTime)
			paymentID := fixture.API().PaymentID("checkout_pending", "payment_pending")
			fixture.API().HoldNextRefund(credentials, paymentID)
			if _, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paymentID, IdempotencyKey: "refund_pending"}); err != nil {
				t.Fatalf("Refund: %v", err)
			}
			read := func() (paymentprovider.Event, error) {
				return provider.ParseNotification(t.Context(), follower.RefundNotification(paymentID), http.Header{}, credentials)
			}
			if _, err := read(); !errors.Is(err, paymentprovider.ErrRefundPending) {
				t.Fatalf("ParseNotification error = %v, want ErrRefundPending", err)
			}
			fixture.API().SettleRefunds(credentials, paymentID, false)
			event, err := read()
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			if refunded, ok := event.(paymentprovider.Refunded); !ok || refunded.AmountRefunded != 500 || refunded.PaymentID != paymentID {
				t.Fatalf("event = %+v, want a refund of 500 on %q", event, paymentID)
			}
		})
	}
}

// testTime is an instant no list of a period in these tests reads.
var testTime = time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
