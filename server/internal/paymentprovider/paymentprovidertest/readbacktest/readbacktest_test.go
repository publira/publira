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

func TestReadBackProviderReadsItsNotifications(t *testing.T) {
	t.Parallel()

	fixture := readbacktest.NewFixture(t)
	// The registry's rules hold for the fake as for a registered provider.
	paymentprovider.NewRegistry(fixture.Provider())
	paymentprovidertest.RunParse(t, fixture)
}

func TestReadBackProviderReportsARefundItHasNotSettled(t *testing.T) {
	t.Parallel()

	fixture := readbacktest.NewFixture(t)
	provider := fixture.Provider()
	follower := provider.(paymentprovider.RefundFollower)
	credentials := fixture.Credentials()
	fixture.API().Pay(credentials, "checkout_pending", "payment_pending", 500, "JPY", false, testTime)
	fixture.API().HoldNextRefund(credentials, "payment_pending")
	if _, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: "payment_pending", IdempotencyKey: "refund_pending"}); err != nil {
		t.Fatalf("Refund: %v", err)
	}
	read := func() (paymentprovider.Event, error) {
		return provider.ParseNotification(t.Context(), follower.RefundNotification("payment_pending"), http.Header{}, credentials)
	}
	if _, err := read(); !errors.Is(err, paymentprovider.ErrRefundPending) {
		t.Fatalf("ParseNotification error = %v, want ErrRefundPending", err)
	}
	fixture.API().SettleRefunds(credentials, "payment_pending", false)
	event, err := read()
	if err != nil {
		t.Fatalf("ParseNotification: %v", err)
	}
	if refunded, ok := event.(paymentprovider.Refunded); !ok || refunded.AmountRefunded != 500 {
		t.Fatalf("event = %+v, want a refund of 500", event)
	}
}

// testTime is an instant no list of a period in these tests reads.
var testTime = time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
