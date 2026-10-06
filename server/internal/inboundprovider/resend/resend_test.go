package resend_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/resend"
	"github.com/publira/publira/server/internal/inboundprovider/resend/resendtest"
)

const recordedEmailID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c"

var credentials = inboundprovider.Credentials{
	resend.FieldAPIKey:        resendtest.APIKey,
	resend.FieldWebhookSecret: resendtest.WebhookSecret,
}

func readTestdata(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return data
}

// recordedFixture answers a fake of the receiving API that holds the
// recorded email.
func recordedFixture(t *testing.T) *resendtest.Fixture {
	t.Helper()
	fixture := resendtest.NewFixture(t)
	fixture.Hold(recordedEmailID, readTestdata(t, "received_email.json"))
	return fixture
}

func TestParseWebhookReadsTheRecordedEmail(t *testing.T) {
	fixture := recordedFixture(t)
	payload, headers := resendtest.Signed(t, resendtest.WebhookSecret, readTestdata(t, "email_received.json"))

	result, err := fixture.Provider().ParseWebhook(t.Context(), payload, headers, credentials)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	msg, ok := result.(inboundprovider.Message)
	if !ok {
		t.Fatalf("result = %T, want Message", result)
	}
	if msg.ID != recordedEmailID {
		t.Errorf("ID = %q", msg.ID)
	}
	if msg.From != "alex.reader@example.net" {
		t.Errorf("From = %q", msg.From)
	}
	if !slices.Equal(msg.Recipients, []string{"contact+7Hn3QzW9kPfa@reply.example.com"}) {
		t.Errorf("Recipients = %q", msg.Recipients)
	}
	if msg.Subject != "Re: About my purchase" {
		t.Errorf("Subject = %q", msg.Subject)
	}
	if msg.MessageID != "CAJ4k2m1+9xQ@mail.example.net" {
		t.Errorf("MessageID = %q", msg.MessageID)
	}
	if !slices.Equal(msg.InReplyTo, []string{"0f3c2b8e-1d7a-4c55-9a3e-4b1f0d2c9e11@shop.example.com"}) {
		t.Errorf("InReplyTo = %q", msg.InReplyTo)
	}
	if !slices.Equal(msg.References, []string{
		"9b1e7c2a-5f3d-4e8b-a6c1-2d4f8e0b3a77@shop.example.com",
		"0f3c2b8e-1d7a-4c55-9a3e-4b1f0d2c9e11@shop.example.com",
	}) {
		t.Errorf("References = %q", msg.References)
	}
	if got := inboundprovider.StripQuoted(msg.Text); got != "Thanks, the episode opens now.\n\nAlex" {
		t.Errorf("StripQuoted(Text) = %q", got)
	}
}

func TestParseWebhookFallsBackOnTheHTMLBody(t *testing.T) {
	fixture := resendtest.NewFixture(t)
	fixture.Hold(recordedEmailID, []byte(`{
		"id": "`+recordedEmailID+`",
		"from": "alex.reader@example.net",
		"to": ["contact+7Hn3QzW9kPfa@reply.example.com"],
		"subject": "Re: About my purchase",
		"text": null,
		"html": "<div>Thanks, the episode opens now.</div><blockquote>We have restored your purchase.</blockquote>",
		"headers": {"in-reply-to": ["<a@shop.example.com>", "<b@shop.example.com>"]}
	}`))
	payload, headers := resendtest.Signed(t, resendtest.WebhookSecret, readTestdata(t, "email_received.json"))

	result, err := fixture.Provider().ParseWebhook(t.Context(), payload, headers, credentials)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	msg := result.(inboundprovider.Message)
	if got := inboundprovider.StripQuoted(msg.Text); got != "Thanks, the episode opens now." {
		t.Errorf("StripQuoted(Text) = %q (Text %q)", got, msg.Text)
	}
	if !slices.Equal(msg.InReplyTo, []string{"a@shop.example.com", "b@shop.example.com"}) {
		t.Errorf("InReplyTo = %q, want a header the mail repeats read in full", msg.InReplyTo)
	}
}

func TestParseWebhookRefusesARequestThatDoesNotVerify(t *testing.T) {
	payload := readTestdata(t, "email_received.json")
	now := time.Now()
	cases := map[string]http.Header{
		"another secret":       resendtest.Sign(t, payload, "whsec_YW5vdGhlci1zaWduaW5nLXNlY3JldA==", "msg_1", now),
		"an expired timestamp": resendtest.Sign(t, payload, resendtest.WebhookSecret, "msg_1", now.Add(-10*time.Minute)),
		"a future timestamp":   resendtest.Sign(t, payload, resendtest.WebhookSecret, "msg_1", now.Add(10*time.Minute)),
		"no headers":           {},
	}
	tampered := resendtest.Sign(t, payload, resendtest.WebhookSecret, "msg_1", now)
	tampered.Set("svix-id", "msg_2")
	cases["another request id"] = tampered

	var calls atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	t.Cleanup(api.Close)
	provider := resend.New(resend.WithBaseURL(api.URL))
	for name, headers := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := provider.ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
				t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
			}
		})
	}
	t.Run("a changed body", func(t *testing.T) {
		headers := resendtest.Sign(t, payload, resendtest.WebhookSecret, "msg_1", now)
		changed := append(slices.Clone(payload), ' ')
		if _, err := provider.ParseWebhook(t.Context(), changed, headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
			t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
		}
	})
	if calls.Load() != 0 {
		t.Fatalf("the API was called %d times for requests that do not verify", calls.Load())
	}
}

func TestParseWebhookAcceptsAnyOfSeveralSignatures(t *testing.T) {
	fixture := recordedFixture(t)
	payload := readTestdata(t, "email_received.json")
	headers := resendtest.Sign(t, payload, resendtest.WebhookSecret, "msg_1", time.Now())
	headers.Set("svix-signature", "v1,b3RoZXI= "+headers.Get("svix-signature"))
	if _, err := fixture.Provider().ParseWebhook(t.Context(), payload, headers, credentials); err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
}

func TestParseWebhookIgnoresAnotherEventWithoutCallingTheAPI(t *testing.T) {
	var calls atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	t.Cleanup(api.Close)
	payload, headers := resendtest.Signed(t, resendtest.WebhookSecret, []byte(`{"type":"email.bounced","data":{"email_id":"x"}}`))

	result, err := resend.New(resend.WithBaseURL(api.URL)).ParseWebhook(t.Context(), payload, headers, credentials)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	ignored, ok := result.(inboundprovider.Ignored)
	if !ok || ignored.Type != "email.bounced" || ignored.ID != headers.Get("svix-id") {
		t.Fatalf("result = %#v, want Ignored email.bounced", result)
	}
	if calls.Load() != 0 {
		t.Fatalf("the API was called %d times", calls.Load())
	}
}

func TestParseWebhookReportsAnAPIThatDoesNotAnswerTheMail(t *testing.T) {
	payload, headers := resendtest.Signed(t, resendtest.WebhookSecret, readTestdata(t, "email_received.json"))
	for name, want := range map[int]error{
		http.StatusUnauthorized:        inboundprovider.ErrProviderUnavailable,
		http.StatusTooManyRequests:     inboundprovider.ErrProviderUnavailable,
		http.StatusInternalServerError: inboundprovider.ErrProviderUnavailable,
		http.StatusNotFound:            inboundprovider.ErrMalformedRequest,
	} {
		t.Run(http.StatusText(name), func(t *testing.T) {
			api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(name) }))
			t.Cleanup(api.Close)
			if _, err := resend.New(resend.WithBaseURL(api.URL)).ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, want) {
				t.Fatalf("ParseWebhook error = %v, want %v", err, want)
			}
		})
	}

	t.Run("an API that cannot be reached", func(t *testing.T) {
		api := httptest.NewServer(http.NotFoundHandler())
		api.Close()
		if _, err := resend.New(resend.WithBaseURL(api.URL)).ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrProviderUnavailable) {
			t.Fatalf("ParseWebhook error = %v, want ErrProviderUnavailable", err)
		}
	})
}
