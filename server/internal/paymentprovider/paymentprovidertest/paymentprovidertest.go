// Package paymentprovidertest is the contract every payment provider passes.
// A provider supplies a [Fixture] of its notifications and of its API;
// [RunParse] checks the provider reads the notifications and refunds through
// the API, and [Run] checks the purchase flow does the right thing with the
// notifications against a real database. A provider whose test mode follows
// its credentials supplies a [TestCredentialsFixture], and both take each of
// its test-mode payments under the fixture's test credentials. A provider
// whose checkouts run in the reader's browser supplies a
// [BrowserCheckoutFixture], and both complete each of its checkouts with the
// payment its script authorized, as the storefront page and the provider's
// notification do.
package paymentprovidertest

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
)

// Checkout is a completed checkout a fixture signs a notification for.
type Checkout struct {
	CheckoutID string
	// PaymentID is the id the provider reports for the checkout's payment,
	// which the contract makes CheckoutID for a provider that declares
	// [paymentprovider.Declaration.PaymentsByCheckout].
	PaymentID string
	Purchase  paymentprovider.Purchase
	// Test makes it a checkout paid in the provider's test mode, and its
	// absence one paid in live mode. A [TestCredentialsFixture] is handed it
	// with its test credentials, and with no others.
	Test bool
}

// Refund is a refund a fixture signs a notification for.
type Refund struct {
	// PaymentID is the payment's id as the provider reports it, the
	// [Checkout.PaymentID] of its checkout.
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
	// Test makes it a payment made in the provider's test mode, handed to a
	// [TestCredentialsFixture] with its test credentials.
	Test bool
	// Started makes it the invoice the subscription was created with, and
	// otherwise one that renewed it.
	Started bool
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
	// ForgetIdempotencyKeys makes the provider's API forget the refund every
	// idempotency key under the credentials created, as a provider forgets a
	// key in time.
	ForgetIdempotencyKeys(t testing.TB, credentials paymentprovider.Credentials)
	// Unrelated answers a notification the purchase flow has no use for.
	Unrelated(t testing.TB, credentials paymentprovider.Credentials) ([]byte, http.Header)
}

// FailingRefundFixture is the fixture of a provider whose refunds can fail:
// answered as failed when they are asked for, or failing after the provider
// accepted them. A provider whose API makes a refund or refuses it when it is
// asked, and never fails one it made, supplies a [Fixture] without these, and
// neither suite checks what a failed refund does.
type FailingRefundFixture interface {
	Fixture
	// FailNextRefund makes the next refund the provider's API creates on the
	// payment one it answers as failed.
	FailNextRefund(t testing.TB, credentials paymentprovider.Credentials, paymentID string)
	// RefundFailed answers the notification that a refund on the payment
	// failed after it was accepted, and makes the provider's API report
	// refund.AmountRefunded as what stays refunded on it.
	RefundFailed(t testing.TB, credentials paymentprovider.Credentials, refund Refund) ([]byte, http.Header)
}

// TestCredentialsFixture is the fixture of a provider whose test mode follows
// its credentials, a [paymentprovider.TestModeByCredentials], which takes its
// test-mode payments under credentials of their own.
type TestCredentialsFixture interface {
	Fixture
	// TestCredentials answers a tenant's credentials for the provider's test
	// mode, under which the provider reads every payment as a test. The
	// suite hands the fixture every [Checkout] with Test set under these, and
	// every one without it under other credentials.
	TestCredentials() paymentprovider.Credentials
}

// ExpiringCheckoutFixture is the fixture of a provider that declares
// [paymentprovider.Declaration.StoredCheckouts] and whose checkouts may run
// out sooner than its [paymentprovider.Declaration.CheckoutLifetime], on a
// clock it sets, with no notification of it, so that it answers
// [paymentprovider.ErrCheckoutExpired] when it is handed one that has.
type ExpiringCheckoutFixture interface {
	Fixture
	// CheckoutRanOut makes the provider's API hold checkout, which the suite
	// started through the provider, as one whose time to be paid has run out,
	// with no notification sent for it.
	CheckoutRanOut(t testing.TB, credentials paymentprovider.Credentials, checkout Checkout)
}

// BrowserCheckoutFixture is the fixture of a
// [paymentprovider.BrowserCheckout], whose payments only its script makes.
// Its CheckoutCompleted makes the payment one the script authorized for the
// checkout and the merchant has not captured, and answers the provider's
// notification of the authorization; its PaymentTaken makes the payment one
// already captured.
type BrowserCheckoutFixture interface {
	Fixture
	// Captures counts the captures the provider's API has taken of the
	// payment paymentID.
	Captures(t testing.TB, credentials paymentprovider.Credentials, paymentID string) int
}

// testCredentials answers the credentials the suite takes the fixture's
// test-mode payments under: its [TestCredentialsFixture.TestCredentials], or
// else the credentials it takes every other payment under.
func testCredentials(fixture Fixture) paymentprovider.Credentials {
	if test, ok := fixture.(TestCredentialsFixture); ok {
		return test.TestCredentials()
	}
	return fixture.Credentials()
}

// names answers the ids the contract gives the checkout it calls name and the
// payment of that checkout: one of each, or the checkout's for both for a
// provider that declares [paymentprovider.Declaration.PaymentsByCheckout].
func names(declaration paymentprovider.Declaration, name string) (checkoutID, paymentID string) {
	checkoutID = "checkout_" + name
	if declaration.PaymentsByCheckout {
		return checkoutID, checkoutID
	}
	return checkoutID, "payment_" + name
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
	t.Run("the declaration requires nothing the fixture's credentials lack", func(t *testing.T) {
		declaration := fixture.Provider().Declaration()
		if missing := declaration.Missing(fixture.Credentials()); len(missing) > 0 {
			t.Fatalf("fixture credentials miss required fields %v", missing)
		}
	})
	t.Run("the provider's test mode follows its credentials exactly when the fixture names credentials for it", func(t *testing.T) {
		modes, byCredentials := fixture.Provider().(paymentprovider.TestModeByCredentials)
		test, named := fixture.(TestCredentialsFixture)
		switch {
		case byCredentials && !named:
			t.Fatal("the provider's test mode follows its credentials, and the fixture names none for it")
		case named && !byCredentials:
			t.Fatal("the fixture names credentials for the provider's test mode, and its test mode does not follow them")
		case !byCredentials:
			return
		}
		if missing := fixture.Provider().Declaration().Missing(test.TestCredentials()); len(missing) > 0 {
			t.Fatalf("fixture test credentials miss required fields %v", missing)
		}
		if !modes.TestMode(test.TestCredentials()) {
			t.Fatal("the fixture's test credentials are not the provider's test mode's")
		}
		if modes.TestMode(fixture.Credentials()) || modes.TestMode(fixture.OtherCredentials()) {
			t.Fatal("the fixture's live credentials are the provider's test mode's")
		}
	})
	t.Run("the provider's checkouts run in the browser exactly when the fixture is of that shape", func(t *testing.T) {
		_, browser := fixture.Provider().(paymentprovider.BrowserCheckout)
		_, shaped := fixture.(BrowserCheckoutFixture)
		if browser != shaped {
			t.Fatalf("the provider's checkouts run in the browser: %v; the fixture counts captures: %v", browser, shaped)
		}
	})
	for _, currency := range Currencies(fixture.Provider().Declaration()) {
		t.Run(currency, func(t *testing.T) {
			runParse(t, fixture, currency)
			runListTransactions(t, fixture, currency)
			if browser, ok := fixture.(BrowserCheckoutFixture); ok {
				runParseBrowserCheckout(t, browser, currency)
			}
		})
	}
}

// storedCheckout answers checkout as the server reads it back from what it
// wrote down when it started it.
func storedCheckout(checkout Checkout) paymentprovider.StoredCheckout {
	return paymentprovider.StoredCheckout{
		CheckoutID:   checkout.CheckoutID,
		Purchase:     checkout.Purchase,
		LineItemName: checkoutRequest(checkout).LineItemName,
	}
}

// completedEvent reads the notification of the paid checkout checkout as the
// purchase flow does: as the [paymentprovider.PurchaseCompleted] it is, or,
// for a [paymentprovider.BrowserCheckout], as the authorization of the
// checkout's payment, which it completes.
func completedEvent(t *testing.T, provider paymentprovider.Provider, credentials paymentprovider.Credentials, checkout Checkout, payload []byte, headers http.Header) paymentprovider.PurchaseCompleted {
	t.Helper()
	event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
	if err != nil {
		t.Fatalf("ParseNotification: %v", err)
	}
	browser, ok := provider.(paymentprovider.BrowserCheckout)
	if !ok {
		completed, ok := event.(paymentprovider.PurchaseCompleted)
		if !ok {
			t.Fatalf("event = %T, want PurchaseCompleted", event)
		}
		return completed
	}
	authorized, ok := event.(paymentprovider.CheckoutAuthorized)
	if !ok {
		t.Fatalf("event = %T, want CheckoutAuthorized", event)
	}
	if authorized.CheckoutID != checkout.CheckoutID || authorized.PaymentID != checkout.PaymentID {
		t.Fatalf("authorized ids = (%q, %q), want (%q, %q)", authorized.CheckoutID, authorized.PaymentID, checkout.CheckoutID, checkout.PaymentID)
	}
	completed, err := browser.CompleteCheckout(t.Context(), credentials, storedCheckout(checkout), authorized.PaymentID)
	if err != nil {
		t.Fatalf("CompleteCheckout: %v", err)
	}
	return completed
}

// runParseBrowserCheckout checks that a provider whose checkouts run in the
// reader's browser starts its checkout on the storefront page, hands the
// page's script what it needs and no secret, and completes a checkout with
// the payment its script authorized only when the payment is the checkout's,
// capturing it once however often it is completed.
func runParseBrowserCheckout(t *testing.T, fixture BrowserCheckoutFixture, currency string) {
	provider := fixture.Provider()
	browser := provider.(paymentprovider.BrowserCheckout)
	declaration := provider.Declaration()
	credentials := fixture.Credentials()
	checkoutOf := func(name string) Checkout {
		checkout := Checkout{Purchase: paymentprovider.Purchase{
			TenantID:  uuid.New(),
			ReaderID:  uuid.New(),
			EpisodeID: uuid.New(),
			Kind:      paymentprovider.KindPurchase,
			Price:     500,
			Currency:  currency,
		}}
		checkout.CheckoutID, checkout.PaymentID = names(declaration, name+"_"+strings.ToLower(currency))
		return checkout
	}

	t.Run("a checkout is started on the storefront page the server names", func(t *testing.T) {
		req := checkoutRequest(checkoutOf("browser_started"))
		req.PageURL = "https://contract.example.com" + paymentprovider.BrowserCheckoutPath(declaration.ID, req.CheckoutID)
		pageURL, err := provider.StartCheckout(t.Context(), credentials, req)
		if err != nil {
			t.Fatalf("StartCheckout: %v", err)
		}
		if pageURL != req.PageURL {
			t.Fatalf("StartCheckout = %q, want the page %q", pageURL, req.PageURL)
		}
	})

	t.Run("the script is handed the public credentials and the checkout, and no secret", func(t *testing.T) {
		checkout := checkoutOf("browser_script")
		script, err := browser.CheckoutScript(credentials, storedCheckout(checkout), paymentprovider.Buyer{
			ID:           "CONTRACTREAD",
			RegisteredAt: time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC),
			Payments:     2,
			AmountPaid:   1200,
			LastPaidAt:   time.Date(2026, time.February, 3, 4, 5, 6, 0, time.UTC),
			LastAmount:   700,
		})
		if err != nil {
			t.Fatalf("CheckoutScript: %v", err)
		}
		public := declaration.PublicCredentials(credentials)
		if len(public) == 0 {
			t.Fatal("the provider declares no public field for its script, or the fixture's credentials fill none")
		}
		if len(script.Credentials) != len(public) {
			t.Fatalf("script credentials = %v, want %v", script.Credentials, public)
		}
		for name, value := range public {
			if script.Credentials[name] != value {
				t.Fatalf("script credentials = %v, want %v", script.Credentials, public)
			}
		}
		var payload map[string]any
		if err := json.Unmarshal(script.Payload, &payload); err != nil {
			t.Fatalf("the script's payload %s is not a JSON object: %v", script.Payload, err)
		}
		if !strings.Contains(string(script.Payload), checkout.CheckoutID) {
			t.Fatalf("the script's payload %s does not name the checkout %s", script.Payload, checkout.CheckoutID)
		}
		for _, field := range declaration.Fields {
			if value := credentials[field.Name]; field.Secret && value != "" && strings.Contains(string(script.Payload), value) {
				t.Fatalf("the script's payload carries the secret %s", field.Name)
			}
		}
	})

	t.Run("a payment the script authorized is captured once however often it is completed", func(t *testing.T) {
		checkout := checkoutOf("browser_captured")
		payload, headers := fixture.CheckoutCompleted(t, credentials, checkout)
		first := completedEvent(t, provider, credentials, checkout, payload, headers)
		// The page and the notification both complete it, in either order.
		again := completedEvent(t, provider, credentials, checkout, payload, headers)
		if first != again {
			t.Fatalf("completed again as %+v, want %+v", again, first)
		}
		if first.CheckoutID != checkout.CheckoutID || first.PaymentID != checkout.PaymentID {
			t.Fatalf("ids = (%q, %q), want (%q, %q)", first.CheckoutID, first.PaymentID, checkout.CheckoutID, checkout.PaymentID)
		}
		if first.AmountPaid != checkout.Purchase.Price || first.Purchase != (paymentprovider.Purchase{Currency: currency}) {
			t.Fatalf("completed as %+v, want %d paid in %s", first, checkout.Purchase.Price, currency)
		}
		if got := fixture.Captures(t, credentials, checkout.PaymentID); got != 1 {
			t.Fatalf("captures = %d, want 1", got)
		}
	})

	t.Run("a payment the script only authorized is not read as captured, and nothing captures it", func(t *testing.T) {
		checkout := checkoutOf("browser_uncaptured")
		fixture.CheckoutCompleted(t, credentials, checkout)
		if _, err := browser.CapturedCheckout(t.Context(), credentials, storedCheckout(checkout), checkout.PaymentID); !errors.Is(err, paymentprovider.ErrPaymentNotCaptured) {
			t.Fatalf("CapturedCheckout error = %v, want ErrPaymentNotCaptured", err)
		}
		if got := fixture.Captures(t, credentials, checkout.PaymentID); got != 0 {
			t.Fatalf("captures = %d, want 0", got)
		}
	})

	t.Run("a captured payment is read as the completion it was captured as, and is not captured again", func(t *testing.T) {
		checkout := checkoutOf("browser_read_captured")
		payload, headers := fixture.CheckoutCompleted(t, credentials, checkout)
		completed := completedEvent(t, provider, credentials, checkout, payload, headers)
		read, err := browser.CapturedCheckout(t.Context(), credentials, storedCheckout(checkout), checkout.PaymentID)
		if err != nil {
			t.Fatalf("CapturedCheckout: %v", err)
		}
		if read != completed {
			t.Fatalf("read as %+v, want %+v", read, completed)
		}
		if got := fixture.Captures(t, credentials, checkout.PaymentID); got != 1 {
			t.Fatalf("captures = %d, want 1", got)
		}
	})

	t.Run("a payment that is not the checkout's completes nothing and captures nothing", func(t *testing.T) {
		for name, differ := range map[string]func(*paymentprovider.StoredCheckout){
			"another amount":   func(c *paymentprovider.StoredCheckout) { c.Purchase.Price = 400 },
			"another currency": func(c *paymentprovider.StoredCheckout) { c.Purchase.Currency = "XTS" },
			"another checkout": func(c *paymentprovider.StoredCheckout) { c.CheckoutID += "_other" },
		} {
			t.Run(name, func(t *testing.T) {
				checkout := checkoutOf("browser_mismatch_" + strings.ReplaceAll(name, " ", "_"))
				fixture.CheckoutCompleted(t, credentials, checkout)
				stored := storedCheckout(checkout)
				differ(&stored)
				if _, err := browser.CapturedCheckout(t.Context(), credentials, stored, checkout.PaymentID); !errors.Is(err, paymentprovider.ErrPaymentMismatch) {
					t.Fatalf("CapturedCheckout error = %v, want ErrPaymentMismatch", err)
				}
				if _, err := browser.CompleteCheckout(t.Context(), credentials, stored, checkout.PaymentID); !errors.Is(err, paymentprovider.ErrPaymentMismatch) {
					t.Fatalf("CompleteCheckout error = %v, want ErrPaymentMismatch", err)
				}
				if got := fixture.Captures(t, credentials, checkout.PaymentID); got != 0 {
					t.Fatalf("captures = %d, want 0", got)
				}
			})
		}
	})

	t.Run("a payment the account does not hold completes nothing", func(t *testing.T) {
		checkout := checkoutOf("browser_other_account")
		fixture.CheckoutCompleted(t, fixture.OtherCredentials(), checkout)
		if _, err := browser.CapturedCheckout(t.Context(), credentials, storedCheckout(checkout), checkout.PaymentID); !errors.Is(err, paymentprovider.ErrPaymentMismatch) {
			t.Fatalf("CapturedCheckout error = %v, want ErrPaymentMismatch", err)
		}
		if _, err := browser.CompleteCheckout(t.Context(), credentials, storedCheckout(checkout), checkout.PaymentID); !errors.Is(err, paymentprovider.ErrPaymentMismatch) {
			t.Fatalf("CompleteCheckout error = %v, want ErrPaymentMismatch", err)
		}
		if got := fixture.Captures(t, fixture.OtherCredentials(), checkout.PaymentID); got != 0 {
			t.Fatalf("captures = %d, want 0", got)
		}
	})
}

// runListTransactions checks that the provider lists the payments of a period
// from its API, oldest first, with the refunds made on them, and none of
// another account's. The test-mode payment is taken under the fixture's test
// credentials, and for a provider whose test mode follows them is listed
// under those alone.
func runListTransactions(t *testing.T, fixture Fixture, currency string) {
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	_, byCredentials := fixture.(TestCredentialsFixture)
	// Real instants around now, since a provider's refunds are dated when
	// they are made.
	to := time.Now().Add(time.Hour).Truncate(time.Second)
	from := to.Add(-3 * time.Hour)
	// A provider that keeps no list of its payments is handed the checkouts
	// the server started through it, each of which it reads the payment of,
	// with the payment the server kept as its completion for a provider whose
	// checkouts run in the browser.
	var started []paymentprovider.StartedCheckout
	_, browser := provider.(paymentprovider.BrowserCheckout)
	taken := func(name string, price int32, test bool, at time.Time) Checkout {
		credentials := credentials
		if test {
			credentials = testCredentials(fixture)
		}
		checkout := Checkout{
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
		checkout.CheckoutID, checkout.PaymentID = names(provider.Declaration(), name)
		fixture.PaymentTaken(t, credentials, checkout, at)
		if provider.Declaration().StoredCheckouts {
			listed := paymentprovider.StartedCheckout{CheckoutID: checkout.CheckoutID}
			if browser {
				listed.PaymentID = checkout.PaymentID
			}
			started = append(started, listed)
		}
		return checkout
	}
	live := taken("list_live_"+currency, 500, false, from.Add(time.Hour))
	test := taken("list_test_"+currency, 300, true, from.Add(2*time.Hour))
	taken("list_before_"+currency, 700, false, from.Add(-time.Hour))
	taken("list_after_"+currency, 900, false, to.Add(time.Hour))
	_, _ = fixture.Refunded(t, credentials, Refund{PaymentID: live.PaymentID, Currency: currency, AmountRefunded: 200})

	liveListed := paymentprovider.Transaction{PaymentID: live.PaymentID, Amount: 500, AmountRefunded: 200, Currency: currency, Test: false, Created: from.Add(time.Hour).UTC()}
	testListed := paymentprovider.Transaction{PaymentID: test.PaymentID, Amount: 300, Currency: currency, Test: true, Created: from.Add(2 * time.Hour).UTC()}
	list := func(t *testing.T, credentials paymentprovider.Credentials, want ...paymentprovider.Transaction) {
		t.Helper()
		listed, err := provider.ListTransactions(t.Context(), credentials, from, to, started)
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
		if len(transactions) != len(want) {
			t.Fatalf("transactions = %+v, want %+v", transactions, want)
		}
		for i := range want {
			if transactions[i] != want[i] {
				t.Fatalf("transaction %d = %+v, want %+v", i, transactions[i], want[i])
			}
		}
	}

	if byCredentials {
		t.Run("the live payments of the period are listed oldest first with their refunds", func(t *testing.T) {
			list(t, credentials, liveListed)
		})
		t.Run("the test-mode payments of the period are listed under the test credentials", func(t *testing.T) {
			list(t, testCredentials(fixture), testListed)
		})
	} else {
		t.Run("the payments of the period are listed oldest first with their refunds", func(t *testing.T) {
			list(t, credentials, liveListed, testListed)
		})
	}

	t.Run("another account's payments are not listed", func(t *testing.T) {
		transactions, err := provider.ListTransactions(t.Context(), fixture.OtherCredentials(), from, to, started)
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
	checkout.CheckoutID, checkout.PaymentID = names(provider.Declaration(), "contract")
	// paying answers the checkout as one of its own called name, paid by a
	// payment of its own.
	paying := func(name string) Checkout {
		paid := checkout
		paid.CheckoutID, paid.PaymentID = names(provider.Declaration(), name)
		return paid
	}
	// A provider that declares stored checkouts carries nothing of a purchase
	// but the currency its payment names, and the server fills in the rest
	// from what it wrote down when the checkout started.
	stored := provider.Declaration().StoredCheckouts
	carried := func(purchase paymentprovider.Purchase) paymentprovider.Purchase {
		if stored {
			return paymentprovider.Purchase{Currency: purchase.Currency}
		}
		return purchase
	}
	// taken makes the payment of paid one the purchase flow has taken, as the
	// payment of every purchase a refund is asked for is: for a provider
	// whose checkouts run in the browser, completed, which captures it.
	taken := func(t *testing.T, credentials paymentprovider.Credentials, paid Checkout) {
		t.Helper()
		payload, headers := fixture.CheckoutCompleted(t, credentials, paid)
		if _, browser := provider.(paymentprovider.BrowserCheckout); browser {
			completedEvent(t, provider, credentials, paid, payload, headers)
		}
	}
	failing, failable := fixture.(FailingRefundFixture)

	t.Run("a completed checkout names its purchase", func(t *testing.T) {
		payload, headers := fixture.CheckoutCompleted(t, credentials, checkout)
		completed := completedEvent(t, provider, credentials, checkout, payload, headers)
		if completed.CheckoutID != checkout.CheckoutID || completed.PaymentID != checkout.PaymentID {
			t.Fatalf("ids = (%q, %q), want (%q, %q)", completed.CheckoutID, completed.PaymentID, checkout.CheckoutID, checkout.PaymentID)
		}
		if want := carried(checkout.Purchase); completed.Purchase != want {
			t.Fatalf("purchase = %+v, want %+v", completed.Purchase, want)
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

	// What a checkout sells is read from what the provider carried, which a
	// provider that declares stored checkouts carries none of.
	if !stored {
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

		t.Run("a checkout the tenant's promotion code discounted names the code and the price before it", func(t *testing.T) {
			discounted := checkout
			discounted.CheckoutID = "checkout_contract_promotion_code"
			discounted.Purchase.Price = 400
			discounted.Purchase.ListPrice = 500
			discounted.Purchase.PromotionCodeID = uuid.New()
			payload, headers := fixture.CheckoutCompleted(t, credentials, discounted)
			event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			completed, ok := event.(paymentprovider.PurchaseCompleted)
			if !ok {
				t.Fatalf("event = %T, want PurchaseCompleted", event)
			}
			if completed.Purchase != discounted.Purchase {
				t.Fatalf("purchase = %+v, want %+v", completed.Purchase, discounted.Purchase)
			}
			// The checkout charged the discounted price, and offered no code of
			// the provider's beside the tenant's.
			if completed.AmountPaid != 400 || completed.PromotionCodeID != "" {
				t.Fatalf("paid %d with provider code %q, want 400 with none", completed.AmountPaid, completed.PromotionCodeID)
			}
		})

		t.Run("a promotion code the checkout cannot carry is malformed", func(t *testing.T) {
			for name, malformed := range map[string]func(*Checkout){
				"a list price below the price": func(c *Checkout) { c.Purchase.ListPrice = 300 },
				"a code without a list price":  func(c *Checkout) { c.Purchase.ListPrice = 0 },
				"a list price without a code":  func(c *Checkout) { c.Purchase.PromotionCodeID = uuid.Nil },
				"a code on a tip": func(c *Checkout) {
					c.Purchase.Kind = paymentprovider.KindTip
					c.Purchase.ReadingPeriodHours = 0
				},
				"a code on a series bundle": func(c *Checkout) {
					c.Purchase.EpisodeID = uuid.Nil
					c.Purchase.ReadingPeriodHours = 0
					c.Purchase.SeriesBundleID = uuid.New()
				},
			} {
				t.Run(name, func(t *testing.T) {
					bad := checkout
					bad.CheckoutID = "checkout_contract_bad_promotion_code"
					bad.Purchase.Price = 400
					bad.Purchase.ListPrice = 500
					bad.Purchase.PromotionCodeID = uuid.New()
					malformed(&bad)
					payload, headers := fixture.CheckoutCompleted(t, credentials, bad)
					if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
						t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
					}
				})
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

		t.Run("a tip checkout names its kind and episode", func(t *testing.T) {
			tip := checkout
			tip.CheckoutID = "checkout_contract_tip"
			tip.Purchase.Kind = paymentprovider.KindTip
			tip.Purchase.Price = 300
			tip.Purchase.ReadingPeriodHours = 0
			payload, headers := fixture.CheckoutCompleted(t, credentials, tip)
			event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			completed, ok := event.(paymentprovider.PurchaseCompleted)
			if !ok {
				t.Fatalf("event = %T, want PurchaseCompleted", event)
			}
			if completed.Purchase != tip.Purchase {
				t.Fatalf("purchase = %+v, want %+v", completed.Purchase, tip.Purchase)
			}
		})

		t.Run("a tip that names a period is malformed", func(t *testing.T) {
			bounded := checkout
			bounded.CheckoutID = "checkout_contract_bounded_tip"
			bounded.Purchase.Kind = paymentprovider.KindTip
			bounded.Purchase.ReadingPeriodHours = 24
			payload, headers := fixture.CheckoutCompleted(t, credentials, bounded)
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
	}

	t.Run("a test-mode checkout is reported as a test", func(t *testing.T) {
		testCheckout := checkout
		testCheckout.Test = true
		payload, headers := fixture.CheckoutCompleted(t, testCredentials(fixture), testCheckout)
		completed := completedEvent(t, provider, testCredentials(fixture), testCheckout, payload, headers)
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

	if notifier, ok := provider.(paymentprovider.UnsignedNotifier); ok && provider.Declaration().SignatureHeader == "" {
		// A payment is named by its checkout by a provider that names every
		// payment that way, and by its own id otherwise.
		paymentSubject := paymentprovider.NotificationSubject{PaymentID: checkout.PaymentID}
		if provider.Declaration().PaymentsByCheckout {
			paymentSubject = paymentprovider.NotificationSubject{CheckoutID: checkout.CheckoutID}
		}

		t.Run("an unsigned notification of a payment names its checkout or the payment before anything is read", func(t *testing.T) {
			paid := paying("subject")
			payload, _ := fixture.CheckoutCompleted(t, credentials, paid)
			// A payment made in the browser is named by the payment alone,
			// since its checkout is nothing of the provider's.
			want := paymentprovider.NotificationSubject{CheckoutID: paid.CheckoutID}
			if _, browser := provider.(paymentprovider.BrowserCheckout); browser {
				want = paymentprovider.NotificationSubject{PaymentID: paid.PaymentID}
			}
			if subject, ok := notifier.NotificationSubject(payload); !ok || subject != want {
				t.Fatalf("NotificationSubject = %+v, %v, want %+v", subject, ok, want)
			}
		})

		t.Run("an unsigned notification of a refund names the payment before anything is read", func(t *testing.T) {
			payload, _ := fixture.Refunded(t, credentials, Refund{PaymentID: checkout.PaymentID, Currency: currency, AmountRefunded: 300})
			if subject, ok := notifier.NotificationSubject(payload); !ok || subject != paymentSubject {
				t.Fatalf("NotificationSubject = %+v, %v, want %+v", subject, ok, paymentSubject)
			}
		})

		t.Run("an unsigned notification that is ignored names nothing", func(t *testing.T) {
			payload, _ := fixture.Unrelated(t, credentials)
			if subject, ok := notifier.NotificationSubject(payload); ok {
				t.Fatalf("NotificationSubject = %+v, want nothing", subject)
			}
		})
	}

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
		paid := paying("refund_" + strings.ToLower(currency))
		taken(t, credentials, paid)
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
		paid := paying("refund_rest_" + strings.ToLower(currency))
		taken(t, credentials, paid)
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
		paid := paying("refund_amount_" + strings.ToLower(currency))
		taken(t, credentials, paid)
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
		paid := paying("refund_amount_made_" + strings.ToLower(currency))
		taken(t, credentials, paid)
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
		if failable {
			failing.FailNextRefund(t, credentials, paid.PaymentID)
			if _, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key + "_failed", Amount: 100}); !errors.Is(err, paymentprovider.ErrRefundRefused) {
				t.Fatalf("Refund the provider fails: error = %v, want ErrRefundRefused", err)
			}
			made(key+"_failed", false)
		}
	})

	t.Run("a refund of an amount is found again once the provider has forgotten its key", func(t *testing.T) {
		paid := paying("refund_amount_forgotten_" + strings.ToLower(currency))
		taken(t, credentials, paid)
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

		if !failable {
			return
		}
		failed := paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key + "_failed", Amount: 100}
		failing.FailNextRefund(t, credentials, paid.PaymentID)
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

	if failable {
		t.Run("a refund the provider answers as failed is refused", func(t *testing.T) {
			paid := paying("refund_failed_" + strings.ToLower(currency))
			taken(t, credentials, paid)
			failing.FailNextRefund(t, credentials, paid.PaymentID)
			_, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: "refund_contract_failed_" + strings.ToLower(currency)})
			if !errors.Is(err, paymentprovider.ErrRefundRefused) {
				t.Fatalf("Refund error = %v, want ErrRefundRefused", err)
			}
			if got := fixture.RefundedTotal(t, credentials, paid.PaymentID); got != 0 {
				t.Fatalf("refunded total = %d, want 0", got)
			}
		})

		t.Run("a refund that fails later names its payment and what stays refunded", func(t *testing.T) {
			paid := paying("refund_failed_later_" + strings.ToLower(currency))
			taken(t, credentials, paid)
			fixture.Refunded(t, credentials, Refund{PaymentID: paid.PaymentID, Currency: currency, AmountRefunded: 200})
			fixture.Refunded(t, credentials, Refund{PaymentID: paid.PaymentID, Currency: currency, AmountRefunded: 500})
			payload, headers := failing.RefundFailed(t, credentials, Refund{PaymentID: paid.PaymentID, Currency: currency, AmountRefunded: 200})
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
			paid := paying("refund_amount_failed_later_" + strings.ToLower(currency))
			taken(t, credentials, paid)
			key := "refund_contract_amount_failed_later_" + strings.ToLower(currency)
			if _, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: key, Amount: 300}); err != nil {
				t.Fatalf("Refund: %v", err)
			}
			payload, headers := failing.RefundFailed(t, credentials, Refund{PaymentID: paid.PaymentID, Currency: currency, AmountRefunded: 0, Key: key})
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
	}

	t.Run("a refund of a payment the account does not hold is refused", func(t *testing.T) {
		paid := paying("refund_other_" + strings.ToLower(currency))
		taken(t, fixture.OtherCredentials(), paid)
		_, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: "refund_contract_other_" + strings.ToLower(currency)})
		if !errors.Is(err, paymentprovider.ErrRefundRefused) {
			t.Fatalf("Refund error = %v, want ErrRefundRefused", err)
		}
		if got := fixture.RefundedTotal(t, fixture.OtherCredentials(), paid.PaymentID); got != 0 {
			t.Fatalf("refunded total under the other account = %d, want 0", got)
		}
	})

	t.Run("a notification signed with other credentials is refused", func(t *testing.T) {
		// A checkout the tenant's account holds no payment of, which is what
		// tells another account's notification apart for a provider that
		// signs nothing.
		forged := paying("contract_other_account_" + strings.ToLower(currency))
		payload, headers := fixture.CheckoutCompleted(t, fixture.OtherCredentials(), forged)
		if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrInvalidSignature) {
			t.Fatalf("ParseNotification error = %v, want ErrInvalidSignature", err)
		}
	})

	// A provider that signs nothing reads everything from its API, which the
	// notification read with other credentials has already shown it does.
	if provider.Declaration().SignatureHeader != "" {
		t.Run("an unsigned notification is refused", func(t *testing.T) {
			payload, _ := fixture.CheckoutCompleted(t, credentials, checkout)
			if _, err := provider.ParseNotification(t.Context(), payload, http.Header{}, credentials); !errors.Is(err, paymentprovider.ErrInvalidSignature) {
				t.Fatalf("ParseNotification error = %v, want ErrInvalidSignature", err)
			}
		})
	}

	if follower, ok := provider.(paymentprovider.RefundFollower); ok {
		t.Run("a refund the provider was asked for is read back through its own notification", func(t *testing.T) {
			paid := paying("refund_followed_" + strings.ToLower(currency))
			taken(t, credentials, paid)
			read := func(t *testing.T) paymentprovider.Event {
				t.Helper()
				event, err := provider.ParseNotification(t.Context(), follower.RefundNotification(paid.PaymentID), http.Header{}, credentials)
				if err != nil {
					t.Fatalf("ParseNotification: %v", err)
				}
				return event
			}
			if event := read(t); !isIgnored(event) {
				t.Fatalf("event before any refund = %+v, want it ignored", event)
			}
			if _, err := provider.Refund(t.Context(), credentials, paymentprovider.RefundRequest{PaymentID: paid.PaymentID, IdempotencyKey: "refund_contract_followed_" + strings.ToLower(currency), Amount: 300}); err != nil {
				t.Fatalf("Refund: %v", err)
			}
			refunded, ok := read(t).(paymentprovider.Refunded)
			if !ok || refunded.PaymentID != paid.PaymentID || refunded.AmountRefunded != 300 || refunded.Currency != currency {
				t.Fatalf("event = %+v, want a refund of 300 %s on %q", refunded, currency, paid.PaymentID)
			}
		})

		t.Run("the notification of the refunds of a payment the account does not hold is refused", func(t *testing.T) {
			paid := paying("refund_followed_other_" + strings.ToLower(currency))
			taken(t, fixture.OtherCredentials(), paid)
			if _, err := provider.ParseNotification(t.Context(), follower.RefundNotification(paid.PaymentID), http.Header{}, credentials); !errors.Is(err, paymentprovider.ErrInvalidSignature) {
				t.Fatalf("ParseNotification error = %v, want ErrInvalidSignature", err)
			}
		})
	}

	if follower, ok := provider.(paymentprovider.CheckoutFollower); ok {
		t.Run("a checkout started and not paid is read back as nothing to record", func(t *testing.T) {
			open := paying("checkout_followed_open_" + strings.ToLower(currency))
			startCheckout(t, provider, credentials, open)
			event, err := provider.ParseNotification(t.Context(), follower.CheckoutNotification(open.CheckoutID), http.Header{}, credentials)
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			if !isIgnored(event) {
				t.Fatalf("event of an unpaid checkout = %+v, want it ignored", event)
			}
		})

		t.Run("a checkout paid with no notification sent is read back through its own notification", func(t *testing.T) {
			paid := paying("checkout_followed_paid_" + strings.ToLower(currency))
			startCheckout(t, provider, credentials, paid)
			fixture.PaymentTaken(t, credentials, paid, time.Now())
			event, err := provider.ParseNotification(t.Context(), follower.CheckoutNotification(paid.CheckoutID), http.Header{}, credentials)
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			completed, ok := event.(paymentprovider.PurchaseCompleted)
			if !ok {
				t.Fatalf("event = %T, want PurchaseCompleted", event)
			}
			if completed.CheckoutID != paid.CheckoutID || completed.PaymentID != paid.PaymentID {
				t.Fatalf("ids = (%q, %q), want (%q, %q)", completed.CheckoutID, completed.PaymentID, paid.CheckoutID, paid.PaymentID)
			}
			if want := carried(paid.Purchase); completed.Purchase != want {
				t.Fatalf("purchase = %+v, want %+v", completed.Purchase, want)
			}
			if completed.AmountPaid != paid.Purchase.Price || completed.Test {
				t.Fatalf("paid %d, test %v; want %d in live mode", completed.AmountPaid, completed.Test, paid.Purchase.Price)
			}
		})

		t.Run("the payment of a checkout the account does not hold is refused", func(t *testing.T) {
			other := paying("checkout_followed_other_" + strings.ToLower(currency))
			startCheckout(t, provider, fixture.OtherCredentials(), other)
			fixture.PaymentTaken(t, fixture.OtherCredentials(), other, time.Now())
			if _, err := provider.ParseNotification(t.Context(), follower.CheckoutNotification(other.CheckoutID), http.Header{}, credentials); !errors.Is(err, paymentprovider.ErrInvalidSignature) {
				t.Fatalf("ParseNotification error = %v, want ErrInvalidSignature", err)
			}
		})
	}

	if expiring, ok := fixture.(ExpiringCheckoutFixture); ok {
		t.Run("a checkout that ran out is answered as expired when it is started again", func(t *testing.T) {
			if !stored {
				t.Fatal("the fixture's checkouts run out, but its provider declares no stored checkouts")
			}
			ranOut := paying("checkout_ran_out_" + strings.ToLower(currency))
			startCheckout(t, provider, credentials, ranOut)
			// A retry within its time is the same checkout.
			startCheckout(t, provider, credentials, ranOut)
			expiring.CheckoutRanOut(t, credentials, ranOut)
			if _, err := provider.StartCheckout(t.Context(), credentials, checkoutRequest(ranOut)); !errors.Is(err, paymentprovider.ErrCheckoutExpired) {
				t.Fatalf("StartCheckout error = %v, want ErrCheckoutExpired", err)
			}
		})
	}
}

// startCheckout starts checkout through provider under credentials, as the
// server does once it has written its purchase down, under the checkout's id.
func startCheckout(t *testing.T, provider paymentprovider.Provider, credentials paymentprovider.Credentials, checkout Checkout) {
	t.Helper()
	if _, err := provider.StartCheckout(t.Context(), credentials, checkoutRequest(checkout)); err != nil {
		t.Fatalf("StartCheckout: %v", err)
	}
}

// checkoutRequest is the request the server starts checkout with.
func checkoutRequest(checkout Checkout) paymentprovider.CheckoutRequest {
	return paymentprovider.CheckoutRequest{
		Purchase:       checkout.Purchase,
		LineItemName:   "Contract episode",
		SuccessURL:     "https://contract.example.com/success",
		CancelURL:      "https://contract.example.com/cancel",
		IdempotencyKey: "contract-checkout:" + checkout.CheckoutID,
		CheckoutID:     checkout.CheckoutID,
	}
}

func isIgnored(event paymentprovider.Event) bool {
	_, ok := event.(paymentprovider.Ignored)
	return ok
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

	t.Run("the provider tells an invoice's payment from a purchase's", func(t *testing.T) {
		_, _ = fixture.SubscriptionPaid(t, credentials, payment)
		subscriptions, ok := provider.(paymentprovider.Subscriptions)
		if !ok {
			t.Fatal("a provider with a subscription fixture sells no subscriptions")
		}
		paid, err := subscriptions.PaidInvoice(t.Context(), credentials, payment.PaymentID)
		if err != nil || !paid {
			t.Fatalf("PaidInvoice(%s) = %v, %v; want the invoice's payment", payment.PaymentID, paid, err)
		}
		purchase := "payment_purchase_contract_" + strings.ToLower(currency)
		fixture.PaymentTaken(t, credentials, Checkout{PaymentID: purchase, Purchase: paymentprovider.Purchase{Price: 500, Currency: currency}}, start)
		if paid, err := subscriptions.PaidInvoice(t.Context(), credentials, purchase); err != nil || paid {
			t.Fatalf("PaidInvoice(%s) = %v, %v; want a purchase's payment told apart", purchase, paid, err)
		}
	})

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
		payload, headers := fixture.SubscriptionPaid(t, testCredentials(fixture), test)
		event, err := provider.ParseNotification(t.Context(), payload, headers, testCredentials(fixture))
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
	// RecordCheckout writes purchase down under checkoutID, as the server does
	// when it starts a checkout through a provider that declares stored
	// checkouts.
	RecordCheckout(t *testing.T, checkoutID string, purchase paymentprovider.Purchase)
	// Deliver hands a notification to the purchase flow.
	Deliver(t *testing.T, payload []byte, headers http.Header) error
	// Purchases counts the tenant's purchases.
	Purchases(t *testing.T) int
	// TestPurchases counts the tenant's purchases recorded as test ones.
	TestPurchases(t *testing.T) int
	// OpensEpisode reports whether the reader may open the episode.
	OpensEpisode(t *testing.T) bool
	// SalesGross answers the gross sales of the current month's royalty
	// statement, and SalesRefunded what the refunds take off it.
	SalesGross(t *testing.T) int64
	SalesRefunded(t *testing.T) int64
	// DiscountedPurchase makes a promotion code of the tenant's that takes 20
	// percent off the episode, and answers the reader's purchase of it as a
	// checkout started with the code would name it: at 400, with the list
	// price of 500 and the code.
	DiscountedPurchase(t *testing.T) paymentprovider.Purchase
	// Redemptions counts the tenant's promotion code redemptions.
	Redemptions(t *testing.T) int
	// ListPrice answers the list price recorded on the tenant's only purchase,
	// zero when none is.
	ListPrice(t *testing.T) int32
	// RefundedAmount answers the refunded amount recorded on the tenant's only
	// purchase, zero when none is.
	RefundedAmount(t *testing.T) int32
	// HeldRefunds counts the refunds still waiting for their purchase.
	HeldRefunds(t *testing.T) int
	// FollowCheckout reads the payment of the checkout checkoutID back once,
	// as the worker does for a provider that is a
	// [paymentprovider.CheckoutFollower], and reports whether the worker
	// would read it again.
	FollowCheckout(t *testing.T, checkoutID string) bool
	// LapseCheckout moves every start of the checkout checkoutID back past the
	// provider's [paymentprovider.Declaration.CheckoutLifetime].
	LapseCheckout(t *testing.T, checkoutID string)
	// StartCheckout starts the reader's checkout of the episode as the
	// storefront does, through the provider of a tenant that declares stored
	// checkouts, and answers the [paymentprovider.CheckoutRequest.CheckoutID]
	// the provider was last handed for it.
	StartCheckout(t *testing.T) string
	// RevokeAsStaff revokes the tenant's only purchase as staff do when they
	// refund it, before the provider has reported the refund.
	RevokeAsStaff(t *testing.T)
	// BrowserCheckout reads, as the storefront page of a checkout through a
	// [paymentprovider.BrowserCheckout] does, what the page hands the
	// provider's script for the checkout checkoutID.
	BrowserCheckout(t *testing.T, checkoutID string) (BrowserPage, error)
	// CompleteBrowserCheckout hands the server the payment paymentID the
	// provider's script answered for the checkout checkoutID, as the page
	// does.
	CompleteBrowserCheckout(t *testing.T, checkoutID, paymentID string) error
}

// BrowserPage is what the storefront page of a checkout through a
// [paymentprovider.BrowserCheckout] reads from the server.
type BrowserPage struct {
	// Script is what the page hands the provider's script.
	Script paymentprovider.Script
	// SuccessURL and CancelURL are where the page sends the reader once the
	// script has authorized the payment, or closed without one.
	SuccessURL string
	CancelURL  string
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
	checkoutNamed := func(name string) string {
		checkoutID, _ := names(provider.Declaration(), name+"_"+strings.ToLower(currency))
		return checkoutID
	}
	paymentNamed := func(name string) string {
		_, paymentID := names(provider.Declaration(), name+"_"+strings.ToLower(currency))
		return paymentID
	}
	// completed answers the notification of a paid checkout delivered to
	// tenant, having written its purchase down there first, as the server
	// does when it starts a checkout, for a provider that declares stored
	// checkouts.
	completed := func(t *testing.T, tenant Tenant, credentials paymentprovider.Credentials, checkout Checkout) ([]byte, http.Header) {
		t.Helper()
		if provider.Declaration().StoredCheckouts {
			tenant.RecordCheckout(t, checkout.CheckoutID, checkout.Purchase)
		}
		return fixture.CheckoutCompleted(t, credentials, checkout)
	}
	// started writes the checkout checkoutID down for a provider that
	// declares stored checkouts, as the server does before the reader can pay
	// it, and so before anything of its payment can be refunded.
	started := func(t *testing.T, tenant Tenant, checkoutID string) {
		t.Helper()
		if provider.Declaration().StoredCheckouts {
			tenant.RecordCheckout(t, checkoutID, tenant.Purchase())
		}
	}

	t.Run("a completed checkout creates one purchase however often it is delivered", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		payload, headers := completed(t, tenant, credentials, Checkout{
			CheckoutID: checkoutNamed("redelivered"),
			PaymentID:  paymentNamed("redelivered"),
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

	if _, ok := provider.(paymentprovider.CheckoutFollower); ok {
		// started writes the checkout's purchase down and starts it through
		// the provider, as the server does.
		started := func(t *testing.T, tenant Tenant, name string) Checkout {
			t.Helper()
			checkout := Checkout{CheckoutID: checkoutNamed(name), PaymentID: paymentNamed(name), Purchase: tenant.Purchase()}
			tenant.RecordCheckout(t, checkout.CheckoutID, checkout.Purchase)
			startCheckout(t, provider, credentials, checkout)
			return checkout
		}

		t.Run("a paid checkout whose notification never arrives is recorded once by reading it back", func(t *testing.T) {
			tenant := newTenant(t, credentials)
			checkout := started(t, tenant, "followed")
			if !tenant.FollowCheckout(t, checkout.CheckoutID) {
				t.Fatal("an unpaid checkout within its lifetime is read no more")
			}
			if got := tenant.Purchases(t); got != 0 {
				t.Fatalf("purchases of an unpaid checkout = %d, want 0", got)
			}
			fixture.PaymentTaken(t, credentials, checkout, time.Now())
			if tenant.FollowCheckout(t, checkout.CheckoutID) {
				t.Fatal("a checkout read back as paid is read again")
			}
			if !tenant.OpensEpisode(t) {
				t.Fatal("the purchase read back does not open the episode")
			}
			if got, want := tenant.SalesGross(t), int64(tenant.Purchase().Price); got != want {
				t.Fatalf("sales gross = %d, want %d", got, want)
			}
			// The notification may yet arrive, and the reading back may be
			// run again, as an event is at least once.
			payload, headers := fixture.CheckoutCompleted(t, credentials, checkout)
			if err := tenant.Deliver(t, payload, headers); err != nil {
				t.Fatalf("the late notification: %v", err)
			}
			tenant.FollowCheckout(t, checkout.CheckoutID)
			if got := tenant.Purchases(t); got != 1 {
				t.Fatalf("purchases = %d, want 1", got)
			}
		})

		t.Run("a checkout never paid records nothing and is read no more once its lifetime has passed", func(t *testing.T) {
			tenant := newTenant(t, credentials)
			checkout := started(t, tenant, "followed_unpaid")
			if !tenant.FollowCheckout(t, checkout.CheckoutID) {
				t.Fatal("an unpaid checkout within its lifetime is read no more")
			}
			tenant.LapseCheckout(t, checkout.CheckoutID)
			if tenant.FollowCheckout(t, checkout.CheckoutID) {
				t.Fatal("a checkout past its lifetime is read again")
			}
			if got := tenant.Purchases(t); got != 0 {
				t.Fatalf("purchases = %d, want 0", got)
			}
		})
	}

	if browser, ok := fixture.(BrowserCheckoutFixture); ok {
		runBrowserCheckout(t, browser, newTenant, currency)
	}

	if expiring, ok := fixture.(ExpiringCheckoutFixture); ok {
		t.Run("a checkout the provider answers as expired is started again under a new id", func(t *testing.T) {
			tenant := newTenant(t, credentials)
			ranOut := tenant.StartCheckout(t)
			if again := tenant.StartCheckout(t); again != ranOut {
				t.Fatalf("a retry was started as %q, want %q", again, ranOut)
			}
			expiring.CheckoutRanOut(t, credentials, Checkout{CheckoutID: ranOut, Purchase: tenant.Purchase()})
			fresh := tenant.StartCheckout(t)
			if fresh == ranOut {
				t.Fatal("the checkout that ran out was started under its own id again")
			}
			if again := tenant.StartCheckout(t); again != fresh {
				t.Fatalf("a retry of the new checkout was started as %q, want %q", again, fresh)
			}
			paymentID := "payment_" + fresh
			if provider.Declaration().PaymentsByCheckout {
				paymentID = fresh
			}
			payload, headers := fixture.CheckoutCompleted(t, credentials, Checkout{CheckoutID: fresh, PaymentID: paymentID, Purchase: tenant.Purchase()})
			if err := tenant.Deliver(t, payload, headers); err != nil {
				t.Fatalf("deliver the payment of the new checkout: %v", err)
			}
			if got := tenant.Purchases(t); got != 1 || !tenant.OpensEpisode(t) {
				t.Fatalf("purchases = %d, opens the episode %v; want 1 that opens it", got, tenant.OpensEpisode(t))
			}
		})
	}

	t.Run("a live-mode checkout opens the episode and is a sale", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		payload, headers := completed(t, tenant, credentials, Checkout{
			CheckoutID: checkoutNamed("live"),
			PaymentID:  paymentNamed("live"),
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

	t.Run("a checkout the tenant's promotion code discounted redeems it once and is a sale at its list price", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		purchase := tenant.DiscountedPurchase(t)
		payload, headers := completed(t, tenant, credentials, Checkout{
			CheckoutID: checkoutNamed("promotion_code"),
			PaymentID:  paymentNamed("promotion_code"),
			Purchase:   purchase,
		})
		for delivery := range 2 {
			if err := tenant.Deliver(t, payload, headers); err != nil {
				t.Fatalf("delivery %d: %v", delivery+1, err)
			}
		}
		if !tenant.OpensEpisode(t) {
			t.Fatal("the purchase does not open the episode")
		}
		if got := tenant.Redemptions(t); got != 1 {
			t.Fatalf("redemptions = %d, want 1", got)
		}
		if got := tenant.ListPrice(t); got != purchase.ListPrice {
			t.Fatalf("list price = %d, want %d", got, purchase.ListPrice)
		}
		// The tenant chose the promotion, so the Authors are paid as if the
		// episode had sold at its price.
		if got, want := tenant.SalesGross(t), int64(purchase.ListPrice); got != want {
			t.Fatalf("sales gross = %d, want %d, the list price", got, want)
		}
		// A refund of half of what was paid takes half of the list price off.
		refund, refundHeaders := fixture.Refunded(t, credentials, Refund{PaymentID: paymentNamed("promotion_code"), Currency: currency, AmountRefunded: int64(purchase.Price) / 2})
		if err := tenant.Deliver(t, refund, refundHeaders); err != nil {
			t.Fatalf("refund: %v", err)
		}
		if got, want := tenant.SalesRefunded(t), int64(purchase.ListPrice)/2; got != want {
			t.Fatalf("sales refunded = %d, want %d, half of the list price", got, want)
		}
	})

	t.Run("a test-mode checkout opens the episode and is no sale", func(t *testing.T) {
		// A provider whose test mode follows its credentials takes the
		// checkout for a tenant that saved its test credentials.
		tenant := newTenant(t, testCredentials(fixture))
		payload, headers := completed(t, tenant, testCredentials(fixture), Checkout{
			CheckoutID: checkoutNamed("test_mode"),
			PaymentID:  paymentNamed("test_mode"),
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
		started(t, tenant, checkoutNamed("early"))
		refund, refundHeaders := fixture.Refunded(t, credentials, Refund{PaymentID: paymentNamed("early"), Currency: currency, AmountRefunded: 500})
		if err := tenant.Deliver(t, refund, refundHeaders); err != nil {
			t.Fatalf("refund: %v", err)
		}
		if got := tenant.HeldRefunds(t); got != 1 {
			t.Fatalf("held refunds = %d, want 1", got)
		}
		checkout, checkoutHeaders := completed(t, tenant, credentials, Checkout{
			CheckoutID: checkoutNamed("early"),
			PaymentID:  paymentNamed("early"),
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
		checkout, checkoutHeaders := completed(t, tenant, credentials, Checkout{
			CheckoutID: checkoutNamed("partial"),
			PaymentID:  paymentNamed("partial"),
			Purchase:   tenant.Purchase(),
		})
		if err := tenant.Deliver(t, checkout, checkoutHeaders); err != nil {
			t.Fatalf("checkout: %v", err)
		}
		for _, total := range []int64{200, 500} {
			refund, refundHeaders := fixture.Refunded(t, credentials, Refund{PaymentID: paymentNamed("partial"), Currency: currency, AmountRefunded: total})
			if err := tenant.Deliver(t, refund, refundHeaders); err != nil {
				t.Fatalf("refund to %d: %v", total, err)
			}
			if got := tenant.RefundedAmount(t); int64(got) != total {
				t.Fatalf("refunded amount = %d, want %d", got, total)
			}
		}
	})

	if failing, ok := fixture.(FailingRefundFixture); ok {
		t.Run("a refund that fails before its purchase corrects the held refund", func(t *testing.T) {
			tenant := newTenant(t, credentials)
			started(t, tenant, checkoutNamed("held_refund_failed"))
			paymentID := paymentNamed("held_refund_failed")
			for _, total := range []int64{200, 500} {
				refund, refundHeaders := fixture.Refunded(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: total})
				if err := tenant.Deliver(t, refund, refundHeaders); err != nil {
					t.Fatalf("refund to %d: %v", total, err)
				}
			}
			failed, failedHeaders := failing.RefundFailed(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: 200})
			if err := tenant.Deliver(t, failed, failedHeaders); err != nil {
				t.Fatalf("failed refund: %v", err)
			}
			checkout, checkoutHeaders := completed(t, tenant, credentials, Checkout{
				CheckoutID: checkoutNamed("held_refund_failed"),
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
			paymentID := paymentNamed("refund_reopened")
			checkout, checkoutHeaders := completed(t, tenant, credentials, Checkout{
				CheckoutID: checkoutNamed("refund_reopened"),
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
			failed, failedHeaders := failing.RefundFailed(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: 0})
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
			paymentID := paymentNamed("staff_refund_failed")
			checkout, checkoutHeaders := completed(t, tenant, credentials, Checkout{
				CheckoutID: checkoutNamed("staff_refund_failed"),
				PaymentID:  paymentID,
				Purchase:   tenant.Purchase(),
			})
			if err := tenant.Deliver(t, checkout, checkoutHeaders); err != nil {
				t.Fatalf("checkout: %v", err)
			}
			fixture.Refunded(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: 500})
			tenant.RevokeAsStaff(t)
			failed, failedHeaders := failing.RefundFailed(t, credentials, Refund{PaymentID: paymentID, Currency: currency, AmountRefunded: 0})
			if err := tenant.Deliver(t, failed, failedHeaders); err != nil {
				t.Fatalf("failed refund: %v", err)
			}
			if !tenant.OpensEpisode(t) {
				t.Fatal("a purchase whose staff refund failed does not open the episode")
			}
		})
	}

	t.Run("a notification with a bad signature is refused", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		payload, headers := completed(t, tenant, fixture.OtherCredentials(), Checkout{
			CheckoutID: checkoutNamed("forged"),
			PaymentID:  paymentNamed("forged"),
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
		payload, headers := completed(t, other, credentials, Checkout{
			CheckoutID: checkoutNamed("crossed"),
			PaymentID:  paymentNamed("crossed"),
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

// runBrowserCheckout checks the purchase flow of a provider whose checkouts
// run in the reader's browser: the storefront page reads the checkout the
// server started, and the payment the script authorized completes it once,
// whether the page or the provider's notification reports it first, and only
// when it is the checkout's, captured either before the checkout's lifetime
// passed or never.
func runBrowserCheckout(t *testing.T, fixture BrowserCheckoutFixture, newTenant func(*testing.T, paymentprovider.Credentials) Tenant, currency string) {
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	// authorized starts the reader's checkout as the storefront does and
	// makes the payment called name one the script authorized for it, as the
	// checkout's or with differ applied to it, answering the provider's
	// notification of the authorization.
	authorized := func(t *testing.T, tenant Tenant, name string, differ func(*Checkout)) (Checkout, []byte, http.Header) {
		t.Helper()
		checkout := Checkout{CheckoutID: tenant.StartCheckout(t), PaymentID: "payment_" + name + "_" + strings.ToLower(currency), Purchase: tenant.Purchase()}
		paid := checkout
		if differ != nil {
			differ(&paid)
		}
		payload, headers := fixture.CheckoutCompleted(t, credentials, paid)
		return checkout, payload, headers
	}

	t.Run("the page of a checkout hands the script the public credentials and returns the reader to the checkout's pages", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		checkoutID := tenant.StartCheckout(t)
		page, err := tenant.BrowserCheckout(t, checkoutID)
		if err != nil {
			t.Fatalf("BrowserCheckout: %v", err)
		}
		public := provider.Declaration().PublicCredentials(credentials)
		if len(page.Script.Credentials) != len(public) {
			t.Fatalf("script credentials = %v, want %v", page.Script.Credentials, public)
		}
		for name, value := range public {
			if page.Script.Credentials[name] != value {
				t.Fatalf("script credentials = %v, want %v", page.Script.Credentials, public)
			}
		}
		if !strings.Contains(string(page.Script.Payload), checkoutID) {
			t.Fatalf("the script's payload %s does not name the checkout %s", page.Script.Payload, checkoutID)
		}
		if page.SuccessURL == "" || page.CancelURL == "" || page.SuccessURL == page.CancelURL {
			t.Fatalf("the page returns the reader to %q and %q, want the checkout's success and cancel pages", page.SuccessURL, page.CancelURL)
		}
	})

	t.Run("the page of a checkout the tenant did not start is refused", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		if _, err := tenant.BrowserCheckout(t, paymentprovider.StoredCheckoutID("contract-checkout:never-started")); err == nil {
			t.Fatal("the page of a checkout never started was answered")
		}
		if err := tenant.CompleteBrowserCheckout(t, paymentprovider.StoredCheckoutID("contract-checkout:never-started"), "payment_never_started"); err == nil {
			t.Fatal("a checkout never started was completed")
		}
	})

	for name, order := range map[string][]string{
		"by the page and then by the notification": {"page", "notification"},
		"by the notification and then by the page": {"notification", "page"},
	} {
		t.Run("a checkout completed "+name+" records one purchase and captures once", func(t *testing.T) {
			tenant := newTenant(t, credentials)
			checkout, payload, headers := authorized(t, tenant, "browser_"+order[0], nil)
			for _, by := range order {
				var err error
				if by == "page" {
					err = tenant.CompleteBrowserCheckout(t, checkout.CheckoutID, checkout.PaymentID)
				} else {
					err = tenant.Deliver(t, payload, headers)
				}
				if err != nil {
					t.Fatalf("completed by the %s: %v", by, err)
				}
			}
			if got := tenant.Purchases(t); got != 1 || !tenant.OpensEpisode(t) {
				t.Fatalf("purchases = %d, opens the episode %v; want 1 that opens it", got, tenant.OpensEpisode(t))
			}
			if got := fixture.Captures(t, credentials, checkout.PaymentID); got != 1 {
				t.Fatalf("captures = %d, want 1", got)
			}
			if got, want := tenant.SalesGross(t), int64(tenant.Purchase().Price); got != want {
				t.Fatalf("sales gross = %d, want %d", got, want)
			}
			// Once paid, the page starts no second payment of the checkout.
			if _, err := tenant.BrowserCheckout(t, checkout.CheckoutID); err == nil {
				t.Fatal("the page of a paid checkout was answered")
			}
		})
	}

	t.Run("a checkout completed by the page and the notification at once records one purchase and captures once", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		checkout, payload, headers := authorized(t, tenant, "browser_at_once", nil)
		var wg sync.WaitGroup
		errs := make([]error, 2)
		wg.Go(func() { errs[0] = tenant.CompleteBrowserCheckout(t, checkout.CheckoutID, checkout.PaymentID) })
		wg.Go(func() { errs[1] = tenant.Deliver(t, payload, headers) })
		wg.Wait()
		if err := errors.Join(errs...); err != nil {
			t.Fatalf("completed at once: %v", err)
		}
		if got := tenant.Purchases(t); got != 1 {
			t.Fatalf("purchases = %d, want 1", got)
		}
		if got := fixture.Captures(t, credentials, checkout.PaymentID); got != 1 {
			t.Fatalf("captures = %d, want 1", got)
		}
	})

	t.Run("a payment that is not the checkout's records nothing and captures nothing", func(t *testing.T) {
		for name, differ := range map[string]func(*Checkout){
			"another amount":   func(c *Checkout) { c.Purchase.Price = 400 },
			"another currency": func(c *Checkout) { c.Purchase.Currency = "XTS" },
			"another checkout": func(c *Checkout) {
				c.CheckoutID = paymentprovider.StoredCheckoutID("contract-checkout:another:" + c.CheckoutID)
			},
		} {
			t.Run(name, func(t *testing.T) {
				tenant := newTenant(t, credentials)
				checkout, payload, headers := authorized(t, tenant, "browser_mismatch_"+strings.ReplaceAll(name, " ", "_"), differ)
				if err := tenant.CompleteBrowserCheckout(t, checkout.CheckoutID, checkout.PaymentID); err == nil {
					t.Fatal("the page completed the checkout with a payment that is not its")
				}
				if err := tenant.Deliver(t, payload, headers); err == nil {
					t.Fatal("the notification completed a checkout with a payment that is not its")
				}
				if got := tenant.Purchases(t); got != 0 {
					t.Fatalf("purchases = %d, want 0", got)
				}
				if got := fixture.Captures(t, credentials, checkout.PaymentID); got != 0 {
					t.Fatalf("captures = %d, want 0", got)
				}
			})
		}
	})

	t.Run("a payment authorized once the checkout's lifetime has passed records nothing and captures nothing", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		checkout, payload, headers := authorized(t, tenant, "browser_lapsed", nil)
		tenant.LapseCheckout(t, checkout.CheckoutID)
		if err := tenant.CompleteBrowserCheckout(t, checkout.CheckoutID, checkout.PaymentID); err == nil {
			t.Fatal("the page completed a checkout past its lifetime")
		}
		if err := tenant.Deliver(t, payload, headers); err == nil {
			t.Fatal("the notification completed a checkout past its lifetime")
		}
		if got := tenant.Purchases(t); got != 0 {
			t.Fatalf("purchases = %d, want 0", got)
		}
		if got := fixture.Captures(t, credentials, checkout.PaymentID); got != 0 {
			t.Fatalf("captures = %d, want 0", got)
		}
	})

	t.Run("a payment captured before the server kept it is recorded once however late it is completed", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		checkout, payload, headers := authorized(t, tenant, "browser_captured_unkept", nil)
		// A completion captured the payment and failed before the server
		// kept it, and the checkout's lifetime passed before a retry.
		if _, err := provider.(paymentprovider.BrowserCheckout).CompleteCheckout(t.Context(), credentials, storedCheckout(checkout), checkout.PaymentID); err != nil {
			t.Fatalf("capture the payment: %v", err)
		}
		tenant.LapseCheckout(t, checkout.CheckoutID)
		if err := tenant.CompleteBrowserCheckout(t, checkout.CheckoutID, checkout.PaymentID); err != nil {
			t.Fatalf("completed by the page: %v", err)
		}
		if err := tenant.Deliver(t, payload, headers); err != nil {
			t.Fatalf("completed by the notification: %v", err)
		}
		if got := tenant.Purchases(t); got != 1 || !tenant.OpensEpisode(t) {
			t.Fatalf("purchases = %d, opens the episode %v; want 1 that opens it", got, tenant.OpensEpisode(t))
		}
		if got := fixture.Captures(t, credentials, checkout.PaymentID); got != 1 {
			t.Fatalf("captures = %d, want 1", got)
		}
	})

	t.Run("a second payment of a paid checkout records nothing and captures nothing", func(t *testing.T) {
		tenant := newTenant(t, credentials)
		checkout, _, _ := authorized(t, tenant, "browser_first", nil)
		if err := tenant.CompleteBrowserCheckout(t, checkout.CheckoutID, checkout.PaymentID); err != nil {
			t.Fatalf("complete the checkout: %v", err)
		}
		second := checkout
		second.PaymentID = "payment_browser_second_" + strings.ToLower(currency)
		payload, headers := fixture.CheckoutCompleted(t, credentials, second)
		if err := tenant.CompleteBrowserCheckout(t, second.CheckoutID, second.PaymentID); err == nil {
			t.Fatal("the page completed a paid checkout with a second payment")
		}
		if err := tenant.Deliver(t, payload, headers); err == nil {
			t.Fatal("the notification completed a paid checkout with a second payment")
		}
		if got := tenant.Purchases(t); got != 1 {
			t.Fatalf("purchases = %d, want 1", got)
		}
		if got := fixture.Captures(t, credentials, second.PaymentID); got != 0 {
			t.Fatalf("captures of the second payment = %d, want 0", got)
		}
	})
}
