// Package readbacktest is a payment provider that tells the server nothing it
// does not read back from its own API, and the contract fixture of that
// provider. Its payments carry no metadata, so it declares stored checkouts;
// its notifications carry no signature and name no more than which payment
// they are about; it sends no notification of a refund, so it follows its own;
// and its API lists no payments, so it reads the payment of each checkout it
// is handed. No provider this build registers has that shape yet, and this one
// holds the contract and the purchase flow to it.
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
	// FieldAPIKey is the one credential the fake declares, which names the
	// account of its API a request reads.
	FieldAPIKey = "api_key"

	// CheckoutLifetime is how long a checkout of the fake can be paid.
	CheckoutLifetime = time.Hour

	// The notification types the fake sends.
	notificationPayment = "payment"
	notificationRefunds = "refunds"
	notificationOther   = "account.updated"
)

// The states of a payment and of a refund in the fake's API.
const (
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

// NewProvider answers the fake provider over api.
func NewProvider(api *API) *Provider {
	return &Provider{api: api}
}

func (*Provider) Declaration() paymentprovider.Declaration {
	return paymentprovider.Declaration{
		ID:               ID,
		DisplayName:      "Read-back test provider",
		Fields:           []paymentprovider.Field{{Name: FieldAPIKey, Secret: true, Required: true}},
		Currencies:       []string{"JPY", "USD"},
		StoredCheckouts:  true,
		CheckoutLifetime: CheckoutLifetime,
	}
}

// StartCheckout records the checkout in the fake's API and answers a URL that
// names it. A checkout started without the id the server gives it is refused,
// since nothing could then find its purchase again.
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
	account := p.api.accounts[credentials[FieldAPIKey]]
	switch n.Type {
	case notificationPayment:
		payment := account.byCheckout(n.CheckoutID)
		if payment == nil {
			return nil, paymentprovider.ErrInvalidSignature
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
			PaymentID:  payment.id,
			Purchase:   paymentprovider.Purchase{Currency: payment.currency},
			AmountPaid: int32(payment.amount),
			Test:       payment.test,
		}, nil
	case notificationRefunds:
		payment := account.payment(n.PaymentID)
		if payment == nil {
			return nil, paymentprovider.ErrInvalidSignature
		}
		return payment.refundEvent(n.ID)
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

// Refund refunds req.Amount, or what is left of the payment, once per key: a
// refund of an amount is found again by the key it was made under, which the
// fake keeps beside the refund as a provider's metadata would.
func (p *Provider) Refund(_ context.Context, credentials paymentprovider.Credentials, req paymentprovider.RefundRequest) (bool, error) {
	p.api.mu.Lock()
	defer p.api.mu.Unlock()
	account := p.api.accounts[credentials[FieldAPIKey]]
	payment := account.payment(req.PaymentID)
	if payment == nil {
		return false, fmt.Errorf("%w: no such payment", paymentprovider.ErrRefundRefused)
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
	payment := p.api.accounts[credentials[FieldAPIKey]].payment(paymentID)
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
	account := p.api.accounts[credentials[FieldAPIKey]]
	var transactions []paymentprovider.Transaction
	for _, checkoutID := range checkoutIDs {
		payment := account.byCheckout(checkoutID)
		if payment == nil || payment.status != paymentPaid || payment.created.Before(from) || !payment.created.Before(to) {
			continue
		}
		transactions = append(transactions, paymentprovider.Transaction{
			PaymentID:      payment.id,
			Amount:         payment.amount,
			AmountRefunded: payment.refunded(),
			Currency:       payment.currency,
			Test:           payment.test,
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
}

// NewAPI answers an empty fake API.
func NewAPI() *API {
	return &API{accounts: map[string]*account{}}
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
	// failNext and holdNext make the next refund a failed or a pending one.
	failNext, holdNext bool
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

// refundEvent is what the notification of the payment's refunds reports.
func (p *payment) refundEvent(id string) (paymentprovider.Event, error) {
	for _, r := range p.refunds {
		if r.status == refundPending {
			return nil, paymentprovider.ErrRefundPending
		}
	}
	if p.changed != nil && p.changed.status == refundFailed {
		failed := paymentprovider.RefundFailed{ID: id, PaymentID: p.id, AmountRefunded: p.refunded(), Currency: p.currency}
		if p.changed.keyed {
			failed.RefundKey = p.changed.key
		}
		return failed, nil
	}
	if total := p.refunded(); total > 0 {
		return paymentprovider.Refunded{ID: id, PaymentID: p.id, AmountRefunded: total, Currency: p.currency}, nil
	}
	return paymentprovider.Ignored{ID: id, Type: notificationRefunds}, nil
}

func (a *API) account(credentials paymentprovider.Credentials) *account {
	key := credentials[FieldAPIKey]
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
// notification the fake sends for it.
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

// HoldNextRefund makes the next refund of the payment one the fake has
// neither made nor failed until SettleRefunds.
func (a *API) HoldNextRefund(credentials paymentprovider.Credentials, paymentID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if p := a.account(credentials).payments[paymentID]; p != nil {
		p.holdNext = true
	}
}

// SettleRefunds makes every pending refund of the payment, failing them when
// fail is set.
func (a *API) SettleRefunds(credentials paymentprovider.Credentials, paymentID string, fail bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p := a.account(credentials).payments[paymentID]
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
	provider *Provider
}

var _ paymentprovidertest.Fixture = (*Fixture)(nil)

// NewFixture answers a fixture over a fake API of its own.
func NewFixture(testing.TB) *Fixture {
	api := NewAPI()
	return &Fixture{api: api, provider: NewProvider(api)}
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

func (f *Fixture) CheckoutCompleted(_ testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) ([]byte, http.Header) {
	return f.api.Pay(credentials, checkout.CheckoutID, checkout.PaymentID, int64(checkout.Purchase.Price), checkout.Purchase.Currency, checkout.Test, time.Time{}), http.Header{}
}

func (f *Fixture) PaymentTaken(_ testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout, at time.Time) {
	f.api.Pay(credentials, checkout.CheckoutID, checkout.PaymentID, int64(checkout.Purchase.Price), checkout.Purchase.Currency, checkout.Test, at)
}

// Refunded refunds as much more of the payment as brings its total to
// refunded.AmountRefunded, as a refund made in the provider's dashboard does,
// and answers the notification the fake would send of the payment's refunds.
func (f *Fixture) Refunded(_ testing.TB, credentials paymentprovider.Credentials, refunded paymentprovidertest.Refund) ([]byte, http.Header) {
	f.api.mu.Lock()
	acct := f.api.account(credentials)
	p := acct.payments[refunded.PaymentID]
	if p == nil {
		// A refund may arrive before its payment is recorded anywhere but
		// the provider's, which the fake holds as a payment no checkout names.
		p = &payment{id: refunded.PaymentID, currency: refunded.Currency, amount: refunded.AmountRefunded, status: paymentPaid}
		acct.payments[refunded.PaymentID] = p
	}
	if more := refunded.AmountRefunded - p.refunded(); more > 0 {
		p.amount = max(p.amount, refunded.AmountRefunded)
		p.add(&refund{amount: more, status: refundMade})
	}
	f.api.mu.Unlock()
	return f.provider.RefundNotification(refunded.PaymentID), http.Header{}
}

func (f *Fixture) RefundedTotal(_ testing.TB, credentials paymentprovider.Credentials, paymentID string) int64 {
	f.api.mu.Lock()
	defer f.api.mu.Unlock()
	p := f.api.account(credentials).payments[paymentID]
	if p == nil {
		return 0
	}
	return p.refunded()
}

func (f *Fixture) FailNextRefund(_ testing.TB, credentials paymentprovider.Credentials, paymentID string) {
	f.api.mu.Lock()
	defer f.api.mu.Unlock()
	if p := f.api.account(credentials).payments[paymentID]; p != nil {
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
	if p := f.api.account(credentials).payments[failed.PaymentID]; p != nil {
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
	return f.provider.RefundNotification(failed.PaymentID), http.Header{}
}

func (f *Fixture) Unrelated(testing.TB, paymentprovider.Credentials) ([]byte, http.Header) {
	f.api.mu.Lock()
	defer f.api.mu.Unlock()
	return f.api.notification(notification{Type: notificationOther}), http.Header{}
}
