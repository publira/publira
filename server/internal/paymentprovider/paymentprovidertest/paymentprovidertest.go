// Package paymentprovidertest is the contract every payment provider passes.
// A provider supplies a [Fixture] of its notifications and of its API;
// [RunParse] checks the provider reads the notifications and refunds through
// the API, and [Run] checks the purchase flow does the right thing with the
// notifications against a real database.
package paymentprovidertest

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
)

// Checkout is a completed checkout a fixture signs a notification for.
type Checkout struct {
	CheckoutID string
	PaymentID  string
	Purchase   paymentprovider.Purchase
	// Test makes it a checkout paid in the provider's test mode, and its
	// absence one paid in live mode.
	Test bool
}

// Refund is a refund a fixture signs a notification for.
type Refund struct {
	PaymentID string
	// Currency is the ISO 4217 code of the payment the refund is on, in
	// capitals.
	Currency string
	// AmountRefunded is the total refunded on the payment once this refund
	// has gone through, so a later Refund on the same payment adds to an
	// earlier one.
	AmountRefunded int64
	// Key is the idempotency key the refund that fails was made under, when
	// it was a refund of an amount.
	Key string
}

// SubscriptionPayment is a paid invoice of a plan's subscription a fixture
// signs a notification for.
type SubscriptionPayment struct {
	InvoiceID      string
	SubscriptionID string
	// PaymentID is the payment the invoice was paid through, which its refunds
	// name.
	PaymentID string
	// TenantID, ReaderID, and PlanID are what the checkout that started the
	// subscription named.
	TenantID uuid.UUID
	ReaderID uuid.UUID
	PlanID   uuid.UUID
	Amount   int64
	Currency string
	// PeriodStart and PeriodEnd bound the period the invoice paid for, to the
	// second.
	PeriodStart time.Time
	PeriodEnd   time.Time
	// Test makes it a payment made in the provider's test mode.
	Test bool
}

// SubscriptionFixture is the fixture of a provider that sells subscription
// plans, which also signs the notification of a plan's paid invoice.
type SubscriptionFixture interface {
	Fixture
	// SubscriptionPaid answers the notification of a paid invoice, and makes
	// the provider's API report payment.PaymentID as what paid it.
	SubscriptionPaid(t testing.TB, credentials paymentprovider.Credentials, payment SubscriptionPayment) ([]byte, http.Header)
}

// Fixture is one provider's notifications, signed on demand so that a
// provider whose signatures expire can still be tested.
type Fixture interface {
	// Provider answers the provider as the fixture's notifications reach it,
	// reading the fixture's fake of its API where it reads one.
	Provider() paymentprovider.Provider
	// Credentials answers a tenant's credentials for the provider.
	Credentials() paymentprovider.Credentials
	// OtherCredentials answers credentials of the same shape that sign
	// differently, as another tenant's would.
	OtherCredentials() paymentprovider.Credentials
	// CheckoutCompleted answers the notification of a paid checkout, and
	// makes its payment one the provider's API reports as paid, in the mode
	// the checkout names.
	CheckoutCompleted(t testing.TB, credentials paymentprovider.Credentials, checkout Checkout) ([]byte, http.Header)
	// PaymentTaken makes the provider's API list the payment of checkout among
	// the payments taken at at, in the mode the checkout names, as a checkout
	// paid with no notification sent for it leaves it.
	PaymentTaken(t testing.TB, credentials paymentprovider.Credentials, checkout Checkout, at time.Time)
	// Refunded answers the notification of a refund, and makes the refund part
	// of what the provider's API reports for the payment.
	Refunded(t testing.TB, credentials paymentprovider.Credentials, refund Refund) ([]byte, http.Header)
	// RefundedTotal answers the total the provider's API reports refunded on
	// the payment, in the minor unit of its currency.
	RefundedTotal(t testing.TB, credentials paymentprovider.Credentials, paymentID string) int64
	// FailNextRefund makes the next refund the provider's API creates on the
	// payment one it answers as failed.
	FailNextRefund(t testing.TB, credentials paymentprovider.Credentials, paymentID string)
	// ForgetIdempotencyKeys makes the provider's API forget the refund every
	// idempotency key under the credentials created, as a provider forgets a
	// key in time.
	ForgetIdempotencyKeys(t testing.TB, credentials paymentprovider.Credentials)
	// RefundFailed answers the notification that a refund on the payment
	// failed after it was accepted, and makes the provider's API report
	// refund.AmountRefunded as what stays refunded on it.
	RefundFailed(t testing.TB, credentials paymentprovider.Credentials, refund Refund) ([]byte, http.Header)
	// Unrelated answers a notification the purchase flow has no use for.
	Unrelated(t testing.TB, credentials paymentprovider.Credentials) ([]byte, http.Header)
}

// contractCurrencies are the currencies the contract charges in, where the
// provider declares them: one without decimals and one with two, so that a
// provider is seen to carry the amount in the minor unit either way.
var contractCurrencies = []string{"JPY", "USD"}

// Currencies answers the currencies the contract runs a provider in: those of
// contractCurrencies it declares, or else the first it declares.
func Currencies(declaration paymentprovider.Declaration) []string {
	var currencies []string
	for _, currency := range contractCurrencies {
		if declaration.Charges(currency) {
			currencies = append(currencies, currency)
		}
	}
	if len(currencies) == 0 && len(declaration.Currencies) > 0 {
		currencies = append(currencies, declaration.Currencies[0])
	}
	return currencies
}

// RunParse checks that the fixture's provider reads its notifications, in
// every currency [Currencies] answers for it.
func RunParse(t *testing.T, fixture Fixture) {
	t.Run("the declaration names the signature header and required fields", func(t *testing.T) {
		declaration := fixture.Provider().Declaration()
		if declaration.SignatureHeader == "" {
			t.Fatal("SignatureHeader is empty")
		}
		if missing := declaration.Missing(fixture.Credentials()); len(missing) > 0 {
			t.Fatalf("fixture credentials miss required fields %v", missing)
		}
	})
	for _, currency := range Currencies(fixture.Provider().Declaration()) {
		t.Run(currency, func(t *testing.T) {
			runParse(t, fixture, currency)
			runListTransactions(t, fixture, currency)
		})
	}
}

// runListTransactions checks that the provider lists the payments of a period
// from its API, oldest first, with the refunds made on them, and none of
// another account's.
func runListTransactions(t *testing.T, fixture Fixture, currency string) {
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	// Real instants around now, since a provider's refunds are dated when
	// they are made.
	to := time.Now().Add(time.Hour).Truncate(time.Second)
	from := to.Add(-3 * time.Hour)
	taken := func(paymentID string, price int32, test bool, at time.Time) Checkout {
		checkout := Checkout{
			CheckoutID: "checkout_" + paymentID,
			PaymentID:  paymentID,
			Purchase: paymentprovider.Purchase{
				TenantID:  uuid.New(),
				ReaderID:  uuid.New(),
				EpisodeID: uuid.New(),
				Kind:      paymentprovider.KindPurchase,
				Price:     price,
				Currency:  currency,
			},
			Test: test,
		}
		fixture.PaymentTaken(t, credentials, checkout, at)
		return checkout
	}
	live := taken("payment_list_live_"+currency, 500, false, from.Add(time.Hour))
	test := taken("payment_list_test_"+currency, 300, true, from.Add(2*time.Hour))
	taken("payment_list_before_"+currency, 700, false, from.Add(-time.Hour))
	taken("payment_list_after_"+currency, 900, false, to.Add(time.Hour))
	_, _ = fixture.Refunded(t, credentials, Refund{PaymentID: live.PaymentID, Currency: currency, AmountRefunded: 200})

	t.Run("the payments of the period are listed oldest first with their refunds", func(t *testing.T) {
		listed, err := provider.ListTransactions(t.Context(), credentials, from, to)
		if err != nil {
			t.Fatalf("ListTransactions: %v", err)
		}
		// The fixture's account is shared by the run of every currency.
		var transactions []paymentprovider.Transaction
		for _, transaction := range listed {
			if transaction.Currency == currency {
				transactions = append(transactions, transaction)
			}
		}
		want := []paymentprovider.Transaction{
			{PaymentID: live.PaymentID, Amount: 500, AmountRefunded: 200, Currency: currency, Test: false, Created: from.Add(time.Hour).UTC()},
			{PaymentID: test.PaymentID, Amount: 300, Currency: currency, Test: true, Created: from.Add(2 * time.Hour).UTC()},
		}
		if len(transactions) != len(want) {
			t.Fatalf("transactions = %+v, want %+v", transactions, want)
		}
		for i := range want {
			if transactions[i] != want[i] {
				t.Fatalf("transaction %d = %+v, want %+v", i, transactions[i], want[i])
			}
		}
	})

	t.Run("another account's payments are not listed", func(t *testing.T) {
		transactions, err := provider.ListTransactions(t.Context(), fixture.OtherCredentials(), from, to)
		if err != nil {
			t.Fatalf("ListTransactions: %v", err)
		}
		if len(transactions) != 0 {
			t.Fatalf("transactions = %+v, want none", transactions)
		}
	})
}

func runParse(t *testing.T, fixture Fixture, currency string) {
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	checkout := Checkout{
		CheckoutID: "checkout_contract",
		PaymentID:  "payment_contract",
		Purchase: paymentprovider.Purchase{
			TenantID:           uuid.New(),
			ReaderID:           uuid.New(),
			EpisodeID:          uuid.New(),
			Kind:               paymentprovider.KindPurchase,
			Price:              500,
			Currency:           currency,
			ReadingPeriodHours: 72,
		},
	}

	t.Run("a completed checkout names its purchase", func(t *testing.T) {
		payload, headers := fixture.CheckoutCompleted(t, credentials, checkout)
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
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
		// A checkout the reader entered no promotion code at was paid its
		// price, which is what the purchase records.
		if completed.AmountPaid != checkout.Purchase.Price || completed.PromotionCodeID != "" {
			t.Fatalf("paid %d with promotion code %q, want %d with none", completed.AmountPaid, completed.PromotionCodeID, checkout.Purchase.Price)
		}
		if completed.Test {
			t.Fatal("a live-mode checkout is reported as a test")
		}
	})

	t.Run("a rental checkout names its kind", func(t *testing.T) {
		rental := checkout
		rental.CheckoutID = "checkout_contract_rental"
		rental.Purchase.Kind = paymentprovider.KindRental
		rental.Purchase.Price = 200
		rental.Purchase.ReadingPeriodHours = 48
		payload, headers := fixture.CheckoutCompleted(t, credentials, rental)
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		completed, ok := event.(paymentprovider.PurchaseCompleted)
		if !ok {
			t.Fatalf("event = %T, want PurchaseCompleted", event)
		}
		if completed.Purchase != rental.Purchase {
			t.Fatalf("purchase = %+v, want %+v", completed.Purchase, rental.Purchase)
		}
	})

	t.Run("a rental that names no period is malformed", func(t *testing.T) {
		unbounded := checkout
		unbounded.CheckoutID = "checkout_contract_unbounded_rental"
		unbounded.Purchase.Kind = paymentprovider.KindRental
		unbounded.Purchase.ReadingPeriodHours = 0
		payload, headers := fixture.CheckoutCompleted(t, credentials, unbounded)
		if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
			t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
		}
	})

	t.Run("a volume checkout names its volume and no episode", func(t *testing.T) {
		volume := checkout
		volume.CheckoutID = "checkout_contract_volume"
		volume.Purchase.EpisodeID = uuid.Nil
		volume.Purchase.VolumeID = uuid.New()
		volume.Purchase.Price = 1500
		volume.Purchase.ReadingPeriodHours = 0
		payload, headers := fixture.CheckoutCompleted(t, credentials, volume)
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		completed, ok := event.(paymentprovider.PurchaseCompleted)
		if !ok {
			t.Fatalf("event = %T, want PurchaseCompleted", event)
		}
		if completed.Purchase != volume.Purchase {
			t.Fatalf("purchase = %+v, want %+v", completed.Purchase, volume.Purchase)
		}
	})

	t.Run("a checkout that names both an episode and a volume is malformed", func(t *testing.T) {
		both := checkout
		both.CheckoutID = "checkout_contract_both"
		both.Purchase.VolumeID = uuid.New()
		both.Purchase.ReadingPeriodHours = 0
		payload, headers := fixture.CheckoutCompleted(t, credentials, both)
		if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
			t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
		}
	})

	t.Run("a volume checkout with a reading period is malformed", func(t *testing.T) {
		bounded := checkout
		bounded.CheckoutID = "checkout_contract_bounded_volume"
		bounded.Purchase.EpisodeID = uuid.Nil
		bounded.Purchase.VolumeID = uuid.New()
		payload, headers := fixture.CheckoutCompleted(t, credentials, bounded)
		if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
			t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
		}
	})

	t.Run("a series bundle checkout names its bundle and no episode", func(t *testing.T) {
		bundle := checkout
		bundle.CheckoutID = "checkout_contract_series_bundle"
		bundle.Purchase.EpisodeID = uuid.Nil
		bundle.Purchase.SeriesBundleID = uuid.New()
		bundle.Purchase.Price = 2700
		bundle.Purchase.ReadingPeriodHours = 0
		payload, headers := fixture.CheckoutCompleted(t, credentials, bundle)
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		completed, ok := event.(paymentprovider.PurchaseCompleted)
		if !ok {
			t.Fatalf("event = %T, want PurchaseCompleted", event)
		}
		if completed.Purchase != bundle.Purchase {
			t.Fatalf("purchase = %+v, want %+v", completed.Purchase, bundle.Purchase)
		}
	})

	t.Run("a checkout that names both an episode and a series bundle is malformed", func(t *testing.T) {
		both := checkout
		both.CheckoutID = "checkout_contract_episode_and_bundle"
		both.Purchase.SeriesBundleID = uuid.New()
		both.Purchase.ReadingPeriodHours = 0
		payload, headers := fixture.CheckoutCompleted(t, credentials, both)
		if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
			t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
		}
	})

	t.Run("a checkout that names both a volume and a series bundle is malformed", func(t *testing.T) {
		both := checkout
		both.CheckoutID = "checkout_contract_volume_and_bundle"
		both.Purchase.EpisodeID = uuid.Nil
		both.Purchase.VolumeID = uuid.New()
		both.Purchase.SeriesBundleID = uuid.New()
		both.Purchase.ReadingPeriodHours = 0
		payload, headers := fixture.CheckoutCompleted(t, credentials, both)
		if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
			t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
		}
	})

	t.Run("a series bundle checkout with a reading period is malformed", func(t *testing.T) {
		bounded := checkout
		bounded.CheckoutID = "checkout_contract_bounded_series_bundle"
		bounded.Purchase.EpisodeID = uuid.Nil
		bounded.Purchase.SeriesBundleID = uuid.New()
		payload, headers := fixture.CheckoutCompleted(t, credentials, bounded)
		if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
			t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
		}
	})

	coinPack := func(id string) Checkout {
		pack := checkout
		pack.CheckoutID = id
		pack.Purchase.EpisodeID = uuid.Nil
		pack.Purchase.CoinPackID = uuid.New()
		pack.Purchase.Coins = 1000
		pack.Purchase.BonusCoins = 100
		pack.Purchase.CoinExpiryDays = 180
		pack.Purchase.Price = 1000
		pack.Purchase.ReadingPeriodHours = 0
		return pack
	}

	t.Run("a coin pack checkout names its pack and what it grants", func(t *testing.T) {
		pack := coinPack("checkout_contract_coin_pack")
		payload, headers := fixture.CheckoutCompleted(t, credentials, pack)
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		completed, ok := event.(paymentprovider.PurchaseCompleted)
		if !ok {
			t.Fatalf("event = %T, want PurchaseCompleted", event)
		}
		if completed.Purchase != pack.Purchase {
			t.Fatalf("purchase = %+v, want %+v", completed.Purchase, pack.Purchase)
		}
	})

	t.Run("a checkout that names both an episode and a coin pack is malformed", func(t *testing.T) {
		both := coinPack("checkout_contract_episode_and_coin_pack")
		both.Purchase.EpisodeID = uuid.New()
		payload, headers := fixture.CheckoutCompleted(t, credentials, both)
		if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
			t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
		}
	})

	t.Run("a coin pack checkout that grants nothing or never expires is malformed", func(t *testing.T) {
		for _, malformed := range []func(*Checkout){
			func(c *Checkout) { c.Purchase.Coins = 0 },
			func(c *Checkout) { c.Purchase.BonusCoins = -1 },
			func(c *Checkout) { c.Purchase.CoinExpiryDays = 0 },
			func(c *Checkout) { c.Purchase.CoinExpiryDays = paymentprovider.MaxCoinExpiryDays + 1 },
			func(c *Checkout) { c.Purchase.ReadingPeriodHours = 24 },
		} {
			pack := coinPack("checkout_contract_malformed_coin_pack")
			malformed(&pack)
			payload, headers := fixture.CheckoutCompleted(t, credentials, pack)
			if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
				t.Fatalf("ParseNotification(%+v) error = %v, want ErrMalformedNotification", pack.Purchase, err)
			}
		}
	})

	t.Run("a checkout that names no kind sold the permanent copy", func(t *testing.T) {
		unnamed := checkout
		unnamed.CheckoutID = "checkout_contract_unnamed"
		unnamed.Purchase.Kind = ""
		payload, headers := fixture.CheckoutCompleted(t, credentials, unnamed)
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		completed, ok := event.(paymentprovider.PurchaseCompleted)
		if !ok {
			t.Fatalf("event = %T, want PurchaseCompleted", event)
		}
		if completed.Purchase.Kind != paymentprovider.KindPurchase {
			t.Fatalf("kind = %q, want %q", completed.Purchase.Kind, paymentprovider.KindPurchase)
		}
	})

	t.Run("a test-mode checkout is reported as a test", func(t *testing.T) {
		testCheckout := checkout
		testCheckout.Test = true
		payload, headers := fixture.CheckoutCompleted(t, credentials, testCheckout)
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		completed, ok := event.(paymentprovider.PurchaseCompleted)
		if !ok {
			t.Fatalf("event = %T, want PurchaseCompleted", event)
		}
		if !completed.Test {
			t.Fatal("a test-mode checkout is reported as a live one")
		}
	})

	t.Run("a refund names its payment, amount, and currency", func(t *testing.T) {
		payload, headers := fixture.Refunded(t, credentials, Refund{PaymentID: checkout.PaymentID, Currency: currency, AmountRefunded: 200})
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		refunded, ok := event.(paymentprovider.Refunded)
		if !ok {
			t.Fatalf("event = %T, want Refunded", event)
		}
		if refunded.PaymentID != checkout.PaymentID || refunded.AmountRefunded != 200 || refunded.Currency != currency {
			t.Fatalf("refund = %+v, want payment %q, 200 %s", refunded, checkout.PaymentID, currency)
		}
	})

	if subscriptions, ok := fixture.(SubscriptionFixture); ok {
		runParseSubscriptionPayments(t, subscriptions, currency)
	}

	t.Run("an unrelated notification is ignored", func(t *testing.T) {
		payload, headers := fixture.Unrelated(t, credentials)
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if _, ok := event.(paymentprovider.Ignored); !ok {
			t.Fatalf("event = %T, want Ignored", event)
		}
	})

	t.Run("a refund returns the whole payment once however often it is asked for", func(t *testing.T) {
		paid := checkout
		paid.PaymentID = "payment_refund_" + strings.ToLower(currency)
		fixture.CheckoutCompleted(t, credentials, paid)
		key := "refund_contract_" + strings.ToLower(currency)
		refund := func(key string) bool {
			t.Helper()
			refunded, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key})
			if err != nil {
				t.Fatalf("Refund with key %q: %v", key, err)
			}
			if got, want := fixture.RefundedTotal(t, credentials, paid.PaymentID), int64(paid.Purchase.Price); got != want {
				t.Fatalf("refunded total after the key %q = %d, want %d", key, got, want)
			}
			return refunded
		}
		if !refund(key) {
			t.Fatal("the first refund reports refunding nothing")
		}
		// A provider may answer a repeated key with the refund it made, so
		// the repeat says nothing about what was refunded.
		refund(key)
		// Another key stands for a repeat made after the provider has
		// forgotten the first, as one for a refund made in its dashboard.
		if refund(key + "_later") {
			t.Fatal("a refund of a payment refunded in full reports refunding something")
		}
	})

	t.Run("a refund after a partial one returns the rest", func(t *testing.T) {
		paid := checkout
		paid.PaymentID = "payment_refund_rest_" + strings.ToLower(currency)
		fixture.CheckoutCompleted(t, credentials, paid)
		fixture.Refunded(t, credentials, Refund{PaymentID: paid.PaymentID, Currency: currency, AmountRefunded: 200})
		refunded, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: "refund_contract_rest_" + strings.ToLower(currency)})
		if err != nil {
			t.Fatalf("Refund: %v", err)
		}
		if !refunded {
			t.Fatal("the refund of the rest reports refunding nothing")
		}
		if got, want := fixture.RefundedTotal(t, credentials, paid.PaymentID), int64(paid.Purchase.Price); got != want {
			t.Fatalf("refunded total = %d, want %d", got, want)
		}
	})

	t.Run("a refund of an amount returns that much once however often it is asked for", func(t *testing.T) {
		paid := checkout
		paid.PaymentID = "payment_refund_amount_" + strings.ToLower(currency)
		fixture.CheckoutCompleted(t, credentials, paid)
		key := "refund_contract_amount_" + strings.ToLower(currency)
		refund := func(key string, amount, want int64) {
			t.Helper()
			refunded, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key, Amount: amount})
			if err != nil {
				t.Fatalf("Refund of %d with key %q: %v", amount, key, err)
			}
			if !refunded {
				t.Fatalf("the refund of %d with key %q reports refunding nothing", amount, key)
			}
			if got := fixture.RefundedTotal(t, credentials, paid.PaymentID); got != want {
				t.Fatalf("refunded total after %d with key %q = %d, want %d", amount, key, got, want)
			}
		}
		refund(key, 300, 300)
		refund(key, 300, 300)
		// The next attempt is another key, which refunds again, as far as the
		// price and no further.
		refund(key+"_next", 100, 400)
		_, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key + "_over", Amount: int64(paid.Purchase.Price)})
		if !errors.Is(err, paymentprovider.ErrRefundRefused) {
			t.Fatalf("Refund of more than is left: error = %v, want ErrRefundRefused", err)
		}
		if got := fixture.RefundedTotal(t, credentials, paid.PaymentID); got != 400 {
			t.Fatalf("refunded total after a refund of more than is left = %d, want 400", got)
		}
	})

	t.Run("a refund of an amount is told apart from the payment's other refunds by its key", func(t *testing.T) {
		paid := checkout
		paid.PaymentID = "payment_refund_amount_made_" + strings.ToLower(currency)
		fixture.CheckoutCompleted(t, credentials, paid)
		key := "refund_contract_amount_made_" + strings.ToLower(currency)
		made := func(key string, want bool) {
			t.Helper()
			got, err := provider.RefundMade(t.Context(), credentials, paid.PaymentID, key)
			if err != nil {
				t.Fatalf("RefundMade with key %q: %v", key, err)
			}
			if got != want {
				t.Fatalf("RefundMade with key %q = %v, want %v", key, got, want)
			}
		}
		made(key, false)
		if _, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key, Amount: 300}); err != nil {
			t.Fatalf("Refund: %v", err)
		}
		made(key, true)
		made(key+"_other", false)
		fixture.FailNextRefund(t, credentials, paid.PaymentID)
		if _, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key + "_failed", Amount: 100}); !errors.Is(err, paymentprovider.ErrRefundRefused) {
			t.Fatalf("Refund the provider fails: error = %v, want ErrRefundRefused", err)
		}
		made(key+"_failed", false)
	})

	t.Run("a refund of an amount is found again once the provider has forgotten its key", func(t *testing.T) {
		paid := checkout
		paid.PaymentID = "payment_refund_amount_forgotten_" + strings.ToLower(currency)
		fixture.CheckoutCompleted(t, credentials, paid)
		key := "refund_contract_amount_forgotten_" + strings.ToLower(currency)
		request := paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key, Amount: 300}
		if _, err := provider.Refund(t.Context(), credentials, request); err != nil {
			t.Fatalf("Refund: %v", err)
		}
		fixture.ForgetIdempotencyKeys(t, credentials)
		refunded, err := provider.Refund(t.Context(), credentials, request)
		if err != nil {
			t.Fatalf("Refund once the key is forgotten: %v", err)
		}
		if !refunded {
			t.Fatal("the refund found again reports refunding nothing")
		}
		if got := fixture.RefundedTotal(t, credentials, paid.PaymentID); got != 300 {
			t.Fatalf("refunded total once the key is forgotten = %d, want 300", got)
		}

		failed := paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key + "_failed", Amount: 100}
		fixture.FailNextRefund(t, credentials, paid.PaymentID)
		if _, err := provider.Refund(t.Context(), credentials, failed); !errors.Is(err, paymentprovider.ErrRefundRefused) {
			t.Fatalf("Refund the provider fails: error = %v, want ErrRefundRefused", err)
		}
		fixture.ForgetIdempotencyKeys(t, credentials)
		if _, err := provider.Refund(t.Context(), credentials, failed); !errors.Is(err, paymentprovider.ErrRefundRefused) {
			t.Fatalf("Refund the provider failed once its key is forgotten: error = %v, want ErrRefundRefused", err)
		}
		if got := fixture.RefundedTotal(t, credentials, paid.PaymentID); got != 300 {
			t.Fatalf("refunded total after the failed refund = %d, want 300", got)
		}
	})

	t.Run("a refund the provider answers as failed is refused", func(t *testing.T) {
		paid := checkout
		paid.PaymentID = "payment_refund_failed_" + strings.ToLower(currency)
		fixture.CheckoutCompleted(t, credentials, paid)
		fixture.FailNextRefund(t, credentials, paid.PaymentID)
		_, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: "refund_contract_failed_" + strings.ToLower(currency)})
		if !errors.Is(err, paymentprovider.ErrRefundRefused) {
			t.Fatalf("Refund error = %v, want ErrRefundRefused", err)
		}
		if got := fixture.RefundedTotal(t, credentials, paid.PaymentID); got != 0 {
			t.Fatalf("refunded total = %d, want 0", got)
		}
	})

	t.Run("a refund that fails later names its payment and what stays refunded", func(t *testing.T) {
		paid := checkout
		paid.PaymentID = "payment_refund_failed_later_" + strings.ToLower(currency)
		fixture.CheckoutCompleted(t, credentials, paid)
		fixture.Refunded(t, credentials, Refund{PaymentID: paid.PaymentID, Currency: currency, AmountRefunded: 200})
		fixture.Refunded(t, credentials, Refund{PaymentID: paid.PaymentID, Currency: currency, AmountRefunded: 500})
		payload, headers := fixture.RefundFailed(t, credentials, Refund{PaymentID: paid.PaymentID, Currency: currency, AmountRefunded: 200})
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		failed, ok := event.(paymentprovider.RefundFailed)
		if !ok {
			t.Fatalf("event = %T, want RefundFailed", event)
		}
		if failed.PaymentID != paid.PaymentID || failed.AmountRefunded != 200 || failed.Currency != currency || failed.RefundKey != "" {
			t.Fatalf("failed refund = %+v, want 200 %s staying refunded on %q, under no key", failed, currency, paid.PaymentID)
		}
	})

	t.Run("a refund of an amount that fails later names the key it was made under", func(t *testing.T) {
		paid := checkout
		paid.PaymentID = "payment_refund_amount_failed_later_" + strings.ToLower(currency)
		fixture.CheckoutCompleted(t, credentials, paid)
		key := "refund_contract_amount_failed_later_" + strings.ToLower(currency)
		if _, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key, Amount: 300}); err != nil {
			t.Fatalf("Refund: %v", err)
		}
		payload, headers := fixture.RefundFailed(t, credentials, Refund{PaymentID: paid.PaymentID, Currency: currency, AmountRefunded: 0, Key: key})
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		failed, ok := event.(paymentprovider.RefundFailed)
		if !ok {
			t.Fatalf("event = %T, want RefundFailed", event)
		}
		if failed.PaymentID != paid.PaymentID || failed.AmountRefunded != 0 || failed.RefundKey != key {
			t.Fatalf("failed refund = %+v, want nothing staying refunded on %q, under key %q", failed, paid.PaymentID, key)
		}
	})

	t.Run("a refund of a payment the account does not hold is refused", func(t *testing.T) {
		paid := checkout
		paid.PaymentID = "payment_refund_other_" + strings.ToLower(currency)
		fixture.CheckoutCompleted(t, fixture.OtherCredentials(), paid)
		_, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: "refund_contract_other_" + strings.ToLower(currency)})
		if !errors.Is(err, paymentprovider.ErrRefundRefused) {
			t.Fatalf("Refund error = %v, want ErrRefundRefused", err)
		}
		if got := fixture.RefundedTotal(t, fixture.OtherCredentials(), paid.PaymentID); got != 0 {
			t.Fatalf("refunded total under the other account = %d, want 0", got)
		}
	})

	t.Run("a notification signed with other credentials is refused", func(t *testing.T) {
		payload, headers := fixture.CheckoutCompleted(t, fixture.OtherCredentials(), checkout)
		if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrInvalidSignature) {
			t.Fatalf("ParseNotification error = %v, want ErrInvalidSignature", err)
		}
	})

	t.Run("an unsigned notification is refused", func(t *testing.T) {
		payload, _ := fixture.CheckoutCompleted(t, credentials, checkout)
		if _, err := provider.ParseNotification(t.Context(), payload, http.Header{}, credentials); !errors.Is(err, paymentprovider.ErrInvalidSignature) {
			t.Fatalf("ParseNotification error = %v, want ErrInvalidSignature", err)
		}
	})
}

// runParseSubscriptionPayments checks that a provider that sells subscription
// plans reads the notification of a plan's paid invoice.
func runParseSubscriptionPayments(t *testing.T, fixture SubscriptionFixture, currency string) {
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	start := time.Date(2026, time.March, 2, 0, 0, 0, 0, time.UTC)
	payment := SubscriptionPayment{
		InvoiceID:      "invoice_contract_" + strings.ToLower(currency),
		SubscriptionID: "subscription_contract",
		PaymentID:      "payment_subscription_contract_" + strings.ToLower(currency),
		TenantID:       uuid.New(),
		ReaderID:       uuid.New(),
		PlanID:         uuid.New(),
		Amount:         980,
		Currency:       currency,
		PeriodStart:    start,
		PeriodEnd:      start.AddDate(0, 1, 0),
	}

	t.Run("a paid subscription invoice names its subscription, payment, amount, and period", func(t *testing.T) {
		payload, headers := fixture.SubscriptionPaid(t, credentials, payment)
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		paid, ok := event.(paymentprovider.SubscriptionPaid)
		if !ok {
			t.Fatalf("event = %T, want SubscriptionPaid", event)
		}
		if paid.InvoiceID != payment.InvoiceID || paid.SubscriptionID != payment.SubscriptionID || paid.PaymentID != payment.PaymentID {
			t.Fatalf("ids = (%q, %q, %q), want (%q, %q, %q)", paid.InvoiceID, paid.SubscriptionID, paid.PaymentID, payment.InvoiceID, payment.SubscriptionID, payment.PaymentID)
		}
		if paid.Amount != payment.Amount || paid.Currency != currency {
			t.Fatalf("paid %d %s, want %d %s", paid.Amount, paid.Currency, payment.Amount, currency)
		}
		if !paid.PeriodStart.Equal(payment.PeriodStart) || !paid.PeriodEnd.Equal(payment.PeriodEnd) {
			t.Fatalf("period = [%s, %s), want [%s, %s)", paid.PeriodStart, paid.PeriodEnd, payment.PeriodStart, payment.PeriodEnd)
		}
		if paid.PaidAt.IsZero() {
			t.Fatal("the payment names no instant it was paid at")
		}
		if paid.Test {
			t.Fatal("a live-mode payment is reported as a test")
		}
	})

	t.Run("a test-mode subscription invoice is reported as a test", func(t *testing.T) {
		test := payment
		test.InvoiceID += "_test"
		test.PaymentID += "_test"
		test.Test = true
		payload, headers := fixture.SubscriptionPaid(t, credentials, test)
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if paid, ok := event.(paymentprovider.SubscriptionPaid); !ok || !paid.Test {
			t.Fatalf("event = %+v, want a SubscriptionPaid reported as a test", event)
		}
	})

	t.Run("a refund of a subscription payment names the payment the invoice was paid through", func(t *testing.T) {
		payload, headers := fixture.Refunded(t, credentials, Refund{PaymentID: payment.PaymentID, Currency: currency, AmountRefunded: 300})
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if refunded, ok := event.(paymentprovider.Refunded); !ok || refunded.PaymentID != payment.PaymentID || refunded.AmountRefunded != 300 {
			t.Fatalf("event = %+v, want a refund of 300 on %q", event, payment.PaymentID)
		}
	})
}

// Harness is the purchase flow a provider's notifications are delivered to.
type Harness interface {
	// NewTenant answers a new tenant that sells in currency and takes payments
	// through provider with credentials, with one reader and one episode
	// priced at 500 in the currency's minor unit.
	NewTenant(t *testing.T, provider paymentprovider.Provider, credentials paymentprovider.Credentials, currency string) Tenant
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
	// TestPurchases counts the tenant's purchases recorded as test ones.
	TestPurchases(t *testing.T) int
	// OpensEpisode reports whether the reader may open the episode.
	OpensEpisode(t *testing.T) bool
	// SalesGross answers the gross sales of the current month's royalty
	// statement.
	SalesGross(t *testing.T) int64
	// RefundedAmount answers the refunded amount recorded on the tenant's only
	// purchase, zero when none is.
	RefundedAmount(t *testing.T) int32
	// HeldRefunds counts the refunds still waiting for their purchase.
	HeldRefunds(t *testing.T) int
	// RevokeAsStaff revokes the tenant's only purchase as staff do when they
	// refund it, before the provider has reported the refund.
	RevokeAsStaff(t *testing.T)
}

// Run checks the purchase flow against the fixture's notifications, for a
// tenant in every currency [Currencies] answers for the provider.
func Run(t *testing.T, harness Harness, fixture Fixture) {
	for _, currency := range Currencies(fixture.Provider().Declaration()) {
		t.Run(currency, func(t *testing.T) {
			run(t, harness, fixture, currency)
		})
	}
}

func run(t *testing.T, harness Harness, fixture Fixture, currency string) {
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	newTenant := func(t *testing.T, credentials paymentprovider.Credentials) Tenant {
		return harness.NewTenant(t, provider, credentials, currency)
	}
	// A provider's ids are unique across tenants, so each currency's run names
	// checkouts and payments of its own.
	id := func(name string) string {
		return name + "_" + strings.ToLower(currency)
	}

	t.Run("a completed checkout creates one purchase however often it is delivered", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		payload, headers := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: id("checkout_redelivered"),
			PaymentID:  id("payment_redelivered"),
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

	t.Run("a live-mode checkout opens the episode and is a sale", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		payload, headers := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: id("checkout_live"),
			PaymentID:  id("payment_live"),
			Purchase:   tenant.Purchase(),
		})
		if err := tenant.Deliver(t, payload, headers); err != nil {
			t.Fatalf("checkout: %v", err)
		}
		if !tenant.OpensEpisode(t) {
			t.Fatal("the purchase does not open the episode")
		}
		if got := tenant.TestPurchases(t); got != 0 {
			t.Fatalf("test purchases = %d, want 0", got)
		}
		if got, want := tenant.SalesGross(t), int64(tenant.Purchase().Price); got != want {
			t.Fatalf("sales gross = %d, want %d", got, want)
		}
	})

	t.Run("a test-mode checkout opens the episode and is no sale", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		payload, headers := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: id("checkout_test_mode"),
			PaymentID:  id("payment_test_mode"),
			Purchase:   tenant.Purchase(),
			Test:       true,
		})
		if err := tenant.Deliver(t, payload, headers); err != nil {
			t.Fatalf("checkout: %v", err)
		}
		if !tenant.OpensEpisode(t) {
			t.Fatal("a test-mode purchase does not open the episode")
		}
		if got := tenant.TestPurchases(t); got != 1 {
			t.Fatalf("test purchases = %d, want 1", got)
		}
		if got := tenant.SalesGross(t); got != 0 {
			t.Fatalf("sales gross = %d, want 0 for a test-mode purchase", got)
		}
	})

	t.Run("a refund before its purchase is held and applied later", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		refund, refundHeaders := fixture.Refunded(t, credentials, Refund{PaymentID: id("payment_early"), Currency: currency, AmountRefunded: 500})
		if err := tenant.Deliver(t, refund, refundHeaders); err != nil {
			t.Fatalf("refund: %v", err)
		}
		if got := tenant.HeldRefunds(t); got != 1 {
			t.Fatalf("held refunds = %d, want 1", got)
		}
		checkout, checkoutHeaders := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: id("checkout_early"),
			PaymentID:  id("payment_early"),
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

	t.Run("partial refunds close the purchase once they reach its price", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		checkout, checkoutHeaders := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: id("checkout_partial"),
			PaymentID:  id("payment_partial"),
			Purchase:   tenant.Purchase(),
		})
		if err := tenant.Deliver(t, checkout, checkoutHeaders); err != nil {
			t.Fatalf("checkout: %v", err)
		}
		for _, total := range []int64{200, 500} {
			refund, refundHeaders := fixture.Refunded(t, credentials, Refund{PaymentID: id("payment_partial"), Currency: currency, AmountRefunded: total})
			if err := tenant.Deliver(t, refund, refundHeaders); err != nil {
				t.Fatalf("refund to %d: %v", total, err)
			}
			if got := tenant.RefundedAmount(t); int64(got) != total {
				t.Fatalf("refunded amount = %d, want %d", got, total)
			}
		}
	})

	t.Run("a refund that fails before its purchase corrects the held refund", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		paymentID := id("payment_held_refund_failed")
		for _, total := range []int64{200, 500} {
			refund, refundHeaders := fixture.Refunded(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: total})
			if err := tenant.Deliver(t, refund, refundHeaders); err != nil {
				t.Fatalf("refund to %d: %v", total, err)
			}
		}
		failed, failedHeaders := fixture.RefundFailed(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: 200})
		if err := tenant.Deliver(t, failed, failedHeaders); err != nil {
			t.Fatalf("failed refund: %v", err)
		}
		checkout, checkoutHeaders := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: id("checkout_held_refund_failed"),
			PaymentID:  paymentID,
			Purchase:   tenant.Purchase(),
		})
		if err := tenant.Deliver(t, checkout, checkoutHeaders); err != nil {
			t.Fatalf("checkout: %v", err)
		}
		if got := tenant.RefundedAmount(t); got != 200 {
			t.Fatalf("refunded amount = %d, want the 200 that stays refunded", got)
		}
		if !tenant.OpensEpisode(t) {
			t.Fatal("a purchase refunded in part does not open the episode")
		}
	})

	t.Run("a full refund that fails reopens the purchase", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		paymentID := id("payment_refund_reopened")
		checkout, checkoutHeaders := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: id("checkout_refund_reopened"),
			PaymentID:  paymentID,
			Purchase:   tenant.Purchase(),
		})
		if err := tenant.Deliver(t, checkout, checkoutHeaders); err != nil {
			t.Fatalf("checkout: %v", err)
		}
		refund, refundHeaders := fixture.Refunded(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: 500})
		if err := tenant.Deliver(t, refund, refundHeaders); err != nil {
			t.Fatalf("refund: %v", err)
		}
		if tenant.OpensEpisode(t) {
			t.Fatal("a refunded purchase still opens the episode")
		}
		failed, failedHeaders := fixture.RefundFailed(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: 0})
		if err := tenant.Deliver(t, failed, failedHeaders); err != nil {
			t.Fatalf("failed refund: %v", err)
		}
		if !tenant.OpensEpisode(t) {
			t.Fatal("a purchase whose refund failed does not open the episode")
		}
		if got := tenant.RefundedAmount(t); got != 0 {
			t.Fatalf("refunded amount = %d, want 0", got)
		}
		if got, want := tenant.SalesGross(t), int64(tenant.Purchase().Price); got != want {
			t.Fatalf("sales gross = %d, want %d once the refund failed", got, want)
		}
	})

	t.Run("a staff refund that fails reopens the purchase", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		paymentID := id("payment_staff_refund_failed")
		checkout, checkoutHeaders := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: id("checkout_staff_refund_failed"),
			PaymentID:  paymentID,
			Purchase:   tenant.Purchase(),
		})
		if err := tenant.Deliver(t, checkout, checkoutHeaders); err != nil {
			t.Fatalf("checkout: %v", err)
		}
		fixture.Refunded(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: 500})
		tenant.RevokeAsStaff(t)
		failed, failedHeaders := fixture.RefundFailed(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: 0})
		if err := tenant.Deliver(t, failed, failedHeaders); err != nil {
			t.Fatalf("failed refund: %v", err)
		}
		if !tenant.OpensEpisode(t) {
			t.Fatal("a purchase whose staff refund failed does not open the episode")
		}
	})

	t.Run("a notification with a bad signature is refused", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		payload, headers := fixture.CheckoutCompleted(t, fixture.OtherCredentials(), Checkout{
			CheckoutID: id("checkout_forged"),
			PaymentID:  id("payment_forged"),
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
		tenant := newTenant(t, credentials)
		other := newTenant(t, fixture.OtherCredentials())
		payload, headers := fixture.CheckoutCompleted(t, credentials, Checkout{
			CheckoutID: id("checkout_crossed"),
			PaymentID:  id("payment_crossed"),
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
