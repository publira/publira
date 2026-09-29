// Package payjptest delivers PAY.JP notifications for tests and fakes the
// endpoints of PAY.JP's API v2 the provider calls: the contract fixture over
// the events under testdata, [API] for a test that drives the fake directly,
// and [Event] for a test that needs a notification of its own shape.
package payjptest

import (
	"embed"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
)

//go:embed testdata/*.json
var events embed.FS

// timestamp is the instant every object the fake answers was made at.
const timestamp = "2026-01-02T03:04:05Z"

// API is a fake of the PAY.JP API endpoints the provider calls. Each secret
// key sees only the objects made under it, as each PAY.JP account does.
type API struct {
	server *httptest.Server

	mu       sync.Mutex
	flows    map[string]map[string]*paymentFlow
	sessions []CheckoutSession
	refunds  int
}

type paymentFlow struct {
	status         string
	amountReceived int
	refunds        []refund
}

type refund struct {
	id     string
	amount int
	status string
}

// CheckoutSession is one request the fake received to create a Checkout
// Session.
type CheckoutSession struct {
	SecretKey      string
	IdempotencyKey string
	Body           map[string]any
}

// NewAPI answers a fake that serves until t ends.
func NewAPI(t testing.TB) *API {
	t.Helper()
	api := &API{flows: map[string]map[string]*paymentFlow{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v2/checkout/sessions", api.createCheckoutSession)
	mux.HandleFunc("GET /v2/payment_flows/{id}", api.getPaymentFlow)
	mux.HandleFunc("GET /v2/payment_flows/{id}/refunds", api.listRefunds)
	api.server = httptest.NewServer(mux)
	t.Cleanup(api.server.Close)
	return api
}

// URL is the origin a provider is pointed at with [payjp.WithBaseURL].
func (a *API) URL() string {
	return a.server.URL
}

// SetPaymentFlow makes the payment flow id, under secretKey, one of status
// that has received amountReceived yen. Refunds already made on it stay.
func (a *API) SetPaymentFlow(secretKey, id, status string, amountReceived int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	flow := a.flow(secretKey, id)
	flow.status = status
	flow.amountReceived = amountReceived
}

// AddRefund makes a refund of amount yen, in status, on the payment flow id
// under secretKey, and answers its id.
func (a *API) AddRefund(secretKey, id string, amount int, status string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.refunds++
	refundID := fmt.Sprintf("re_fake%04d", a.refunds)
	flow := a.flow(secretKey, id)
	flow.refunds = append(flow.refunds, refund{id: refundID, amount: amount, status: status})
	return refundID
}

// RefundedTotal answers the yen refunded so far on the payment flow id under
// secretKey.
func (a *API) RefundedTotal(secretKey, id string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	total := 0
	for _, refund := range a.flow(secretKey, id).refunds {
		if refund.status == "succeeded" {
			total += refund.amount
		}
	}
	return total
}

// CheckoutSessions answers every Checkout Session creation the fake received.
func (a *API) CheckoutSessions() []CheckoutSession {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]CheckoutSession(nil), a.sessions...)
}

// flow answers the payment flow id under secretKey, making a new one that
// has succeeded without a payment when there is none. It needs a.mu held.
func (a *API) flow(secretKey, id string) *paymentFlow {
	flows, ok := a.flows[secretKey]
	if !ok {
		flows = map[string]*paymentFlow{}
		a.flows[secretKey] = flows
	}
	flow, ok := flows[id]
	if !ok {
		flow = &paymentFlow{status: "succeeded"}
		flows[id] = flow
	}
	return flow
}

func secretKey(r *http.Request) string {
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}

func (a *API) createCheckoutSession(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	a.mu.Lock()
	a.sessions = append(a.sessions, CheckoutSession{
		SecretKey:      secretKey(r),
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
		Body:           body,
	})
	id := fmt.Sprintf("cs_fake%04d", len(a.sessions))
	a.mu.Unlock()
	writeJSON(w, map[string]any{
		"object":      "checkout.session",
		"id":          id,
		"url":         "https://checkout.pay.jp/c/" + id,
		"mode":        body["mode"],
		"status":      "open",
		"ui_mode":     "hosted",
		"submit_type": "auto",
		"currency":    "jpy",
		"locale":      "auto",
		"livemode":    false,
		"metadata":    body["metadata"],
		"created_at":  timestamp,
		"updated_at":  timestamp,
	})
}

func (a *API) getPaymentFlow(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a.mu.Lock()
	flow, ok := a.flows[secretKey(r)][id]
	var status string
	var amountReceived int
	if ok {
		status, amountReceived = flow.status, flow.amountReceived
	}
	a.mu.Unlock()
	if !ok {
		writeError(w, http.StatusNotFound, "No such payment flow: "+id)
		return
	}
	writeJSON(w, map[string]any{
		"object":               "payment_flow",
		"id":                   id,
		"amount":               amountReceived,
		"amount_received":      amountReceived,
		"capture_method":       "automatic",
		"client_secret":        id + "_secret_fake",
		"currency":             "jpy",
		"livemode":             false,
		"metadata":             map[string]any{},
		"payment_method_types": []string{"card"},
		"status":               status,
		"created_at":           timestamp,
		"updated_at":           timestamp,
	})
}

func (a *API) listRefunds(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		limit = 10
	}
	startingAfter := r.URL.Query().Get("starting_after")
	a.mu.Lock()
	flow, ok := a.flows[secretKey(r)][id]
	var refunds []refund
	if ok {
		refunds = append(refunds, flow.refunds...)
	}
	a.mu.Unlock()
	if !ok {
		writeError(w, http.StatusNotFound, "No such payment flow: "+id)
		return
	}
	if startingAfter != "" {
		for i, refund := range refunds {
			if refund.id == startingAfter {
				refunds = refunds[i+1:]
				break
			}
		}
	}
	hasMore := len(refunds) > limit
	if hasMore {
		refunds = refunds[:limit]
	}
	data := make([]map[string]any, 0, len(refunds))
	for _, refund := range refunds {
		data = append(data, map[string]any{
			"object":          "refund",
			"id":              refund.id,
			"amount":          refund.amount,
			"payment_flow_id": id,
			"reason":          "requested_by_customer",
			"status":          refund.status,
			"livemode":        false,
			"metadata":        map[string]any{},
			"created_at":      timestamp,
			"updated_at":      timestamp,
		})
	}
	writeJSON(w, map[string]any{
		"object":   "list",
		"data":     data,
		"has_more": hasMore,
		"url":      "/v2/payment_flows/" + id + "/refunds",
	})
}

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":   "about:blank",
		"title":  http.StatusText(status),
		"status": status,
		"detail": detail,
	})
}

// PurchaseMetadata is the metadata a Checkout Session started for purchase
// carries.
func PurchaseMetadata(purchase paymentprovider.Purchase) map[string]any {
	metadata := map[string]any{
		payjp.MetadataTenantID:  purchase.TenantID.String(),
		payjp.MetadataUserID:    purchase.ReaderID.String(),
		payjp.MetadataEpisodeID: purchase.EpisodeID.String(),
		payjp.MetadataPrice:     strconv.FormatInt(int64(purchase.Price), 10),
	}
	if purchase.ReadingPeriodHours > 0 {
		metadata[payjp.MetadataReadingPeriodHours] = strconv.FormatInt(int64(purchase.ReadingPeriodHours), 10)
	}
	return metadata
}

// Event answers the notification under testdata/name with fields replaced on
// its object, and the headers PAY.JP would deliver it with for an account
// whose webhook token is webhookToken.
func Event(t testing.TB, webhookToken, name string, fields map[string]any) ([]byte, http.Header) {
	t.Helper()
	raw, err := events.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var event map[string]any
	if err := json.Unmarshal(raw, &event); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	object, _ := event["data"].(map[string]any)
	if object == nil {
		t.Fatalf("%s has no data", name)
	}
	maps.Copy(object, fields)
	payload, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("encode %s: %v", name, err)
	}
	headers := http.Header{}
	headers.Set(payjp.WebhookTokenHeader, webhookToken)
	return payload, headers
}

// Fixture is PAY.JP's contract fixture, over a fake of its API.
type Fixture struct {
	API *API
}

var _ paymentprovidertest.Fixture = (*Fixture)(nil)

// NewFixture answers a fixture whose fake API serves until t ends.
func NewFixture(t testing.TB) *Fixture {
	return &Fixture{API: NewAPI(t)}
}

func (f *Fixture) Provider() paymentprovider.Provider {
	return payjp.New(payjp.WithBaseURL(f.API.URL()))
}

func (*Fixture) Credentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		payjp.FieldSecretKey:    "sk_test_ContractFixtureAAAA",
		payjp.FieldWebhookToken: "whook_ContractFixtureAAAA",
	}
}

func (*Fixture) OtherCredentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		payjp.FieldSecretKey:    "sk_test_ContractFixtureBBBB",
		payjp.FieldWebhookToken: "whook_ContractFixtureBBBB",
	}
}

func (f *Fixture) CheckoutCompleted(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) ([]byte, http.Header) {
	t.Helper()
	f.API.SetPaymentFlow(credentials[payjp.FieldSecretKey], checkout.PaymentID, "succeeded", int(checkout.Purchase.Price))
	return Event(t, credentials[payjp.FieldWebhookToken], "checkout.session.completed.json", map[string]any{
		"id":              checkout.CheckoutID,
		"amount_subtotal": checkout.Purchase.Price,
		"amount_total":    checkout.Purchase.Price,
		"payment_flow_id": checkout.PaymentID,
		"metadata":        PurchaseMetadata(checkout.Purchase),
	})
}

func (f *Fixture) Refunded(t testing.TB, credentials paymentprovider.Credentials, refund paymentprovidertest.Refund) ([]byte, http.Header) {
	t.Helper()
	secretKey := credentials[payjp.FieldSecretKey]
	amount := int(refund.AmountRefunded) - f.API.RefundedTotal(secretKey, refund.PaymentID)
	if amount <= 0 {
		t.Fatalf("refund to %d on %s refunds nothing new", refund.AmountRefunded, refund.PaymentID)
	}
	refundID := f.API.AddRefund(secretKey, refund.PaymentID, amount, "succeeded")
	return Event(t, credentials[payjp.FieldWebhookToken], "refund.created.json", map[string]any{
		"id":              refundID,
		"amount":          amount,
		"payment_flow_id": refund.PaymentID,
	})
}

func (*Fixture) Unrelated(t testing.TB, credentials paymentprovider.Credentials) ([]byte, http.Header) {
	t.Helper()
	return Event(t, credentials[payjp.FieldWebhookToken], "customer.created.json", nil)
}
