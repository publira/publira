// Package paidytest delivers Paidy notifications for tests and fakes the
// endpoints of Paidy's API the provider calls: the contract fixture over the
// notifications under testdata, which follow the fields Paidy documents for
// each, [API] for a test that drives the fake directly, and [Notification]
// for a test that needs a notification of its own shape.
//
// The fake keeps the payments of each secret key apart, as each Paidy account
// keeps its own, answers a request that names no version of the API or no
// key as Paidy does, and holds a payment as Paidy Checkout leaves it:
// authorized, until it is captured.
package paidytest

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paidy"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
)

//go:embed testdata/*.json
var notifications embed.FS

// AuthorizationLifetime is how long after Paidy Checkout authorized it the
// fake's payment can be captured.
const AuthorizationLifetime = 30 * 24 * time.Hour

// The statuses the fake answers a payment with, in the lower case Paidy's
// examples write them in.
const (
	StatusAuthorized = "authorized"
	StatusClosed     = "closed"
	StatusRejected   = "rejected"
)

// API is a fake of the Paidy API endpoints the provider calls.
type API struct {
	server *httptest.Server

	mu       sync.Mutex
	accounts map[string]map[string]*Payment
	ids      int
}

// Payment is a payment the fake holds.
type Payment struct {
	ID       string
	OrderRef string
	Amount   int64
	Currency string
	Test     bool
	Status   string
	Created  time.Time
	Captures []Capture
	Refunds  []Refund
}

// Capture is a capture of a [Payment].
type Capture struct {
	ID      string
	Amount  int64
	Created time.Time
}

// Refund is a refund of a [Payment]'s capture.
type Refund struct {
	ID        string
	CaptureID string
	Amount    int64
	Metadata  map[string]any
	Created   time.Time
}

// NewAPI answers a fake that serves until t ends.
func NewAPI(t testing.TB) *API {
	t.Helper()
	api := &API{accounts: map[string]map[string]*Payment{}}
	api.server = httptest.NewServer(api.mux())
	t.Cleanup(api.server.Close)
	return api
}

// Provider answers the provider pointed at the fake.
func (a *API) Provider(options ...paidy.Option) *paidy.Provider {
	return paidy.New(append([]paidy.Option{paidy.WithAPIURL(a.server.URL)}, options...)...)
}

// URL answers the fake's origin.
func (a *API) URL() string {
	return a.server.URL
}

// account answers the payments of the account secretKey reaches, making it
// when there is none. It needs a.mu held.
func (a *API) account(secretKey string) map[string]*Payment {
	payments, ok := a.accounts[secretKey]
	if !ok {
		payments = map[string]*Payment{}
		a.accounts[secretKey] = payments
	}
	return payments
}

func (a *API) nextID(prefix string) string {
	a.ids++
	return fmt.Sprintf("%s%016d", prefix, a.ids)
}

// upsert answers the payment id of the account credentials reach, making an
// empty one when there is none. It needs a.mu held.
func (a *API) upsert(credentials paymentprovider.Credentials, id string) *Payment {
	payments := a.account(credentials[paidy.FieldSecretKey])
	held, ok := payments[id]
	if !ok {
		held = &Payment{ID: id, Currency: "JPY", Created: time.Now()}
		payments[id] = held
	}
	return held
}

// Authorize makes the account credentials reach hold the payment id as Paidy
// Checkout leaves one it authorized for the order orderRef, keeping any
// refund the fake was told of before.
func (a *API) Authorize(credentials paymentprovider.Credentials, id, orderRef string, amount int64, currency string, test bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	held := a.upsert(credentials, id)
	held.OrderRef, held.Amount, held.Currency, held.Test = orderRef, amount, currency, test
	held.Status, held.Captures, held.Created = StatusAuthorized, nil, time.Now()
}

// Take makes the account credentials reach hold the payment id as one Paidy
// Checkout authorized and the merchant captured at at.
func (a *API) Take(credentials paymentprovider.Credentials, id, orderRef string, amount int64, currency string, test bool, at time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	held := a.upsert(credentials, id)
	held.OrderRef, held.Amount, held.Currency, held.Test, held.Created = orderRef, amount, currency, test, at
	held.Status = StatusClosed
	held.Captures = []Capture{{ID: a.nextID("cap_"), Amount: amount, Created: at}}
}

// Reject makes the account credentials reach hold the payment id as one Paidy
// rejected for the order orderRef.
func (a *API) Reject(credentials paymentprovider.Credentials, id, orderRef string, amount int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	held := a.upsert(credentials, id)
	held.OrderRef, held.Amount, held.Status = orderRef, amount, StatusRejected
}

// SetStatus makes the payment id one the API answers with status, written
// as Paidy writes it in one place or another.
func (a *API) SetStatus(credentials paymentprovider.Credentials, id, status string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.upsert(credentials, id).Status = status
}

// Expire makes the payment id one Paidy Checkout authorized longer ago than
// it can be captured.
func (a *API) Expire(credentials paymentprovider.Credentials, id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	held := a.upsert(credentials, id)
	held.Created = time.Now().Add(-AuthorizationLifetime - time.Hour)
}

// AddRefund refunds amount more of the payment id, as a refund made in
// Paidy's merchant dashboard does, and answers the id of its capture.
func (a *API) AddRefund(credentials paymentprovider.Credentials, id string, amount int64, currency string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	held := a.upsert(credentials, id)
	// A refund the suite delivers before the payment it refunds is the only
	// thing the fake holds of that payment until then.
	if held.Status == "" {
		held.Currency, held.Status = currency, StatusClosed
	}
	captureID := ""
	if len(held.Captures) > 0 {
		captureID = held.Captures[0].ID
	}
	held.Refunds = append(held.Refunds, Refund{ID: a.nextID("ref_"), CaptureID: captureID, Amount: amount, Created: time.Now()})
	return captureID
}

// Payment answers a copy of the payment id the account credentials reach
// holds, and false for one it does not.
func (a *API) Payment(credentials paymentprovider.Credentials, id string) (Payment, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	held, ok := a.account(credentials[paidy.FieldSecretKey])[id]
	if !ok {
		return Payment{}, false
	}
	copied := *held
	copied.Captures = append([]Capture(nil), held.Captures...)
	copied.Refunds = append([]Refund(nil), held.Refunds...)
	return copied, true
}

// RefundedTotal answers the total refunded on the payment id.
func (a *API) RefundedTotal(credentials paymentprovider.Credentials, id string) int64 {
	held, _ := a.Payment(credentials, id)
	var total int64
	for _, r := range held.Refunds {
		total += r.Amount
	}
	return total
}

func (a *API) mux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /payments/{id}", a.authenticated(a.getPayment))
	mux.HandleFunc("POST /payments/{id}/captures", a.authenticated(a.capture))
	mux.HandleFunc("POST /payments/{id}/refunds", a.authenticated(a.refund))
	return mux
}

// authenticated answers a request without the version of the API the
// provider is written against, or without a secret key, as Paidy does, and
// hands next the payments of the account the key reaches with a.mu held.
func (a *API) authenticated(next func(http.ResponseWriter, *http.Request, map[string]*Payment)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Paidy-Version") != paidy.APIVersion {
			writeError(w, http.StatusBadRequest, "version.unknown", "Unknown API version")
			return
		}
		secretKey, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || !strings.HasPrefix(secretKey, "sk_") {
			writeError(w, http.StatusUnauthorized, "authentication.failed", "Authentication failed")
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		next(w, r, a.account(secretKey))
	}
}

func (a *API) getPayment(w http.ResponseWriter, r *http.Request, payments map[string]*Payment) {
	held, ok := payments[r.PathValue("id")]
	if !ok || held.Status == "" {
		writeError(w, http.StatusNotFound, "404", "Not found")
		return
	}
	writeJSON(w, http.StatusOK, held.answer())
}

func (a *API) capture(w http.ResponseWriter, r *http.Request, payments map[string]*Payment) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "request_content.malformed", "Malformed request content")
		return
	}
	held, ok := payments[r.PathValue("id")]
	switch {
	case !ok || held.Status == "":
		writeError(w, http.StatusNotFound, "404", "Not found")
		return
	case !strings.EqualFold(held.Status, StatusAuthorized):
		writeError(w, http.StatusForbidden, "service.forbidden", "The payment cannot be captured")
		return
	case time.Since(held.Created) > AuthorizationLifetime:
		writeError(w, http.StatusBadRequest, "payment.authorization.expired", "The authorization has expired")
		return
	}
	held.Status = StatusClosed
	held.Captures = []Capture{{ID: a.nextID("cap_"), Amount: held.Amount, Created: time.Now()}}
	writeJSON(w, http.StatusOK, held.answer())
}

func (a *API) refund(w http.ResponseWriter, r *http.Request, payments map[string]*Payment) {
	var body struct {
		CaptureID string         `json:"capture_id"`
		Amount    *float64       `json:"amount"`
		Reason    string         `json:"reason"`
		Metadata  map[string]any `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.CaptureID == "" || len(body.Metadata) > 20 {
		writeError(w, http.StatusBadRequest, "request_content.malformed", "Malformed request content")
		return
	}
	held, ok := payments[r.PathValue("id")]
	if !ok || held.Status == "" {
		writeError(w, http.StatusNotFound, "404", "Not found")
		return
	}
	if !strings.EqualFold(held.Status, StatusClosed) || len(held.Captures) == 0 || held.Captures[0].ID != body.CaptureID {
		writeError(w, http.StatusBadRequest, "payment.refund.captureId", "Invalid capture ID")
		return
	}
	remaining := held.Captures[0].Amount
	for _, made := range held.Refunds {
		remaining -= made.Amount
	}
	amount := remaining
	if body.Amount != nil {
		amount = int64(*body.Amount)
	}
	switch {
	case remaining <= 0:
		writeError(w, http.StatusForbidden, "service.forbidden", "The payment is refunded in full")
		return
	case amount <= 0 || amount > remaining:
		writeError(w, http.StatusBadRequest, "payment.refund.amount", "Invalid refund amount")
		return
	}
	held.Refunds = append(held.Refunds, Refund{ID: a.nextID("ref_"), CaptureID: body.CaptureID, Amount: amount, Metadata: body.Metadata, Created: time.Now()})
	writeJSON(w, http.StatusOK, held.answer())
}

// answer is the payment as Paidy's API answers it.
func (p *Payment) answer() map[string]any {
	captures := make([]map[string]any, 0, len(p.Captures))
	for _, c := range p.Captures {
		captures = append(captures, map[string]any{
			"id": c.ID, "created_at": c.Created.UTC().Format(time.RFC3339Nano), "amount": c.Amount,
			"tax": 0, "shipping": 0, "items": []any{}, "metadata": map[string]any{},
		})
	}
	refunds := make([]map[string]any, 0, len(p.Refunds))
	for _, r := range p.Refunds {
		metadata := r.Metadata
		if metadata == nil {
			metadata = map[string]any{}
		}
		refunds = append(refunds, map[string]any{
			"id": r.ID, "created_at": r.Created.UTC().Format(time.RFC3339Nano), "capture_id": r.CaptureID,
			"amount": r.Amount, "reason": "", "metadata": metadata,
		})
	}
	return map[string]any{
		"id":         p.ID,
		"created_at": p.Created.UTC().Format(time.RFC3339Nano),
		"expires_at": p.Created.Add(AuthorizationLifetime).UTC().Format(time.RFC3339Nano),
		"amount":     p.Amount,
		"currency":   p.Currency,
		"test":       p.Test,
		"status":     p.Status,
		"tier":       "classic",
		"order": map[string]any{
			"items": []any{}, "tax": 0, "shipping": 0, "order_ref": p.OrderRef, "updated_at": nil,
		},
		"captures": captures,
		"refunds":  refunds,
		"metadata": map[string]any{},
	}
}

func writeError(w http.ResponseWriter, status int, code, title string) {
	writeJSON(w, status, map[string]any{
		"reference":   "paidytest",
		"status":      fmt.Sprint(status),
		"code":        code,
		"title":       title,
		"description": title,
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// Notification answers the notification under testdata/name with fields
// replaced, and the headers Paidy delivers it with.
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

// Fixture is Paidy's contract fixture, over a fake of its API.
type Fixture struct {
	API *API
}

var _ paymentprovidertest.BrowserCheckoutFixture = (*Fixture)(nil)

// NewFixture answers a fixture whose fake API serves until t ends.
func NewFixture(t testing.TB) *Fixture {
	return &Fixture{API: NewAPI(t)}
}

func (f *Fixture) Provider() paymentprovider.Provider {
	return f.API.Provider()
}

func (*Fixture) Credentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		paidy.FieldPublicKey: "pk_test_contractfixtureaaaa",
		paidy.FieldSecretKey: "sk_test_contractfixtureaaaa",
	}
}

func (*Fixture) OtherCredentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		paidy.FieldPublicKey: "pk_test_contractfixturebbbb",
		paidy.FieldSecretKey: "sk_test_contractfixturebbbb",
	}
}

// CheckoutCompleted makes the payment one Paidy Checkout authorized for the
// checkout and nobody captured, and answers Paidy's notification of the
// authorization.
func (f *Fixture) CheckoutCompleted(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) ([]byte, http.Header) {
	t.Helper()
	f.API.Authorize(credentials, checkout.PaymentID, checkout.CheckoutID, int64(checkout.Purchase.Price), checkout.Purchase.Currency, checkout.Test)
	return Notification(t, "authorize_success.json", map[string]any{
		"payment_id": checkout.PaymentID,
		"order_ref":  checkout.CheckoutID,
	})
}

// PaymentTaken makes the payment one Paidy Checkout authorized for the
// checkout and the merchant captured at at.
func (f *Fixture) PaymentTaken(_ testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout, at time.Time) {
	f.API.Take(credentials, checkout.PaymentID, checkout.CheckoutID, int64(checkout.Purchase.Price), checkout.Purchase.Currency, checkout.Test, at)
}

// Refunded refunds as much more of the payment as brings its total to
// refund.AmountRefunded, as a refund made in Paidy's merchant dashboard
// does, and answers Paidy's notification of it.
func (f *Fixture) Refunded(t testing.TB, credentials paymentprovider.Credentials, refund paymentprovidertest.Refund) ([]byte, http.Header) {
	t.Helper()
	more := refund.AmountRefunded - f.API.RefundedTotal(credentials, refund.PaymentID)
	if more <= 0 {
		t.Fatalf("refund to %d on %s refunds nothing new", refund.AmountRefunded, refund.PaymentID)
	}
	captureID := f.API.AddRefund(credentials, refund.PaymentID, more, refund.Currency)
	return Notification(t, "refund_success.json", map[string]any{
		"payment_id": refund.PaymentID,
		"capture_id": captureID,
	})
}

func (f *Fixture) RefundedTotal(_ testing.TB, credentials paymentprovider.Credentials, paymentID string) int64 {
	return f.API.RefundedTotal(credentials, paymentID)
}

// ForgetIdempotencyKeys does nothing: Paidy takes no idempotency key, and the
// provider finds a refund again by the metadata it wrote the key into, which
// Paidy keeps as long as the refund.
func (*Fixture) ForgetIdempotencyKeys(testing.TB, paymentprovider.Credentials) {}

// Unrelated answers Paidy's notification that a payment's order reference or
// description was updated.
func (*Fixture) Unrelated(t testing.TB, _ paymentprovider.Credentials) ([]byte, http.Header) {
	t.Helper()
	return Notification(t, "update_success.json", nil)
}

func (f *Fixture) Captures(_ testing.TB, credentials paymentprovider.Credentials, paymentID string) int {
	held, _ := f.API.Payment(credentials, paymentID)
	return len(held.Captures)
}
