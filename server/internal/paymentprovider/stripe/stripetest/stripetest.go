// Package stripetest signs Stripe webhook notifications for tests and fakes
// the endpoints of Stripe's API the provider calls: the contract fixture over
// the events under testdata, [API] for a test that drives the fake directly,
// and [SignedEvent] for a test that needs an event of its own shape.
package stripetest

import (
	"embed"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"maps"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	stripego "github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
)

//go:embed testdata/*.json
var events embed.FS

// SignedEvent answers an event of eventType carrying object, signed with
// webhookSecret now, and the headers Stripe would deliver it with.
func SignedEvent(t testing.TB, webhookSecret, eventType string, object map[string]any) ([]byte, http.Header) {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"id":          "evt_test",
		"object":      "event",
		"api_version": stripego.APIVersion,
		"type":        eventType,
		"data":        map[string]any{"object": object},
	})
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	return sign(payload, webhookSecret)
}

func sign(payload []byte, webhookSecret string) ([]byte, http.Header) {
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: webhookSecret})
	headers := http.Header{}
	headers.Set(stripe.SignatureHeader, signed.Header)
	return signed.Payload, headers
}

// PurchaseMetadata is the metadata a Checkout Session started for purchase
// carries.
func PurchaseMetadata(purchase paymentprovider.Purchase) map[string]string {
	metadata := map[string]string{
		stripe.MetadataTenantID: purchase.TenantID.String(),
		stripe.MetadataUserID:   purchase.ReaderID.String(),
		stripe.MetadataPrice:    strconv.FormatInt(int64(purchase.Price), 10),
	}
	// Each of the two is written when it is set, so a purchase naming both
	// stands for a checkout the provider would have to refuse.
	if purchase.EpisodeID != uuid.Nil {
		metadata[stripe.MetadataEpisodeID] = purchase.EpisodeID.String()
	}
	if purchase.VolumeID != uuid.Nil {
		metadata[stripe.MetadataVolumeID] = purchase.VolumeID.String()
	}
	if purchase.ReadingPeriodHours > 0 {
		metadata[stripe.MetadataReadingPeriodHours] = strconv.FormatInt(int64(purchase.ReadingPeriodHours), 10)
	}
	if purchase.Kind != "" {
		metadata[stripe.MetadataKind] = string(purchase.Kind)
	}
	return metadata
}

// API is a fake of the Stripe API endpoints the provider calls. Each secret key
// sees only the payment intents made under it, as each Stripe account does.
type API struct {
	server *httptest.Server

	mu      sync.Mutex
	intents map[string]map[string]*paymentIntent
	refunds []Refund
	// idempotent holds the refund each idempotency key created, by secret key.
	idempotent map[string]map[string]Refund
}

type paymentIntent struct {
	amount   int64
	currency string
	refunded int64
	// failNext makes the next refund created on the intent a failed one.
	failNext bool
}

// Refund is one refund the fake made.
type Refund struct {
	ID              string
	SecretKey       string
	PaymentIntentID string
	Amount          int64
	IdempotencyKey  string
	// Status is succeeded, or failed for a refund the fake was told to fail.
	Status string
}

// NewAPI answers a fake that serves until t ends.
func NewAPI(t testing.TB) *API {
	t.Helper()
	api := &API{intents: map[string]map[string]*paymentIntent{}, idempotent: map[string]map[string]Refund{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/refunds", api.createRefund)
	mux.HandleFunc("GET /v1/payment_intents/{id}", api.getPaymentIntent)
	api.server = httptest.NewServer(mux)
	t.Cleanup(api.server.Close)
	return api
}

// URL is the origin a provider is pointed at with [stripe.WithAPIURL].
func (a *API) URL() string {
	return a.server.URL
}

// SetPaymentIntent makes the payment intent id, under secretKey, one that has
// been paid amount in the minor unit of currency. Refunds already made on it
// stay.
func (a *API) SetPaymentIntent(secretKey, id string, amount int64, currency string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	intent := a.intent(secretKey, id)
	intent.amount = amount
	intent.currency = strings.ToLower(currency)
}

// SetRefunded makes amount the total refunded so far on the payment intent id
// under secretKey, as a refund made in the dashboard does.
func (a *API) SetRefunded(secretKey, id string, amount int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.intent(secretKey, id).refunded = amount
}

// setCurrency makes currency the one the payment intent id under secretKey is
// in, unless it is in one already, as a refund that arrives before the
// checkout does needs it to be.
func (a *API) setCurrency(secretKey, id, currency string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if intent := a.intent(secretKey, id); intent.currency == "" {
		intent.currency = strings.ToLower(currency)
	}
}

// FailNextRefund makes the next refund created on the payment intent id under
// secretKey one Stripe answers as failed, which refunds nothing.
func (a *API) FailNextRefund(secretKey, id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.intent(secretKey, id).failNext = true
}

// RefundedTotal answers the total refunded so far on the payment intent id
// under secretKey.
func (a *API) RefundedTotal(secretKey, id string) int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	if intent, ok := a.intents[secretKey][id]; ok {
		return intent.refunded
	}
	return 0
}

// Refunds answers every refund the fake made, in the order it made them.
func (a *API) Refunds() []Refund {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]Refund(nil), a.refunds...)
}

// intent answers the payment intent id under secretKey, making one that has
// been paid nothing when there is none. It needs a.mu held.
func (a *API) intent(secretKey, id string) *paymentIntent {
	intents, ok := a.intents[secretKey]
	if !ok {
		intents = map[string]*paymentIntent{}
		a.intents[secretKey] = intents
	}
	intent, ok := intents[id]
	if !ok {
		intent = &paymentIntent{}
		intents[id] = intent
	}
	return intent
}

// createRefund refunds part or all of what a payment intent has left. A
// request repeating an idempotency key answers the refund the key first
// created and refunds nothing more, and one on an intent refunded in full is
// refused as Stripe refuses it.
func (a *API) createRefund(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeError(w, http.StatusBadRequest, "", err.Error())
		return
	}
	secretKey := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	idempotencyKey := r.Header.Get("Idempotency-Key")
	intentID := r.PostForm.Get("payment_intent")

	a.mu.Lock()
	refund, replayed := a.idempotent[secretKey][idempotencyKey]
	if replayed && refund.PaymentIntentID != intentID {
		a.mu.Unlock()
		writeErrorOfType(w, http.StatusBadRequest, "idempotency_error", "", "Keys for idempotent requests can only be used with the same parameters they were first used with.")
		return
	}
	if !replayed {
		intent, ok := a.intents[secretKey][intentID]
		if !ok || intent.amount == 0 {
			a.mu.Unlock()
			writeError(w, http.StatusNotFound, "resource_missing", "No such payment_intent: '"+intentID+"'")
			return
		}
		amount := intent.amount - intent.refunded
		if raw := r.PostForm.Get("amount"); raw != "" {
			amount, _ = strconv.ParseInt(raw, 10, 64)
		}
		if intent.refunded >= intent.amount {
			a.mu.Unlock()
			writeError(w, http.StatusBadRequest, string(stripego.ErrorCodeChargeAlreadyRefunded), "Charge has already been refunded.")
			return
		}
		if amount <= 0 || intent.refunded+amount > intent.amount {
			a.mu.Unlock()
			writeError(w, http.StatusBadRequest, "amount_too_large", "Refund amount is greater than unrefunded amount on charge.")
			return
		}
		status := "succeeded"
		if intent.failNext {
			intent.failNext = false
			status = "failed"
		} else {
			intent.refunded += amount
		}
		refund = Refund{
			ID:              fmt.Sprintf("re_fake%04d", len(a.refunds)+1),
			SecretKey:       secretKey,
			PaymentIntentID: intentID,
			Amount:          amount,
			IdempotencyKey:  idempotencyKey,
			Status:          status,
		}
		a.refunds = append(a.refunds, refund)
		if idempotencyKey != "" {
			if a.idempotent[secretKey] == nil {
				a.idempotent[secretKey] = map[string]Refund{}
			}
			a.idempotent[secretKey][idempotencyKey] = refund
		}
	}
	currency := a.intents[secretKey][refund.PaymentIntentID].currency
	a.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":             refund.ID,
		"object":         "refund",
		"amount":         refund.Amount,
		"currency":       currency,
		"payment_intent": refund.PaymentIntentID,
		"status":         refund.Status,
	})
}

// getPaymentIntent answers a payment intent with its charge expanded, which
// carries what has been refunded on it.
func (a *API) getPaymentIntent(w http.ResponseWriter, r *http.Request) {
	secretKey := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	id := r.PathValue("id")
	a.mu.Lock()
	intent, ok := a.intents[secretKey][id]
	var amount, refunded int64
	var currency string
	if ok {
		amount, refunded, currency = intent.amount, intent.refunded, intent.currency
	}
	a.mu.Unlock()
	if !ok {
		writeError(w, http.StatusNotFound, "resource_missing", "No such payment_intent: '"+id+"'")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":       id,
		"object":   "payment_intent",
		"amount":   amount,
		"currency": currency,
		"status":   "succeeded",
		"latest_charge": map[string]any{
			"id":              "ch_" + id,
			"object":          "charge",
			"amount":          amount,
			"amount_refunded": refunded,
			"currency":        currency,
			"payment_intent":  id,
			"refunded":        refunded >= amount,
		},
	})
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeErrorOfType(w, status, "invalid_request_error", code, message)
}

func writeErrorOfType(w http.ResponseWriter, status int, errorType, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"type":    errorType,
			"code":    code,
			"message": message,
		},
	})
}

// Fixture is Stripe's contract fixture, over a fake of its API.
type Fixture struct {
	API *API
}

var _ paymentprovidertest.Fixture = (*Fixture)(nil)

// NewFixture answers a fixture whose fake API serves until t ends.
func NewFixture(t testing.TB) *Fixture {
	return &Fixture{API: NewAPI(t)}
}

func (f *Fixture) Provider() paymentprovider.Provider {
	return stripe.New(stripe.WithAPIURL(f.API.URL()))
}

func (*Fixture) Credentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		stripe.FieldSecretKey:     "sk_test_51ContractFixtureAAAA",
		stripe.FieldWebhookSecret: "whsec_ContractFixtureAAAA",
	}
}

func (*Fixture) OtherCredentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		stripe.FieldSecretKey:     "sk_test_51ContractFixtureBBBB",
		stripe.FieldWebhookSecret: "whsec_ContractFixtureBBBB",
	}
}

func (f *Fixture) CheckoutCompleted(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) ([]byte, http.Header) {
	t.Helper()
	if checkout.PaymentID != "" {
		f.API.SetPaymentIntent(credentials[stripe.FieldSecretKey], checkout.PaymentID, int64(checkout.Purchase.Price), checkout.Purchase.Currency)
	}
	return recorded(t, credentials, "checkout.session.completed.json", map[string]any{
		"id":              checkout.CheckoutID,
		"amount_subtotal": checkout.Purchase.Price,
		"amount_total":    checkout.Purchase.Price,
		"currency":        strings.ToLower(checkout.Purchase.Currency),
		"livemode":        !checkout.Test,
		"payment_intent":  checkout.PaymentID,
		"metadata":        PurchaseMetadata(checkout.Purchase),
	})
}

func (f *Fixture) Refunded(t testing.TB, credentials paymentprovider.Credentials, refund paymentprovidertest.Refund) ([]byte, http.Header) {
	t.Helper()
	f.API.SetRefunded(credentials[stripe.FieldSecretKey], refund.PaymentID, refund.AmountRefunded)
	f.API.setCurrency(credentials[stripe.FieldSecretKey], refund.PaymentID, refund.Currency)
	return recorded(t, credentials, "charge.refunded.json", map[string]any{
		"amount_refunded": refund.AmountRefunded,
		"currency":        strings.ToLower(refund.Currency),
		"payment_intent":  refund.PaymentID,
	})
}

func (f *Fixture) RefundedTotal(_ testing.TB, credentials paymentprovider.Credentials, paymentID string) int64 {
	return f.API.RefundedTotal(credentials[stripe.FieldSecretKey], paymentID)
}

func (f *Fixture) FailNextRefund(_ testing.TB, credentials paymentprovider.Credentials, paymentID string) {
	f.API.FailNextRefund(credentials[stripe.FieldSecretKey], paymentID)
}

func (f *Fixture) RefundFailed(t testing.TB, credentials paymentprovider.Credentials, refund paymentprovidertest.Refund) ([]byte, http.Header) {
	t.Helper()
	f.API.SetRefunded(credentials[stripe.FieldSecretKey], refund.PaymentID, refund.AmountRefunded)
	f.API.setCurrency(credentials[stripe.FieldSecretKey], refund.PaymentID, refund.Currency)
	return recorded(t, credentials, "refund.failed.json", map[string]any{
		"currency":       strings.ToLower(refund.Currency),
		"payment_intent": refund.PaymentID,
	})
}

// Disputed answers Stripe's notification that the charge of paymentID is
// disputed. It is not part of the contract, which no provider but Stripe
// reports a dispute through yet.
func (*Fixture) Disputed(t testing.TB, credentials paymentprovider.Credentials, paymentID string) ([]byte, http.Header) {
	t.Helper()
	return recorded(t, credentials, "charge.dispute.created.json", map[string]any{
		"payment_intent": paymentID,
	})
}

// DisputeClosed answers Stripe's notification that the dispute of the charge
// of paymentID closed with status, such as "lost" or "won". It is not part of
// the contract either.
func (*Fixture) DisputeClosed(t testing.TB, credentials paymentprovider.Credentials, paymentID string, status stripego.DisputeStatus) ([]byte, http.Header) {
	t.Helper()
	return recorded(t, credentials, "charge.dispute.closed.json", map[string]any{
		"payment_intent": paymentID,
		"status":         status,
	})
}

// CheckoutExpired answers Stripe's notification that the Checkout Session of
// checkout expired unpaid. It is not part of the contract either.
func (*Fixture) CheckoutExpired(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) ([]byte, http.Header) {
	t.Helper()
	return recorded(t, credentials, "checkout.session.expired.json", map[string]any{
		"id":              checkout.CheckoutID,
		"amount_subtotal": checkout.Purchase.Price,
		"amount_total":    checkout.Purchase.Price,
		"currency":        strings.ToLower(checkout.Purchase.Currency),
		"livemode":        !checkout.Test,
		"metadata":        PurchaseMetadata(checkout.Purchase),
	})
}

func (*Fixture) Unrelated(t testing.TB, credentials paymentprovider.Credentials) ([]byte, http.Header) {
	t.Helper()
	return recorded(t, credentials, "payment_intent.created.json", nil)
}

// recorded answers the event under testdata/name with fields replaced on its
// object, signed with the credentials' webhook secret.
func recorded(t testing.TB, credentials paymentprovider.Credentials, name string, fields map[string]any) ([]byte, http.Header) {
	t.Helper()
	raw, err := events.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var event map[string]any
	if err := json.Unmarshal(raw, &event); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	data, _ := event["data"].(map[string]any)
	object, _ := data["object"].(map[string]any)
	if object == nil {
		t.Fatalf("%s has no data.object", name)
	}
	maps.Copy(object, fields)
	// An event is delivered in the mode of the object it is about.
	if livemode, ok := fields["livemode"]; ok {
		event["livemode"] = livemode
	}
	// Stripe refuses an event from an API version other than the library's.
	event["api_version"] = stripego.APIVersion
	payload, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("encode %s: %v", name, err)
	}
	return sign(payload, credentials[stripe.FieldWebhookSecret])
}
