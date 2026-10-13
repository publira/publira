package mailgun_test

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	"github.com/publira/publira/server/internal/inboundprovider/mailgun"
	"github.com/publira/publira/server/internal/inboundprovider/mailgun/mailguntest"
)

const signingKey = "recorded-signing-key"

var credentials = inboundprovider.Credentials{mailgun.FieldWebhookSigningKey: signingKey}

// recordedPosts are the Route posts in testdata, the time each was signed at,
// and the signature it was posted with.
var recordedPosts = map[string]struct {
	signedAt  int64
	signature string
}{
	"route_forward.json":            {1791195151, "b4f4cd500e79565f6b0d7c580dbedec44bb0b706bb8ac24679c352ff9c0023ad"},
	"route_forward_attachment.json": {1791248692, "4fbb03c1354633bb7ad1fa67f0728b9c7fc443e7a4bd55bf375a340a2a0728ee"},
}

// recorded answers a post a Route made, as it was received, and a provider
// whose clock reads a few seconds after it was signed.
func recorded(t *testing.T, name string) ([]byte, http.Header, *mailgun.Provider) {
	t.Helper()
	post, ok := recordedPosts[name]
	if !ok {
		t.Fatalf("no recorded post %s", name)
	}
	payload, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("X-Mailgun-Timestamp", strconv.FormatInt(post.signedAt, 10))
	headers.Set("X-Mailgun-Signature", post.signature)
	return payload, headers, at(time.Unix(post.signedAt, 0).Add(3 * time.Second))
}

func at(now time.Time) *mailgun.Provider {
	return mailgun.New(mailgun.WithClock(func() time.Time { return now }))
}

func parse(t *testing.T, provider *mailgun.Provider, payload []byte, headers http.Header) inboundprovider.Message {
	t.Helper()
	result, err := provider.ParseWebhook(t.Context(), payload, headers, credentials)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	msg, ok := result.(inboundprovider.Message)
	if !ok {
		t.Fatalf("result = %T, want Message", result)
	}
	return msg
}

func TestParseWebhookReadsAPostWithoutAttachments(t *testing.T) {
	payload, headers, provider := recorded(t, "route_forward.json")
	msg := parse(t, provider, payload, headers)

	if msg.From != "alex.reader@example.net" {
		t.Errorf("From = %q", msg.From)
	}
	if !slices.Equal(msg.Recipients, []string{"contact+7Hn3QzW9kPfa@reply.example.com"}) {
		t.Errorf("Recipients = %q", msg.Recipients)
	}
	if msg.Subject != "Re: About my purchase" {
		t.Errorf("Subject = %q", msg.Subject)
	}
	if msg.MessageID != "CAJ4k2m1+9xQ@mail.example.net" || msg.ID != msg.MessageID {
		t.Errorf("MessageID = %q, ID = %q", msg.MessageID, msg.ID)
	}
	want := []string{"0f3c2b8e-1d7a-4c55-9a3e-4b1f0d2c9e11@shop.example.com"}
	if !slices.Equal(msg.InReplyTo, want) || !slices.Equal(msg.References, want) {
		t.Errorf("InReplyTo = %q, References = %q", msg.InReplyTo, msg.References)
	}
	if got := inboundprovider.StripQuoted(msg.Text); got != "Thanks, the episode opens now.\n\nAlex" {
		t.Errorf("StripQuoted(Text) = %q", got)
	}
}

func TestParseWebhookReadsAPostWithAnAttachment(t *testing.T) {
	payload, headers, provider := recorded(t, "route_forward_attachment.json")
	msg := parse(t, provider, payload, headers)

	if msg.From != "alex.reader@example.net" {
		t.Errorf("From = %q", msg.From)
	}
	if !slices.Equal(msg.Recipients, []string{"contact+7Hn3QzW9kPfa@reply.example.com", "sam.reader@example.net"}) {
		t.Errorf("Recipients = %q, want the envelope recipient and the Cc", msg.Recipients)
	}
	if msg.Subject != "Re: About my purchase" {
		t.Errorf("Subject = %q, want the encoded word decoded", msg.Subject)
	}
	if msg.MessageID != "DM6PR02MB4433A1B2C3D4E5F6@DM6PR02MB.example.outlook.com" {
		t.Errorf("MessageID = %q", msg.MessageID)
	}
	if !slices.Equal(msg.InReplyTo, []string{"0f3c2b8e-1d7a-4c55-9a3e-4b1f0d2c9e11@shop.example.com"}) {
		t.Errorf("InReplyTo = %q", msg.InReplyTo)
	}
	want := "I tried again and it still fails on my tablet. The error says the episode is not available in my region, which seems wrong. A screenshot is attached."
	if got := inboundprovider.StripQuoted(msg.Text); got != want {
		t.Errorf("StripQuoted(Text) = %q, want %q", got, want)
	}
}

func TestParseWebhookRefusesAPostThatDoesNotVerify(t *testing.T) {
	payload, headers, provider := recorded(t, "route_forward.json")
	signedAt := time.Unix(recordedPosts["route_forward.json"].signedAt, 0)
	altered := func(name, value string) http.Header {
		changed := headers.Clone()
		if value == "" {
			changed.Del(name)
		} else {
			changed.Set(name, value)
		}
		return changed
	}

	for name, tc := range map[string]struct {
		provider    *mailgun.Provider
		payload     []byte
		headers     http.Header
		credentials inboundprovider.Credentials
	}{
		"another signing key": {provider, payload, headers, inboundprovider.Credentials{mailgun.FieldWebhookSigningKey: "another-signing-key"}},
		"no signing key":      {provider, payload, headers, inboundprovider.Credentials{}},
		"signed too long ago": {at(signedAt.Add(8*time.Hour + time.Second)), payload, headers, credentials},
		"signed in the future": {
			at(signedAt.Add(-5*time.Minute - time.Second)), payload, headers, credentials,
		},
		"another body": {
			provider, bytes.Replace(payload, []byte("the episode opens now"), []byte("please send a refund"), 1), headers, credentials,
		},
		"another timestamp":        {provider, payload, altered("X-Mailgun-Timestamp", "1791195150"), credentials},
		"no timestamp":             {provider, payload, altered("X-Mailgun-Timestamp", ""), credentials},
		"a timestamp not a number": {provider, payload, altered("X-Mailgun-Timestamp", "yesterday"), credentials},
		"no signature":             {provider, payload, altered("X-Mailgun-Signature", ""), credentials},
		"a signature not hex":      {provider, payload, altered("X-Mailgun-Signature", "zz"), credentials},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := tc.provider.ParseWebhook(t.Context(), tc.payload, tc.headers, tc.credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
				t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
			}
		})
	}
}

// Mailgun signs the form a Route posts to a URL not ending in `json`, and
// every event webhook of the account, over a timestamp and a token alone. A
// signature of that kind says nothing about the mail beside it, so it does
// not verify a post.
func TestParseWebhookRefusesASignatureThatDoesNotCoverTheMail(t *testing.T) {
	now := time.Now()
	timestamp := strconv.FormatInt(now.Unix(), 10)
	const token = "a3f9c1e07b5d42e8961f0c7d2b4e8a6f31d5c9e2b7a04f6d18"
	mac := hmac.New(sha256.New, []byte(signingKey))
	mac.Write([]byte(timestamp + token))
	tokenSignature := hex.EncodeToString(mac.Sum(nil))
	mail := inboundprovidertest.Mail{From: "reader@example.net", To: "contact+7Hn3QzW9kPfa@reply.example.com", Text: "Please send a refund."}

	t.Run("a form", func(t *testing.T) {
		form := url.Values{"recipient": {mail.To}, "from": {mail.From}, "body-plain": {mail.Text}, "timestamp": {timestamp}, "token": {token}, "signature": {tokenSignature}}
		headers := http.Header{}
		headers.Set("Content-Type", "application/x-www-form-urlencoded")
		if _, err := mailgun.New().ParseWebhook(t.Context(), []byte(form.Encode()), headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
			t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
		}
	})
	t.Run("JSON under an event's signature", func(t *testing.T) {
		headers := http.Header{}
		headers.Set("Content-Type", "application/json")
		headers.Set("X-Mailgun-Timestamp", timestamp)
		headers.Set("X-Mailgun-Signature", tokenSignature)
		if _, err := mailgun.New().ParseWebhook(t.Context(), mailguntest.Encode(t, mailguntest.Document(mail)), headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
			t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
		}
	})
}

// Mailgun retries a post it was refused for 8 hours, and a retry may carry
// the first attempt's timestamp.
func TestParseWebhookReadsARetryHoursAfterItWasSigned(t *testing.T) {
	payload, headers, _ := recorded(t, "route_forward.json")
	signedAt := time.Unix(recordedPosts["route_forward.json"].signedAt, 0)
	msg := parse(t, at(signedAt.Add(7*time.Hour+55*time.Minute)), payload, headers)
	if msg.MessageID != "CAJ4k2m1+9xQ@mail.example.net" {
		t.Errorf("MessageID = %q", msg.MessageID)
	}
}

// A post for a domain on a subaccount carries the subaccount's signature and
// the primary account's in `X-Mailgun-Parent-Signature`, and either key
// verifies it.
func TestParseWebhookReadsAPostForASubaccountUnderEitherKey(t *testing.T) {
	mail := inboundprovidertest.Mail{From: "reader@example.net", To: "contact+7Hn3QzW9kPfa@reply.example.com", Text: "Hello"}
	const subaccountKey = "subaccount-signing-key"
	payload := mailguntest.Encode(t, mailguntest.Document(mail))
	headers := mailguntest.Sign(payload, subaccountKey, time.Now())
	headers.Set("X-Mailgun-Parent-Signature", mailguntest.Signature(signingKey, headers.Get("X-Mailgun-Timestamp"), payload))

	for name, key := range map[string]string{"the primary account's key": signingKey, "the subaccount's key": subaccountKey} {
		t.Run(name, func(t *testing.T) {
			credentials := inboundprovider.Credentials{mailgun.FieldWebhookSigningKey: key}
			if _, err := mailgun.New().ParseWebhook(t.Context(), payload, headers, credentials); err != nil {
				t.Fatalf("ParseWebhook: %v", err)
			}
		})
	}
	t.Run("another key", func(t *testing.T) {
		credentials := inboundprovider.Credentials{mailgun.FieldWebhookSigningKey: "another-signing-key"}
		if _, err := mailgun.New().ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
			t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
		}
	})
}

func TestParseWebhookFallsBackOnTheHTMLBody(t *testing.T) {
	doc := map[string]any{
		"recipient":  "contact+7Hn3QzW9kPfa@reply.example.com",
		"from":       "reader@example.net",
		"body-plain": "",
		"body-html":  "<p>It works now.</p><blockquote><p>Please try again.</p></blockquote>",
	}
	payload := mailguntest.Encode(t, doc)
	msg := parse(t, mailgun.New(), payload, mailguntest.Sign(payload, signingKey, time.Now()))
	if got := inboundprovider.StripQuoted(msg.Text); got != "It works now." {
		t.Errorf("StripQuoted(Text) = %q (Text %q)", got, msg.Text)
	}
}

func TestParseWebhookRefusesAMailItCannotRead(t *testing.T) {
	mail := inboundprovidertest.Mail{From: "reader@example.net", To: "contact+7Hn3QzW9kPfa@reply.example.com", Text: "Hello"}
	withDocument := func(change func(map[string]any)) []byte {
		doc := mailguntest.Document(mail)
		change(doc)
		return mailguntest.Encode(t, doc)
	}
	for name, payload := range map[string][]byte{
		"no sender": withDocument(func(doc map[string]any) {
			for _, name := range []string{"from", "sender", "From", "message-headers"} {
				delete(doc, name)
			}
		}),
		"a header list that is not a list": withDocument(func(doc map[string]any) {
			doc["message-headers"] = "From: reader@example.net"
		}),
		"a body that is not JSON": []byte("recipient=contact%2B7Hn3QzW9kPfa%40reply.example.com"),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := mailgun.New().ParseWebhook(t.Context(), payload, mailguntest.Sign(payload, signingKey, time.Now()), credentials); !errors.Is(err, inboundprovider.ErrMalformedRequest) {
				t.Fatalf("ParseWebhook error = %v, want ErrMalformedRequest", err)
			}
		})
	}
}
