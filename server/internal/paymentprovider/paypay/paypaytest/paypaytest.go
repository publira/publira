// Package paypaytest delivers PayPay notifications for tests and fakes the
// endpoints of PayPay's Open Payment API the provider calls: the contract
// fixture over the notifications under testdata, [API] for a test that drives
// the fake directly, and [Notification] for a test that needs a notification
// of its own shape.
//
// The fake checks every request's HMAC authentication as PayPay does, keeps
// the payments of each API key apart, and runs production and the sandbox on
// a server each, whose keys reach the payments of that environment alone.
package paypaytest

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/paypay"
)

//go:embed testdata/*.json
var notifications embed.FS

// CodeValidity is how long after its creation the fake's code can be paid.
const CodeValidity = 5 * time.Minute

// clockSkew is how far a request's epoch may stray from the fake's clock.
const clockSkew = 2 * time.Minute

var merchantIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// API is a fake of the PayPay API endpoints the provider calls.
type API struct {
	production *httptest.Server
	sandbox    *httptest.Server

	mu sync.Mutex
	// secrets holds the secret of each API key, and merchants the merchant ID
	// it acts for, by account.
	secrets   map[string]string
	merchants map[string]string
	accounts  map[string]*account
	codes     []CodeRequest
	ids       int
	// refuseDuplicates makes a code requested again under a merchantPaymentId
	// answered as a duplicate rather than as it was first made.
	refuseDuplicates bool
}

// CodeRequest is one request the fake received to create a code.
type CodeRequest struct {
	APIKey string
	Body   map[string]any
}

type account struct {
	// payments are keyed by merchantPaymentId.
	payments map[string]*payment
	// idempotent holds the refund each merchantRefundId made, until the
	// fake is told to forget them.
	idempotent map[string]*refund
}

type payment struct {
	merchantPaymentID string
	paymentID         string
	amount            int64
	currency          string
	status            string
	// expiry is when the payment's code stops being payable, and zero for a
	// payment made with no code.
	expiry     time.Time
	acceptedAt time.Time
	code       map[string]any
	refunds    []*refund
	// failNext makes the next refund of the payment one PayPay answers as
	// failed, and holdNext one it has accepted and not made yet.
	failNext, holdNext bool
}

type refund struct {
	merchantRefundID string
	amount           int64
	status           string
	acceptedAt       time.Time
	requestedAt      int64
}

// NewAPI answers a fake that serves until t ends.
func NewAPI(t testing.TB) *API {
	t.Helper()
	api := &API{secrets: map[string]string{}, merchants: map[string]string{}, accounts: map[string]*account{}}
	api.production = httptest.NewServer(api.mux(""))
	api.sandbox = httptest.NewServer(api.mux(paypay.EnvironmentSandbox))
	t.Cleanup(api.production.Close)
	t.Cleanup(api.sandbox.Close)
	return api
}

// Provider answers the provider pointed at the fake.
func (a *API) Provider() *paypay.Provider {
	return paypay.New(paypay.WithBaseURLs(a.production.URL, a.sandbox.URL))
}

// Register makes the fake take requests under credentials, for the merchant
// they name.
func (a *API) Register(credentials paymentprovider.Credentials) {
	a.mu.Lock()
	defer a.mu.Unlock()
	key := credentialsKey(credentials)
	a.secrets[key] = credentials[paypay.FieldAPISecret]
	a.merchants[key] = credentials[paypay.FieldMerchantID]
}

// RefuseDuplicateCodes makes the fake answer a code requested again under a
// merchantPaymentId it has made one for as a duplicate, rather than with the
// code it made.
func (a *API) RefuseDuplicateCodes() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.refuseDuplicates = true
}

func accountKey(environment, apiKey string) string {
	return environment + "/" + apiKey
}

func credentialsKey(credentials paymentprovider.Credentials) string {
	return accountKey(credentials[paypay.FieldEnvironment], credentials[paypay.FieldAPIKey])
}

// account answers the account key names, making an empty one when there is
// none. It needs a.mu held.
func (a *API) account(key string) *account {
	acct, ok := a.accounts[key]
	if !ok {
		acct = &account{payments: map[string]*payment{}, idempotent: map[string]*refund{}}
		a.accounts[key] = acct
	}
	return acct
}

func (a *API) nextID(prefix string) string {
	a.ids++
	return fmt.Sprintf("%s%019d", prefix, a.ids)
}

func (a *API) mux(environment string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v2/codes", a.authenticated(environment, a.createCode))
	mux.HandleFunc("GET /v2/codes/payments/{id}", a.authenticated(environment, a.getPayment))
	mux.HandleFunc("POST /v2/refunds", a.authenticated(environment, a.createRefund))
	return mux
}

// authenticated checks a request's Authorization header against the secret of
// the key it names, and its merchant against the one the key acts for, as
// PayPay asks every request to name one, and hands next the key of the account it reaches and the
// body it carried.
func (a *API) authenticated(environment string, next func(http.ResponseWriter, *http.Request, string, []byte)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "DYNAMIC_QR_BAD_REQUEST", err.Error())
			return
		}
		fields, ok := strings.CutPrefix(r.Header.Get("Authorization"), "hmac OPA-Auth:")
		parts := strings.Split(fields, ":")
		if !ok || len(parts) != 5 {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "No valid api key and secret provided")
			return
		}
		apiKey, nonce, timestamp := parts[0], parts[2], parts[3]
		epoch, err := strconv.ParseInt(timestamp, 10, 64)
		key := accountKey(environment, apiKey)
		a.mu.Lock()
		secret, known := a.secrets[key]
		merchant := a.merchants[key]
		a.mu.Unlock()
		if known && r.Header.Get(paypay.MerchantHeader) != merchant {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "The merchant is not one the api key acts for")
			return
		}
		if err != nil || !known || time.Since(time.Unix(epoch, 0)).Abs() > clockSkew ||
			paypay.Authorization(apiKey, secret, r.Method, r.URL.EscapedPath(), nonce, epoch, r.Header.Get("Content-Type"), body) != r.Header.Get("Authorization") {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "No valid api key and secret provided")
			return
		}
		next(w, r, key, body)
	}
}

func (a *API) createCode(w http.ResponseWriter, _ *http.Request, key string, raw []byte) {
	var body struct {
		MerchantPaymentID string `json:"merchantPaymentId"`
		Amount            struct {
			Amount   int64  `json:"amount"`
			Currency string `json:"currency"`
		} `json:"amount"`
		CodeType     string `json:"codeType"`
		Description  string `json:"orderDescription"`
		RedirectURL  string `json:"redirectUrl"`
		RedirectType string `json:"redirectType"`
		RequestedAt  int64  `json:"requestedAt"`
	}
	var fields map[string]any
	if json.Unmarshal(raw, &body) != nil || json.Unmarshal(raw, &fields) != nil {
		writeError(w, http.StatusBadRequest, "DYNAMIC_QR_BAD_REQUEST", "the body is not JSON")
		return
	}
	switch {
	case !merchantIDPattern.MatchString(body.MerchantPaymentID), body.CodeType != "ORDER_QR", body.Amount.Amount <= 0, len([]rune(body.Description)) > 255:
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "Invalid parameters")
		return
	case body.Amount.Currency != "JPY":
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST_PARAMS", "unsupported currency")
		return
	}
	a.mu.Lock()
	a.codes = append(a.codes, CodeRequest{APIKey: key[strings.Index(key, "/")+1:], Body: fields})
	acct := a.account(key)
	held, ok := acct.payments[body.MerchantPaymentID]
	if ok && held.code != nil {
		code, refuse := held.code, a.refuseDuplicates
		a.mu.Unlock()
		if refuse {
			writeError(w, http.StatusBadRequest, "DUPLICATE_DYNAMIC_QR_REQUEST", "Duplicate Dynamic QR request error")
			return
		}
		writeJSON(w, http.StatusCreated, code)
		return
	}
	if ok {
		a.mu.Unlock()
		writeError(w, http.StatusBadRequest, "DUPLICATE_DYNAMIC_QR_REQUEST", "Duplicate Dynamic QR request error")
		return
	}
	codeID := a.nextID("04-")
	expiry := time.Now().Add(CodeValidity).Truncate(time.Second)
	code := map[string]any{
		"codeId":            codeID,
		"url":               "https://qr-stg.sandbox.paypay.ne.jp/" + codeID,
		"deeplink":          "paypay://payment?link_key=" + codeID,
		"expiryDate":        expiry.Unix(),
		"merchantPaymentId": body.MerchantPaymentID,
		"amount":            map[string]any{"amount": body.Amount.Amount, "currency": body.Amount.Currency},
		"orderDescription":  body.Description,
		"codeType":          body.CodeType,
		"requestedAt":       body.RequestedAt,
		"redirectUrl":       body.RedirectURL,
		"redirectType":      body.RedirectType,
		"isAuthorization":   false,
	}
	acct.payments[body.MerchantPaymentID] = &payment{
		merchantPaymentID: body.MerchantPaymentID,
		amount:            body.Amount.Amount,
		currency:          body.Amount.Currency,
		status:            "CREATED",
		expiry:            expiry,
		code:              code,
	}
	a.mu.Unlock()
	writeJSON(w, http.StatusCreated, code)
}

// getPayment answers a payment's details. A code that expired unpaid is one
// the API no longer holds a payment of, as PayPay answers it.
func (a *API) getPayment(w http.ResponseWriter, r *http.Request, key string, _ []byte) {
	a.mu.Lock()
	held := a.account(key).payments[r.PathValue("id")]
	var details map[string]any
	if held != nil && (held.status != "CREATED" || time.Now().Before(held.expiry)) {
		details = held.details()
	}
	a.mu.Unlock()
	if details == nil {
		writeError(w, http.StatusBadRequest, "DYNAMIC_QR_PAYMENT_NOT_FOUND", "The specified transaction is not found.")
		return
	}
	writeJSON(w, http.StatusOK, details)
}

// details answers the payment as the API reads it. It needs the API's lock
// held.
func (p *payment) details() map[string]any {
	refunds := make([]map[string]any, 0, len(p.refunds))
	for _, r := range p.refunds {
		refunds = append(refunds, r.details(p))
	}
	details := map[string]any{
		"paymentId":         p.paymentID,
		"status":            p.status,
		"acceptedAt":        0,
		"refunds":           map[string]any{"data": refunds},
		"merchantPaymentId": p.merchantPaymentID,
		"amount":            map[string]any{"amount": p.amount, "currency": p.currency},
		"requestedAt":       0,
		"orderDescription":  "",
	}
	if !p.acceptedAt.IsZero() {
		details["acceptedAt"] = p.acceptedAt.Unix()
	}
	if !p.expiry.IsZero() {
		details["expiresAt"] = p.expiry.Unix()
	}
	return details
}

func (r *refund) details(p *payment) map[string]any {
	return map[string]any{
		"status":           r.status,
		"acceptedAt":       r.acceptedAt.Unix(),
		"merchantRefundId": r.merchantRefundID,
		"paymentId":        p.paymentID,
		"amount":           map[string]any{"amount": r.amount, "currency": p.currency},
		"requestedAt":      r.requestedAt,
		"reason":           "",
	}
}

func (p *payment) refunded() int64 {
	var total int64
	for _, r := range p.refunds {
		if r.status == "REFUNDED" {
			total += r.amount
		}
	}
	return total
}

// createRefund refunds part or all of a payment, once per merchantRefundId
// until the fake forgets them.
func (a *API) createRefund(w http.ResponseWriter, _ *http.Request, key string, raw []byte) {
	var body struct {
		MerchantRefundID string `json:"merchantRefundId"`
		PaymentID        string `json:"paymentId"`
		Amount           struct {
			Amount   int64  `json:"amount"`
			Currency string `json:"currency"`
		} `json:"amount"`
		RequestedAt int64 `json:"requestedAt"`
	}
	if err := json.Unmarshal(raw, &body); err != nil || !merchantIDPattern.MatchString(body.MerchantRefundID) || body.Amount.Amount <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "Invalid parameters")
		return
	}
	a.mu.Lock()
	acct := a.account(key)
	var held *payment
	for _, p := range acct.payments {
		if p.paymentID != "" && p.paymentID == body.PaymentID {
			held = p
		}
	}
	if held == nil {
		a.mu.Unlock()
		writeError(w, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Order not found")
		return
	}
	made, replayed := acct.idempotent[body.MerchantRefundID]
	if !replayed {
		var committed int64
		for _, r := range held.refunds {
			if r.status != "REFUND_FAILED" {
				committed += r.amount
			}
		}
		if committed+body.Amount.Amount > held.amount {
			a.mu.Unlock()
			writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "The refund amount exceeds what is left to refund.")
			return
		}
		made = &refund{merchantRefundID: body.MerchantRefundID, amount: body.Amount.Amount, status: "REFUNDED", acceptedAt: time.Now(), requestedAt: body.RequestedAt}
		switch {
		case held.failNext:
			held.failNext = false
			made.status = "REFUND_FAILED"
		case held.holdNext:
			held.holdNext = false
			made.status = "CREATED"
		}
		held.refunds = append(held.refunds, made)
		acct.idempotent[body.MerchantRefundID] = made
		held.settle()
	}
	details := made.details(held)
	a.mu.Unlock()
	writeJSON(w, http.StatusOK, details)
}

// settle makes a paid payment REFUNDED once any of its refunds went through,
// as PayPay reports it.
func (p *payment) settle() {
	if p.status != "COMPLETED" && p.status != "REFUNDED" {
		return
	}
	p.status = "COMPLETED"
	if p.refunded() > 0 {
		p.status = "REFUNDED"
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"resultInfo": map[string]any{"code": "SUCCESS", "message": "Success", "codeId": "08100001"},
		"data":       data,
	})
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"resultInfo": map[string]any{"code": code, "message": message, "codeId": "08100999"},
		"data":       nil,
	})
}

// Codes answers every request to create a code the fake received.
func (a *API) Codes() []CodeRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]CodeRequest(nil), a.codes...)
}

// Pay makes the account credentials name hold the code merchantPaymentID as
// paid amount yen at at, making the payment when no code was made for it.
func (a *API) Pay(credentials paymentprovider.Credentials, merchantPaymentID string, amount int64, currency string, at time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	acct := a.account(credentialsKey(credentials))
	held, ok := acct.payments[merchantPaymentID]
	if !ok {
		held = &payment{merchantPaymentID: merchantPaymentID}
		acct.payments[merchantPaymentID] = held
	}
	if held.paymentID == "" {
		held.paymentID = a.nextID("")
	}
	if at.IsZero() {
		at = time.Now()
	}
	held.amount, held.currency, held.acceptedAt, held.status = amount, currency, at.Truncate(time.Second), "COMPLETED"
	held.settle()
}

// Expire makes the code merchantPaymentID of the account credentials name one
// whose time to be paid has run out.
func (a *API) Expire(credentials paymentprovider.Credentials, merchantPaymentID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if held := a.account(credentialsKey(credentials)).payments[merchantPaymentID]; held != nil {
		held.expiry = time.Now().Add(-time.Second).Truncate(time.Second)
		if held.code != nil {
			held.code["expiryDate"] = held.expiry.Unix()
		}
	}
}

// SetStatus makes the payment merchantPaymentID of the account credentials
// name one in status.
func (a *API) SetStatus(credentials paymentprovider.Credentials, merchantPaymentID, status string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if held := a.account(credentialsKey(credentials)).payments[merchantPaymentID]; held != nil {
		held.status = status
	}
}

// AddRefund makes a refund of amount yen, under merchantRefundID, on the paid
// payment merchantPaymentID of the account credentials name, as one made in
// PayPay's own tools is. A payment it does not hold yet is held as one paid
// amount yen.
func (a *API) AddRefund(credentials paymentprovider.Credentials, merchantPaymentID, merchantRefundID string, amount int64, currency string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	acct := a.account(credentialsKey(credentials))
	held, ok := acct.payments[merchantPaymentID]
	if !ok {
		held = &payment{merchantPaymentID: merchantPaymentID, paymentID: a.nextID(""), amount: amount, currency: currency, status: "COMPLETED", acceptedAt: time.Now().Truncate(time.Second)}
		acct.payments[merchantPaymentID] = held
	}
	held.amount = max(held.amount, held.refunded()+amount)
	held.refunds = append(held.refunds, &refund{merchantRefundID: merchantRefundID, amount: amount, status: "REFUNDED", acceptedAt: time.Now()})
	held.settle()
}

// FailRefunds fails the refund of the payment merchantPaymentID made under
// merchantRefundID, when it is not empty, and then its latest refunds until
// no more than stays refunded.
func (a *API) FailRefunds(credentials paymentprovider.Credentials, merchantPaymentID, merchantRefundID string, stays int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	held := a.account(credentialsKey(credentials)).payments[merchantPaymentID]
	if held == nil {
		return
	}
	for _, r := range held.refunds {
		if merchantRefundID != "" && r.merchantRefundID == merchantRefundID {
			r.status = "REFUND_FAILED"
		}
	}
	for i := len(held.refunds) - 1; i >= 0 && held.refunded() > stays; i-- {
		if r := held.refunds[i]; r.status == "REFUNDED" {
			r.status = "REFUND_FAILED"
		}
	}
	held.settle()
}

// RefundedTotal answers the yen refunded on the payment merchantPaymentID of
// the account credentials name.
func (a *API) RefundedTotal(credentials paymentprovider.Credentials, merchantPaymentID string) int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	if held := a.account(credentialsKey(credentials)).payments[merchantPaymentID]; held != nil {
		return held.refunded()
	}
	return 0
}

// FailNextRefund makes the next refund of the payment merchantPaymentID one
// PayPay answers as failed.
func (a *API) FailNextRefund(credentials paymentprovider.Credentials, merchantPaymentID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if held := a.account(credentialsKey(credentials)).payments[merchantPaymentID]; held != nil {
		held.failNext = true
	}
}

// HoldNextRefund makes the next refund of the payment merchantPaymentID one
// PayPay has accepted and not made yet, until SettleRefunds.
func (a *API) HoldNextRefund(credentials paymentprovider.Credentials, merchantPaymentID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if held := a.account(credentialsKey(credentials)).payments[merchantPaymentID]; held != nil {
		held.holdNext = true
	}
}

// SettleRefunds makes every refund of the payment merchantPaymentID that
// PayPay has not made yet, failing them when fail is set.
func (a *API) SettleRefunds(credentials paymentprovider.Credentials, merchantPaymentID string, fail bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	held := a.account(credentialsKey(credentials)).payments[merchantPaymentID]
	if held == nil {
		return
	}
	for _, r := range held.refunds {
		if r.status == "CREATED" {
			r.status = "REFUNDED"
			if fail {
				r.status = "REFUND_FAILED"
			}
		}
	}
	held.settle()
}

// ForgetIdempotencyKeys makes the fake forget the refund each
// merchantRefundId of the account credentials name made, so that the same id
// sent again makes another.
func (a *API) ForgetIdempotencyKeys(credentials paymentprovider.Credentials) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.account(credentialsKey(credentials)).idempotent = map[string]*refund{}
}

// Notification answers the notification under testdata/name with fields
// replaced, and the headers PayPay delivers it with.
func Notification(t testing.TB, name string, fields map[string]any) ([]byte, http.Header) {
	t.Helper()
	raw, err := notifications.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var notification map[string]any
	if err := json.Unmarshal(raw, &notification); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	maps.Copy(notification, fields)
	var payload bytes.Buffer
	if err := json.NewEncoder(&payload).Encode(notification); err != nil {
		t.Fatalf("encode %s: %v", name, err)
	}
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	return payload.Bytes(), headers
}

// Fixture is PayPay's contract fixture, over a fake of its API.
type Fixture struct {
	API *API
}

var (
	_ paymentprovidertest.Fixture                 = (*Fixture)(nil)
	_ paymentprovidertest.TestCredentialsFixture  = (*Fixture)(nil)
	_ paymentprovidertest.ExpiringCheckoutFixture = (*Fixture)(nil)
)

// NewFixture answers a fixture whose fake API serves until t ends.
func NewFixture(t testing.TB) *Fixture {
	f := &Fixture{API: NewAPI(t)}
	for _, credentials := range []paymentprovider.Credentials{f.Credentials(), f.OtherCredentials(), f.TestCredentials()} {
		f.API.Register(credentials)
	}
	return f
}

func (f *Fixture) Provider() paymentprovider.Provider {
	return f.API.Provider()
}

func (*Fixture) Credentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		paypay.FieldAPIKey:     "a_ContractFixtureAAAA",
		paypay.FieldAPISecret:  "ContractFixtureSecretAAAA",
		paypay.FieldMerchantID: "000000000000000001",
	}
}

func (*Fixture) OtherCredentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		paypay.FieldAPIKey:     "a_ContractFixtureBBBB",
		paypay.FieldAPISecret:  "ContractFixtureSecretBBBB",
		paypay.FieldMerchantID: "000000000000000002",
	}
}

func (*Fixture) TestCredentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		paypay.FieldAPIKey:      "a_ContractFixtureSandbox",
		paypay.FieldAPISecret:   "ContractFixtureSecretSandbox",
		paypay.FieldMerchantID:  "000000000000000003",
		paypay.FieldEnvironment: paypay.EnvironmentSandbox,
	}
}

// checkMode fails t when the suite hands the fixture a checkout in the other
// mode than the credentials name, which no tenant's PayPay payment could be.
func checkMode(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) {
	t.Helper()
	if sandbox := credentials[paypay.FieldEnvironment] == paypay.EnvironmentSandbox; checkout.Test != sandbox {
		t.Fatalf("paypaytest: a checkout in test mode %v under credentials of the sandbox %v", checkout.Test, sandbox)
	}
}

func (f *Fixture) CheckoutCompleted(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) ([]byte, http.Header) {
	t.Helper()
	checkMode(t, credentials, checkout)
	f.API.Pay(credentials, checkout.CheckoutID, int64(checkout.Purchase.Price), checkout.Purchase.Currency, time.Time{})
	return Notification(t, "transaction.completed.json", map[string]any{
		"merchant_order_id": checkout.CheckoutID,
		"order_amount":      strconv.Itoa(int(checkout.Purchase.Price)),
	})
}

func (f *Fixture) PaymentTaken(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout, at time.Time) {
	t.Helper()
	checkMode(t, credentials, checkout)
	f.API.Pay(credentials, checkout.CheckoutID, int64(checkout.Purchase.Price), checkout.Purchase.Currency, at)
}

// CheckoutRanOut makes the code of the checkout one whose time to be paid has
// run out, which PayPay sends no notification of.
func (f *Fixture) CheckoutRanOut(_ testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) {
	f.API.Expire(credentials, checkout.CheckoutID)
}

// Refunded refunds as much more of the payment as brings its total to
// refund.AmountRefunded, as a refund made in PayPay's own tools does, and
// answers the provider's own notification of the payment's refunds, since
// PayPay sends none.
func (f *Fixture) Refunded(t testing.TB, credentials paymentprovider.Credentials, refund paymentprovidertest.Refund) ([]byte, http.Header) {
	t.Helper()
	more := refund.AmountRefunded - f.API.RefundedTotal(credentials, refund.PaymentID)
	if more <= 0 {
		t.Fatalf("refund to %d on %s refunds nothing new", refund.AmountRefunded, refund.PaymentID)
	}
	f.API.mu.Lock()
	id := f.API.nextID("dashboard-")
	f.API.mu.Unlock()
	f.API.AddRefund(credentials, refund.PaymentID, id, more, refund.Currency)
	return f.API.Provider().RefundNotification(refund.PaymentID), http.Header{}
}

func (f *Fixture) RefundedTotal(_ testing.TB, credentials paymentprovider.Credentials, paymentID string) int64 {
	return f.API.RefundedTotal(credentials, paymentID)
}

func (f *Fixture) FailNextRefund(_ testing.TB, credentials paymentprovider.Credentials, paymentID string) {
	f.API.FailNextRefund(credentials, paymentID)
}

func (f *Fixture) ForgetIdempotencyKeys(_ testing.TB, credentials paymentprovider.Credentials) {
	f.API.ForgetIdempotencyKeys(credentials)
}

// RefundFailed fails the refund of an amount made under failed.Key, or else
// the latest refunds of the payment until no more than failed.AmountRefunded
// stays refunded, and answers the provider's own notification of the
// payment's refunds.
func (f *Fixture) RefundFailed(t testing.TB, credentials paymentprovider.Credentials, failed paymentprovidertest.Refund) ([]byte, http.Header) {
	t.Helper()
	merchantRefundID := ""
	if failed.Key != "" {
		merchantRefundID = paypay.MerchantRefundID(paymentprovider.RefundRequest{IdempotencyKey: failed.Key, Amount: 1})
	}
	f.API.FailRefunds(credentials, failed.PaymentID, merchantRefundID, failed.AmountRefunded)
	if got := f.API.RefundedTotal(credentials, failed.PaymentID); got != failed.AmountRefunded {
		t.Fatalf("failing the refunds of %s leaves %d refunded, want %d", failed.PaymentID, got, failed.AmountRefunded)
	}
	return f.API.Provider().RefundNotification(failed.PaymentID), http.Header{}
}

func (*Fixture) Unrelated(t testing.TB, _ paymentprovider.Credentials) ([]byte, http.Header) {
	t.Helper()
	return Notification(t, "file.created.json", nil)
}
