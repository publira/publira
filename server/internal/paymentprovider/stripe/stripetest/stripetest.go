// Package stripetest signs Stripe webhook notifications for tests: the
// contract fixture over the events under testdata, and [SignedEvent] for a
// test that needs an event of its own shape.
package stripetest

import (
	"embed"
	"encoding/json"
	"maps"
	"net/http"
	"strconv"
	"testing"

	stripego "github.com/stripe/stripe-go/v86"
	"github.com/stripe/stripe-go/v86/webhook"

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
		stripe.MetadataTenantID:  purchase.TenantID.String(),
		stripe.MetadataUserID:    purchase.ReaderID.String(),
		stripe.MetadataEpisodeID: purchase.EpisodeID.String(),
		stripe.MetadataPrice:     strconv.FormatInt(int64(purchase.Price), 10),
	}
	if purchase.ReadingPeriodHours > 0 {
		metadata[stripe.MetadataReadingPeriodHours] = strconv.FormatInt(int64(purchase.ReadingPeriodHours), 10)
	}
	return metadata
}

// Fixture is Stripe's contract fixture.
type Fixture struct{}

var _ paymentprovidertest.Fixture = Fixture{}

func (Fixture) Credentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		stripe.FieldSecretKey:     "sk_test_51ContractFixtureAAAA",
		stripe.FieldWebhookSecret: "whsec_ContractFixtureAAAA",
	}
}

func (Fixture) OtherCredentials() paymentprovider.Credentials {
	return paymentprovider.Credentials{
		stripe.FieldSecretKey:     "sk_test_51ContractFixtureBBBB",
		stripe.FieldWebhookSecret: "whsec_ContractFixtureBBBB",
	}
}

func (Fixture) CheckoutCompleted(t testing.TB, credentials paymentprovider.Credentials, checkout paymentprovidertest.Checkout) ([]byte, http.Header) {
	t.Helper()
	return recorded(t, credentials, "checkout.session.completed.json", map[string]any{
		"id":              checkout.CheckoutID,
		"amount_subtotal": checkout.Purchase.Price,
		"amount_total":    checkout.Purchase.Price,
		"payment_intent":  checkout.PaymentID,
		"metadata":        PurchaseMetadata(checkout.Purchase),
	})
}

func (Fixture) Refunded(t testing.TB, credentials paymentprovider.Credentials, refund paymentprovidertest.Refund) ([]byte, http.Header) {
	t.Helper()
	return recorded(t, credentials, "charge.refunded.json", map[string]any{
		"amount_refunded": refund.AmountRefunded,
		"payment_intent":  refund.PaymentID,
	})
}

func (Fixture) Unrelated(t testing.TB, credentials paymentprovider.Credentials) ([]byte, http.Header) {
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
	// Stripe refuses an event from an API version other than the library's.
	event["api_version"] = stripego.APIVersion
	payload, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("encode %s: %v", name, err)
	}
	return sign(payload, credentials[stripe.FieldWebhookSecret])
}
