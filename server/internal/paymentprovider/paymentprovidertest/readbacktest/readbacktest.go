// Package readbacktest is a payment provider that tells the server nothing it
// does not read back from its own API, and the contract fixture of that
// provider. Its payments carry no metadata, so it declares stored checkouts;
// its notifications carry no signature and name no more than which payment
// they are about; it sends no notification of a refund, so it follows its own;
// it notifies a checkout's payment no more than once, so it follows its
// checkouts too; and its API lists no payments, so it reads the payment of
// each checkout it is handed. No provider this build registers has that shape yet, and this one
// holds the contract and the purchase flow to it.
//
// [NewFixtureByCheckout] answers the same fake with an API that reads a
// payment by nothing but the id of its checkout, so its provider declares
// [paymentprovider.Declaration.PaymentsByCheckout] and names each payment by
// its checkout, keeping the API's own id of the payment to itself.
//
// [NewFixtureByCredentials] answers the same fake with an API whose sandbox is
// an account of its own, named by the credentials' [FieldEnvironment], whose
// payments say nothing of which mode took them, so its provider is a
// [paymentprovider.TestModeByCredentials] and its fixture a
// [paymentprovidertest.TestCredentialsFixture].
package readbacktest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
)

const (
	// ID is the provider id the fake registers under.
	ID = "readback"
	// IDByCheckout is the provider id the fake that names its payments by
	// their checkouts registers under, so that the two never share a
	// provider's ids in one database.
	IDByCheckout = "readback_by_checkout"
	// IDByCredentials is the provider id the fake whose test mode follows its
	// credentials registers under.
	IDByCredentials = "readback_by_credentials"
	// FieldAPIKey is the credential the fake declares, which names the
	// account of its API a request reads.
	FieldAPIKey = "api_key"
	// FieldEnvironment is the optional credential the fake whose test mode
	// follows its credentials declares beside FieldAPIKey: EnvironmentSandbox
	// names its sandbox, and empty its live accounts.
	FieldEnvironment = "environment"
	// EnvironmentSandbox is the FieldEnvironment of the fake's sandbox.
	EnvironmentSandbox = "sandbox"

	// CheckoutLifetime is how long a checkout of the fake can be paid.
	CheckoutLifetime = time.Hour

	// The notification types the fake sends.
	notificationPayment = "payment"
	notificationRefunds = "refunds"
	notificationOther   = "account.updated"
)

// The states of a payment and of a refund in the fake's API.
const (
	paymentOpen    = "open"
	paymentPaid    = "paid"
	paymentExpired = "expired"

	refundMade    = "made"
	refundFailed  = "failed"
	refundPending = "pending"
)

// Provider is the fake provider, reading its fake API.
type Provider struct {
	api *API
}

var _ paymentprovider.CheckoutFollower = (*Provider)(nil)

// NewProvider answers the fake provider over api.
func NewProvider(api *API) *Provider {
	return &Provider{api: api}
}

func (p *Provider) Declaration() paymentprovider.Declaration {
	declaration := paymentprovider.Declaration{
		ID:               ID,
		DisplayName:      "Read-back test provider",
		Fields:           []paymentprovider.Field{{Name: FieldAPIKey, Secret: true, Required: true}},
		Currencies:       []string{"JPY", "USD"},
		StoredCheckouts:  true,
		CheckoutLifetime: CheckoutLifetime,
	}
	if p.api.byCheckout {
		declaration.ID = IDByCheckout
		declaration.PaymentsByCheckout = true
	}
	if p.api.byCredentials {
		declaration.ID = IDByCredentials
		declaration.Fields = append(declaration.Fields, paymentprovider.Field{Name: FieldEnvironment})
	}
	return declaration
}

// ProviderByCredentials is the fake provider over an API whose test mode
// follows its credentials.
type ProviderByCredentials struct {
	*Provider
}

var _ paymentprovider.TestModeByCredentials = ProviderByCredentials{}

// TestMode reports credentials that name the fake's sandbox.
func (ProviderByCredentials) TestMode(credentials paymentprovider.Credentials) bool {
	return sandbox(credentials)
}

func sandbox(credentials paymentprovider.Credentials) bool {
	return credentials[FieldEnvironment] == EnvironmentSandbox
}

// StartCheckout records the checkout in the fake's API, as one the account
// holds open until it is paid, and answers a URL that names it. A checkout
// started without the id the server gives it is refused, since nothing could
// then find its purchase again.
func (p *Provider) StartCheckout(_ context.Context, credentials paymentprovider.Credentials, req paymentprovider.CheckoutRequest) (string, error) {
	if credentials[FieldAPIKey] == "" {
		return "", errors.New("readbacktest: no api key")
	}
	if req.CheckoutID == "" {
		return "", errors.New("readbacktest: the checkout names no id")
	}
	p.api.mu.Lock()
	defer p.api.mu.Unlock()
	p.api.started = append(p.api.started, req)
	acct := p.api.account(credentials)
	if acct.byCheckout(req.CheckoutID) == nil {
		paymentID := "open_" + req.CheckoutID
		acct.payments[paymentID] = &payment{id: paymentID, checkoutID: req.CheckoutID, currency: req.Purchase.Currency, status: paymentOpen}
		acct.checkouts[req.CheckoutID] = paymentID
	}
	return "https://readback.example/checkouts/" + req.CheckoutID, nil
}

// notification is every notification the fake sends: which payment, by its
// checkout or by its own id, it is about.
type notification struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	CheckoutID string `json:"checkout_id,omitempty"`
	PaymentID  string `json:"payment_id,omitempty"`
}

func (p *Provider) ParseNotification(_ context.Context, payload []byte, _ http.Header, credentials paymentprovider.Credentials) (paymentprovider.Event, error) {
	var n notification
	if err := json.Unmarshal(payload, &n); err != nil {
		return nil, fmt.Errorf("%w: %v", paymentprovider.ErrMalformedNotification, err)
	}
	p.api.mu.Lock()
	defer p.api.mu.Unlock()
	account := p.api.lookup(credentials)
	switch n.Type {
	case notificationPayment:
		payment := account.byCheckout(n.CheckoutID)
		if payment == nil {
			return nil, paymentprovider.ErrInvalidSignature
		}
		if payment.status == paymentOpen {
			return paymentprovider.Ignored{ID: n.ID, Type: n.Type}, nil
		}
		if payment.status == paymentExpired {
			return paymentprovider.CheckoutExpired{
				ID:         n.ID,
				CheckoutID: payment.checkoutID,
				Purchase:   paymentprovider.Purchase{Currency: payment.currency},
			}, nil
		}
		return paymentprovider.PurchaseCompleted{
			ID:         n.ID,
			CheckoutID: payment.checkoutID,
			PaymentID:  p.api.reported(payment),
			Purchase:   paymentprovider.Purchase{Currency: payment.currency},
			AmountPaid: int32(payment.amount),
			Test:       p.api.test(payment, credentials),
		}, nil
	case notificationRefunds:
		payment := p.api.named(account, n.PaymentID)
		if payment == nil {
			return nil, paymentprovider.ErrInvalidSignature
		}
		return payment.refundEvent(n.ID, p.api.reported(payment))
	default:
		return paymentprovider.Ignored{ID: n.ID, Type: n.Type}, nil
	}
}

// RefundNotification answers the notification of the refunds of paymentID the
// fake would send if it sent one.
func (*Provider) RefundNotification(paymentID string) []byte {
	payload, err := json.Marshal(notification{ID: "follow_" + paymentID, Type: notificationRefunds, PaymentID: paymentID})
	if err != nil {
		panic(err)
	}
	return payload
}

// CheckoutNotification answers the notification of the payment of the
// checkout checkoutID, which is the one the fake sends once it is paid.
func (*Provider) CheckoutNotification(checkoutID string) []byte {
	payload, err := json.Marshal(notification{ID: "follow_" + checkoutID, Type: notificationPayment, CheckoutID: checkoutID})
	if err != nil {
		panic(err)
	}
	return payload
}

// Refund refunds req.Amount, or what is left of the payment, once per key: a
// refund of an amount is found again by the key it was made under, which the
// fake keeps beside the refund as a provider's metadata would.
func (p *Provider) Refund(_ context.Context, credentials paymentprovider.Credentials, req paymentprovider.RefundRequest) (bool, error) {
	p.api.mu.Lock()
	defer p.api.mu.Unlock()
	account := p.api.lookup(credentials)
	payment := p.api.named(account, req.PaymentID)
	if payment == nil {
		return false, fmt.Errorf("%w: no such payment", paymentprovider.ErrRefundRefused)
	}
	if payment.breakNext {
		payment.breakNext = false
		return false, errors.New("readbacktest: the API did not answer")
	}
	if made := payment.refundBy(req.IdempotencyKey, req.Amount > 0 || account.remembers(req.IdempotencyKey)); made != nil {
		if made.status == refundFailed {
			return false, fmt.Errorf("%w: the refund failed", paymentprovider.ErrRefundRefused)
		}
		return true, nil
	}
	remaining := payment.amount - payment.refunded()
	amount := remaining
	if req.Amount > 0 {
		amount = req.Amount
	}
	if amount > remaining {
		return false, fmt.Errorf("%w: more than is left of the payment", paymentprovider.ErrRefundRefused)
	}
	if remaining <= 0 {
		return false, nil
	}
	status := refundMade
	switch {
	case payment.failNext:
		status, payment.failNext = refundFailed, false
	case payment.holdNext:
		status, payment.holdNext = refundPending, false
	}
	payment.add(&refund{key: req.IdempotencyKey, amount: amount, status: status, keyed: req.Amount > 0})
	account.remember(req.IdempotencyKey)
	if status == refundFailed {
		return false, fmt.Errorf("%w: the refund failed", paymentprovider.ErrRefundRefused)
	}
	return true, nil
}

func (p *Provider) RefundMade(_ context.Context, credentials paymentprovider.Credentials, paymentID, refundKey string) (bool, error) {
	p.api.mu.Lock()
	defer p.api.mu.Unlock()
	payment := p.api.named(p.api.lookup(credentials), paymentID)
	if payment == nil {
		return false, nil
	}
	made := payment.refundBy(refundKey, true)
	return made != nil && made.status != refundFailed, nil
}

// ListTransactions reads the payment of each checkout it is handed, since the
// fake's API lists none.
func (p *Provider) ListTransactions(_ context.Context, credentials paymentprovider.Credentials, from, to time.Time, checkoutIDs []string) ([]paymentprovider.Transaction, error) {
	p.api.mu.Lock()
	defer p.api.mu.Unlock()
	account := p.api.lookup(credentials)
	var transactions []paymentprovider.Transaction
	for _, checkoutID := range checkoutIDs {
		payment := account.byCheckout(checkoutID)
		if payment == nil || payment.status != paymentPaid || payment.created.Before(from) || !payment.created.Before(to) {
			continue
		}
		transactions = append(transactions, paymentprovider.Transaction{
			PaymentID:      p.api.reported(payment),
			Amount:         payment.amount,
			AmountRefunded: payment.refunded(),
			Currency:       payment.currency,
			Test:           p.api.test(payment, credentials),
			Created:        payment.created.UTC(),
		})
	}
	slices.SortStableFunc(transactions, func(a, b paymentprovider.Transaction) int {
		return a.Created.Compare(b.Created)
	})
	return transactions, nil
}

// API is the fake's API: each api key sees only the payments made under it,
// as each account of a provider does.
type API struct {
	mu       sync.Mutex
	accounts map[string]*account
	started  []paymentprovider.CheckoutRequest
	events   int
	// byCheckout makes it an API that reads a payment by the id of its
	// checkout alone.
	byCheckout bool
	// byCredentials makes it an API whose sandbox holds accounts of its own,
	// which the credentials' FieldEnvironment names, and whose payments are
	// tests exactly when they are the sandbox's.
	byCredentials bool
}

// NewAPI answers an empty fake API.
func NewAPI() *API {
	return &API{accounts: map[string]*account{}}
}

// NewAPIByCheckout answers an empty fake API that reads a payment by the id
// of its checkout alone.
func NewAPIByCheckout() *API {
	return &API{accounts: map[string]*account{}, byCheckout: true}
}

// NewAPIByCredentials answers an empty fake API whose test mode is its
// sandbox's accounts.
func NewAPIByCredentials() *API {
	return &API{accounts: map[string]*account{}, byCredentials: true}
}

// key answers the key of the account credentials name: the api key, within
// the environment for an API whose sandbox holds accounts of its own.
func (a *API) key(credentials paymentprovider.Credentials) string {
	if a.byCredentials {
		return credentials[FieldEnvironment] + "/" + credentials[FieldAPIKey]
	}
	return credentials[FieldAPIKey]
}

// lookup answers the account credentials name, nil when it holds nothing.
func (a *API) lookup(credentials paymentprovider.Credentials) *account {
	return a.accounts[a.key(credentials)]
}

// test reports whether the provider reads payment, read under credentials, as
// a test: as the payment was made, or, for an API whose test mode is its
// sandbox, as the credentials name the sandbox.
func (a *API) test(payment *payment, credentials paymentprovider.Credentials) bool {
	if a.byCredentials {
		return sandbox(credentials)
	}
	return payment.test
}

// PaymentID answers the id the provider reports for the payment paymentID of
// the checkout checkoutID, as [API.Pay] was told them: the checkout's for an
// API that reads a payment by nothing else, and the payment's own otherwise.
func (a *API) PaymentID(checkoutID, paymentID string) string {
	if a.byCheckout {
		return checkoutID
	}
	return paymentID
}

// reported answers the id the provider reports for payment.
func (a *API) reported(payment *payment) string {
	return a.PaymentID(payment.checkoutID, payment.id)
}

// named answers the payment of account the provider reports as paymentID.
func (a *API) named(account *account, paymentID string) *payment {
	if a.byCheckout {
		return account.byCheckout(paymentID)
	}
	return account.payment(paymentID)
}

type account struct {
	payments  map[string]*payment
	checkouts map[string]string
	// keys are the idempotency keys of the refunds the account has made and
	// not forgotten.
	keys map[string]bool
}

type payment struct {
	id, checkoutID string
	amount         int64
	currency       string
	test           bool
	status         string
	// created is when the payment was taken, and zero for one no list of
	// the period reads.
	created time.Time
	refunds []*refund
	// changed is the refund that changed last, which the refunds'
	// notification reports on.
	changed *refund
	// failNext and holdNext make the next refund a failed or a pending one,
	// and breakNext the next request for one fail before the fake makes it.
	failNext, holdNext, breakNext bool
}

type refund struct {
	key    string
	amount int64
	status string
	// keyed reports a refund of an amount, which carries its key beside it.
	keyed bool
}

func (a *account) payment(paymentID string) *payment {
	if a == nil {
		return nil
	}
	return a.payments[paymentID]
}

func (a *account) byCheckout(checkoutID string) *payment {
	if a == nil {
		return nil
	}
	return a.payments[a.checkouts[checkoutID]]
}

func (a *account) remembers(key string) bool { return a != nil && a.keys[key] }

func (a *account) remember(key string) { a.keys[key] = true }

// refundBy answers the refund made under key, when lookUp allows it: a
// refund of an amount is always found by the key beside it, and one of the
// rest only while the account remembers the key it was sent under.
func (p *payment) refundBy(key string, lookUp bool) *refund {
	if !lookUp {
		return nil
	}
	for _, r := range p.refunds {
		if r.key == key {
			return r
		}
	}
	return nil
}

func (p *payment) refunded() int64 {
	var total int64
	for _, r := range p.refunds {
		if r.status == refundMade {
			total += r.amount
		}
	}
	return total
}

func (p *payment) add(r *refund) {
	p.refunds = append(p.refunds, r)
	p.changed = r
}

// refundEvent is what the notification of the payment's refunds reports,
// naming the payment paymentID.
func (p *payment) refundEvent(id, paymentID string) (paymentprovider.Event, error) {
	for _, r := range p.refunds {
		if r.status == refundPending {
			return nil, paymentprovider.ErrRefundPending
		}
	}
	if p.changed != nil && p.changed.status == refundFailed {
		failed := paymentprovider.RefundFailed{ID: id, PaymentID: paymentID, AmountRefunded: p.refunded(), Currency: p.currency}
		if p.changed.keyed {
			failed.RefundKey = p.changed.key
		}
		return failed, nil
	}
	if total := p.refunded(); total > 0 {
		return paymentprovider.Refunded{ID: id, PaymentID: paymentID, AmountRefunded: total, Currency: p.currency}, nil
	}
	return paymentprovider.Ignored{ID: id, Type: notificationRefunds}, nil
}

func (a *API) account(credentials paymentprovider.Credentials) *account {
	key := a.key(credentials)
	acct, ok := a.accounts[key]
	if !ok {
		acct = &account{payments: map[string]*payment{}, checkouts: map[string]string{}, keys: map[string]bool{}}
		a.accounts[key] = acct
	}
	return acct
}

func (a *API) eventID() string {
	a.events++
	return "evt_" + strconv.Itoa(a.events)
}

// Started answers every checkout the provider was asked to start, in order.
func (a *API) Started() []paymentprovider.CheckoutRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	return slices.Clone(a.started)
}

// Pay makes the account credentials name hold the payment paymentID of the
// checkout checkoutID, of amount in currency, taken at at, and answers the
// notification the fake sends for it. paymentID is the API's own id of the
// payment, which [API.PaymentID] answers the id the provider reports for.
// test makes it a payment of the test mode, which an API whose test mode is
// its sandbox's accounts reads from the credentials instead.
func (a *API) Pay(credentials paymentprovider.Credentials, checkoutID, paymentID string, amount int64, currency string, test bool, at time.Time) []byte {
	a.mu.Lock()
	defer a.mu.Unlock()
	acct := a.account(credentials)
	acct.payments[paymentID] = &payment{id: paymentID, checkoutID: checkoutID, amount: amount, currency: currency, test: test, status: paymentPaid, created: at}
	acct.checkouts[checkoutID] = paymentID
	return a.notification(notification{Type: notificationPayment, CheckoutID: checkoutID})
}

// Expire makes the checkout checkoutID one that closed unpaid, and answers
// the notification the fake sends for it.
func (a *API) Expire(credentials paymentprovider.Credentials, checkoutID, currency string) []byte {
	a.mu.Lock()
	defer a.mu.Unlock()
	acct := a.account(credentials)
	paymentID := "expired_" + checkoutID
	acct.payments[paymentID] = &payment{id: paymentID, checkoutID: checkoutID, currency: currency, status: paymentExpired}
	acct.checkouts[checkoutID] = paymentID
	return a.notification(notification{Type: notificationPayment, CheckoutID: checkoutID})
}

// HoldNextRefund makes the next refund of the payment the provider reports as
// paymentID one the fake has neither made nor failed until SettleRefunds.
func (a *API) HoldNextRefund(credentials paymentprovider.Credentials, paymentID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if p := a.named(a.account(credentials), paymentID); p != nil {
		p.holdNext = true
	}
}

// BreakNextRefund makes the next request for a refund of the payment the
// provider reports as paymentID fail before the fake makes any, as a request
// cut off on its way to a provider does.
func (a *API) BreakNextRefund(credentials paymentprovider.Credentials, paymentID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if p := a.named(a.account(credentials), paymentID); p != nil {
		p.breakNext = true
	}
}

// SettleRefunds makes every pending refund of the payment the provider reports
// as paymentID, failing them when fail is set.
func (a *API) SettleRefunds(credentials paymentprovider.Credentials, paymentID string, fail bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p := a.named(a.account(credentials), paymentID)
	if p == nil {
		return
	}
	for _, r := range p.refunds {
		if r.status != refundPending {
			continue
		}
		r.status = refundMade
		if fail {
			r.status = refundFailed
		}
		p.changed = r
	}
}

func (a *API) notification(n notification) []byte {
	n.ID = a.eventID()
	payload, err := json.Marshal(n)
	if err != nil {
		panic(err)
	}
	return payload
}

// Fixture is the contract fixture of the fake.
type Fixture struct {
	api      *API
	provider paymentprovider.Provider
	// fake is the provider the fixture's notifications are answered by.
	fake *Provider
}

var _ paymentprovidertest.Fixture = (*Fixture)(nil)

// NewFixture answers a fixture over a fake API of its own.
func NewFixture(testing.TB) *Fixture {
	return newFixture(NewAPI())
}

func newFixture(api *API) *Fixture {
	fake := NewProvider(api)
	return &Fixture{api: api, provider: fake, fake: fake}
}

// NewFixtureByCheckout answers a fixture over a fake API of its own that
// reads a payment by the id of its checkout alone.
func NewFixtureByCheckout(testing.TB) *Fixture {
	return newFixture(NewAPIByCheckout())
}

// FixtureByCredentials is the contract fixture of the fake whose test mode
// follows its credentials.
type FixtureByCredentials struct {
	*Fixture
}

var _ paymentprovidertest.TestCredentialsFixture = FixtureByCredentials{}

// NewFixtureByCredentials answers a fixture over a fake API of its own whose
// test mode is its sandbox's accounts.
func NewFixtureByCredentials(testing.TB) FixtureByCredentials {
	fixture := newFixture(NewAPIByCredentials())
	fixture.provider = ProviderByCredentials{Provider: fixture.fake}
	return FixtureByCredentials{Fixture: fixture}
}

// TestCredentials answers the credentials of an account of the fake's
// sandbox.
func (FixtureByCredentials) TestCredentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{FieldAPIKey: "readback_sandbox_key", FieldEnvironment: EnvironmentSandbox}
}

// ownID answers the id the fake's API gives the payment of the checkout
// checkoutID that the provider reports as paymentID: that id, or, for an API
// that reads a payment by its checkout alone, one of its own that the
// provider never reports, so that a provider reporting it is caught.
func (f *Fixture) ownID(checkoutID, paymentID string) string {
	if f.api.byCheckout {
		return "own_" + checkoutID
	}
	return paymentID
}

// API answers the fixture's fake API, for a test that drives it directly.
func (f *Fixture) API() *API { return f.api }

func (f *Fixture) Provider() paymentprovider.Provider { return f.provider }

func (*Fixture) Credentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{FieldAPIKey: "readback_key"}
}

func (*Fixture) OtherCredentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{FieldAPIKey: "readback_other_key"}
}

// checkMode fails t when the suite hands a fixture whose test mode follows
// its credentials a checkout in the other mode than the credentials name,
// which no tenant's payment of that provider could be.
func (f *Fixture) checkMode(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) {
	t.Helper()
	switch {
	case !f.api.byCredentials || checkout.Test == sandbox(credentials):
	case checkout.Test:
		t.Fatal("readbacktest: a test-mode checkout under live credentials")
	default:
		t.Fatal("readbacktest: a live checkout under the sandbox's credentials")
	}
}

func (f *Fixture) CheckoutCompleted(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) ([]byte, http.Header) {
	f.checkMode(t, credentials, checkout)
	return f.api.Pay(credentials, checkout.CheckoutID, f.ownID(checkout.CheckoutID, checkout.PaymentID), int64(checkout.Purchase.Price), checkout.Purchase.Currency, checkout.Test, time.Time{}), http.Header{}
}

func (f *Fixture) PaymentTaken(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout, at time.Time) {
	f.checkMode(t, credentials, checkout)
	f.api.Pay(credentials, checkout.CheckoutID, f.ownID(checkout.CheckoutID, checkout.PaymentID), int64(checkout.Purchase.Price), checkout.Purchase.Currency, checkout.Test, at)
}

// Refunded refunds as much more of the payment as brings its total to
// refunded.AmountRefunded, as a refund made in the provider's dashboard does,
// and answers the notification the fake would send of the payment's refunds.
func (f *Fixture) Refunded(_ testing.TB, credentials paymentprovider.Credentials, refunded paymentprovidertest.Refund) ([]byte, http.Header) {
	f.api.mu.Lock()
	acct := f.api.account(credentials)
	p := f.api.named(acct, refunded.PaymentID)
	if p == nil {
		// A refund may arrive before its payment is recorded anywhere but
		// the provider's, which the fake holds as a payment no checkout names,
		// or, for an API that reads a payment by its checkout alone, as one
		// the checkout it is reported by names.
		p = &payment{id: refunded.PaymentID, currency: refunded.Currency, amount: refunded.AmountRefunded, status: paymentPaid}
		if f.api.byCheckout {
			p.id, p.checkoutID = f.ownID(refunded.PaymentID, ""), refunded.PaymentID
			acct.checkouts[p.checkoutID] = p.id
		}
		acct.payments[p.id] = p
	}
	if more := refunded.AmountRefunded - p.refunded(); more > 0 {
		p.amount = max(p.amount, refunded.AmountRefunded)
		p.add(&refund{amount: more, status: refundMade})
	}
	f.api.mu.Unlock()
	return f.fake.RefundNotification(refunded.PaymentID), http.Header{}
}

func (f *Fixture) RefundedTotal(_ testing.TB, credentials paymentprovider.Credentials, paymentID string) int64 {
	f.api.mu.Lock()
	defer f.api.mu.Unlock()
	p := f.api.named(f.api.account(credentials), paymentID)
	if p == nil {
		return 0
	}
	return p.refunded()
}

func (f *Fixture) FailNextRefund(_ testing.TB, credentials paymentprovider.Credentials, paymentID string) {
	f.api.mu.Lock()
	defer f.api.mu.Unlock()
	if p := f.api.named(f.api.account(credentials), paymentID); p != nil {
		p.failNext = true
	}
}

func (f *Fixture) ForgetIdempotencyKeys(_ testing.TB, credentials paymentprovider.Credentials) {
	f.api.mu.Lock()
	defer f.api.mu.Unlock()
	f.api.account(credentials).keys = map[string]bool{}
}

// RefundFailed fails the refund made under failed.Key, or else the latest
// refunds of the payment until no more than failed.AmountRefunded stays
// refunded, and answers the notification of the payment's refunds.
func (f *Fixture) RefundFailed(_ testing.TB, credentials paymentprovider.Credentials, failed paymentprovidertest.Refund) ([]byte, http.Header) {
	f.api.mu.Lock()
	if p := f.api.named(f.api.account(credentials), failed.PaymentID); p != nil {
		if failed.Key != "" {
			if r := p.refundBy(failed.Key, true); r != nil {
				r.status = refundFailed
				p.changed = r
			}
		}
		for i := len(p.refunds) - 1; i >= 0 && p.refunded() > failed.AmountRefunded; i-- {
			if r := p.refunds[i]; r.status == refundMade {
				r.status = refundFailed
				p.changed = r
			}
		}
	}
	f.api.mu.Unlock()
	return f.fake.RefundNotification(failed.PaymentID), http.Header{}
}

func (f *Fixture) Unrelated(testing.TB, paymentprovider.Credentials) ([]byte, http.Header) {
	f.api.mu.Lock()
	defer f.api.mu.Unlock()
	return f.api.notification(notification{Type: notificationOther}), http.Header{}
}
