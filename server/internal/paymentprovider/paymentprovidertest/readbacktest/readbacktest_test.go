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

// fixture is a fixture of the fake, of whichever shape.
type fixture interface {
	paymentprovidertest.Fixture
	API() *readbacktest.API
}

// fixtures answers the three shapes of the fake: one that names a payment by
// an id of its own, one that names it by its checkout's, and one whose test
// mode follows its credentials.
func fixtures(t testing.TB) []fixture {
	return []fixture{
		readbacktest.NewFixture(t),
		readbacktest.NewFixtureByCheckout(t),
		readbacktest.NewFixtureByCredentials(t),
	}
}

func TestReadBackProviderReadsItsNotifications(t *testing.T) {
	t.Parallel()

	for _, fixture := range fixtures(t) {
		t.Run(fixture.Provider().Declaration().ID, func(t *testing.T) {
			t.Parallel()
			// The registry's rules hold for the fake as for a registered
			// provider.
			paymentprovider.NewRegistry(fixture.Provider())
			paymentprovidertest.RunParse(t, fixture)
		})
	}
}

func TestReadBackProviderReportsARefundItHasNotSettled(t *testing.T) {
	t.Parallel()

	for _, fixture := range fixtures(t) {
		t.Run(fixture.Provider().Declaration().ID, func(t *testing.T) {
			t.Parallel()
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
