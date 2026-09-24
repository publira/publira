// Package paymentprovidertest is the contract every payment provider passes.
// A provider supplies a [Fixture] of its recorded notifications; [RunParse]
// checks the provider reads them, and [Run] checks the purchase flow does the
// right thing with them against a real database.
package paymentprovidertest

import (
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
)

// Checkout is a completed checkout a fixture signs a notification for.
type Checkout struct {
	CheckoutID string
	PaymentID  string
	Purchase   paymentprovider.Purchase
}

// Refund is a refund a fixture signs a notification for, in yen.
type Refund struct {
	PaymentID      string
	AmountRefunded int64
}

// Fixture is one provider's recorded notifications, signed on demand so that
// a provider whose signatures expire can still be tested.
type Fixture interface {
	// Credentials answers a tenant's credentials for the provider.
	Credentials() paymentprovider.Credentials
	// OtherCredentials answers credentials of the same shape that sign
	// differently, as another tenant's would.
	OtherCredentials() paymentprovider.Credentials
	// CheckoutCompleted answers the notification of a paid checkout.
	CheckoutCompleted(t testing.TB, credentials paymentprovider.Credentials, checkout Checkout) ([]byte, http.Header)
	// Refunded answers the notification of a refund in yen.
	Refunded(t testing.TB, credentials paymentprovider.Credentials, refund Refund) ([]byte, http.Header)
	// Unrelated answers a notification the purchase flow has no use for.
	Unrelated(t testing.TB, credentials paymentprovider.Credentials) ([]byte, http.Header)
}

// RunParse checks that provider reads the notifications fixture records.
func RunParse(t *testing.T, provider paymentprovider.Provider, fixture Fixture) {
	credentials := fixture.Credentials()
	checkout := Checkout{
		CheckoutID: "checkout_contract",
		PaymentID:  "payment_contract",
		Purchase: paymentprovider.Purchase{
			TenantID:           uuid.New(),
			ReaderID:           uuid.New(),
			EpisodeID:          uuid.New(),
			Price:              500,
			ReadingPeriodHours: 72,
		},
	}

	t.Run("a completed checkout names its purchase", func(t *testing.T) {
		payload, headers := fixture.CheckoutCompleted(t, credentials, checkout)
		event, err := provider.ParseNotification(payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		completed, ok := event.(paymentprovider.PurchaseCompleted)
		if !ok {
			t.Fatalf("event = %T, want PurchaseCompleted", event)
		}
		if completed.CheckoutID != checkout.CheckoutID || completed.PaymentID != checkout.PaymentID {
			t.Fatalf("ids = (%q, %q), want (%q, %q)", completed.CheckoutID, completed.PaymentID, checkout.CheckoutID, checkout.PaymentID)
		}
		if completed.Purchase != checkout.Purchase {
			t.Fatalf("purchase = %+v, want %+v", completed.Purchase, checkout.Purchase)
		}
	})

	t.Run("a refund names its payment and amount", func(t *testing.T) {
		payload, headers := fixture.Refunded(t, credentials, Refund{PaymentID: checkout.PaymentID, AmountRefunded: 200})
		event, err := provider.ParseNotification(payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		refunded, ok := event.(paymentprovider.Refunded)
		if !ok {
			t.Fatalf("event = %T, want Refunded", event)
		}
		if refunded.PaymentID != checkout.PaymentID || refunded.AmountRefunded != 200 || refunded.Currency != "JPY" {
			t.Fatalf("refund = %+v, want payment %q, 200 JPY", refunded, checkout.PaymentID)
		}
	})

	t.Run("an unrelated notification is ignored", func(t *testing.T) {
		payload, headers := fixture.Unrelated(t, credentials)
		event, err := provider.ParseNotification(payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if _, ok := event.(paymentprovider.Ignored); !ok {
			t.Fatalf("event = %T, want Ignored", event)
		}
	})

	t.Run("a notification signed with other credentials is refused", func(t *testing.T) {
		payload, headers := fixture.CheckoutCompleted(t, fixture.OtherCredentials(), checkout)
		if _, err := provider.ParseNotification(payload, headers, credentials); !errors.Is(err, paymentprovider.ErrInvalidSignature) {
			t.Fatalf("ParseNotification error = %v, want ErrInvalidSignature", err)
		}
	})

	t.Run("an unsigned notification is refused", func(t *testing.T) {
		payload, _ := fixture.CheckoutCompleted(t, credentials, checkout)
		if _, err := provider.ParseNotification(payload, http.Header{}, credentials); !errors.Is(err, paymentprovider.ErrInvalidSignature) {
			t.Fatalf("ParseNotification error = %v, want ErrInvalidSignature", err)
		}
	})

	t.Run("the declaration names the signature header and required fields", func(t *testing.T) {
		declaration := provider.Declaration()
		if declaration.SignatureHeader == "" {
			t.Fatal("SignatureHeader is empty")
		}
		if missing := declaration.Missing(credentials); len(missing) > 0 {
			t.Fatalf("fixture credentials miss required fields %v", missing)
		}
	})
}

// Harness is the purchase flow a provider's notifications are delivered to.
type Harness interface {
	// NewTenant answers a new tenant that takes payments through provider
	// with credentials, with one reader and one episode priced at 500 yen.
	NewTenant(t *testing.T, provider paymentprovider.Provider, credentials paymentprovider.Credentials) Tenant
}

// Tenant is one tenant of a [Harness].
type Tenant interface {
	// Purchase answers the reader's purchase of the episode, as a checkout
	// started for it would name it.
	Purchase() paymentprovider.Purchase
	// Deliver hands a notification to the purchase flow.
	Deliver(t *testing.T, payload []byte, headers http.Header) error
	// Purchases counts the tenant's purchases.
	Purchases(t *testing.T) int
	// RefundedAmount answers the refunded amount recorded on the tenant's only
	// purchase, zero when none is.
	RefundedAmount(t *testing.T) int32
	// HeldRefunds counts the refunds still waiting for their purchase.
	HeldRefunds(t *testing.T) int
}

// Run checks the purchase flow against provider's recorded notifications.
func Run(t *testing.T, harness Harness, provider paymentprovider.Provider, fixture Fixture) {
	credentials := fixture.Credentials()

	t.Run("a completed checkout creates one purchase however often it is delivered", func(t *testing.T) {
		tenant := harness.NewTenant(t, provider, credentials)
		payload, headers := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: "checkout_redelivered",
			PaymentID:  "payment_redelivered",
			Purchase:   tenant.Purchase(),
		})
		for delivery := range 3 {
			if err := tenant.Deliver(t, payload, headers); err != nil {
				t.Fatalf("delivery %d: %v", delivery+1, err)
			}
		}
		if got := tenant.Purchases(t); got != 1 {
			t.Fatalf("purchases = %d, want 1", got)
		}
	})

	t.Run("a refund before its purchase is held and applied later", func(t *testing.T) {
		tenant := harness.NewTenant(t, provider, credentials)
		refund, refundHeaders := fixture.Refunded(t, credentials, Refund{PaymentID: "payment_early", AmountRefunded: 500})
		if err := tenant.Deliver(t, refund, refundHeaders); err != nil {
			t.Fatalf("refund: %v", err)
		}
		if got := tenant.HeldRefunds(t); got != 1 {
			t.Fatalf("held refunds = %d, want 1", got)
		}
		checkout, checkoutHeaders := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: "checkout_early",
			PaymentID:  "payment_early",
			Purchase:   tenant.Purchase(),
		})
		if err := tenant.Deliver(t, checkout, checkoutHeaders); err != nil {
			t.Fatalf("checkout: %v", err)
		}
		if got := tenant.RefundedAmount(t); got != 500 {
			t.Fatalf("refunded amount = %d, want 500", got)
		}
		if got := tenant.HeldRefunds(t); got != 0 {
			t.Fatalf("held refunds = %d, want 0", got)
		}
	})

	t.Run("a notification with a bad signature is refused", func(t *testing.T) {
		tenant := harness.NewTenant(t, provider, credentials)
		payload, headers := fixture.CheckoutCompleted(t, fixture.OtherCredentials(), Checkout{
			CheckoutID: "checkout_forged",
			PaymentID:  "payment_forged",
			Purchase:   tenant.Purchase(),
		})
		if err := tenant.Deliver(t, payload, headers); err == nil {
			t.Fatal("a forged notification was accepted")
		}
		if got := tenant.Purchases(t); got != 0 {
			t.Fatalf("purchases = %d, want 0", got)
		}
	})

	t.Run("a checkout naming another tenant creates nothing", func(t *testing.T) {
		tenant := harness.NewTenant(t, provider, credentials)
		other := harness.NewTenant(t, provider, fixture.OtherCredentials())
		payload, headers := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: "checkout_crossed",
			PaymentID:  "payment_crossed",
			Purchase:   other.Purchase(),
		})
		if err := tenant.Deliver(t, payload, headers); err == nil {
			t.Fatal("a checkout naming another tenant was accepted")
		}
		if got := tenant.Purchases(t) + other.Purchases(t); got != 0 {
			t.Fatalf("purchases = %d, want 0", got)
		}
	})
}
