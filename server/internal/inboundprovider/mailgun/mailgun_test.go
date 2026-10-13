package mailgun_test

import (
	"errors"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	"github.com/publira/publira/server/internal/inboundprovider/mailgun"
	"github.com/publira/publira/server/internal/inboundprovider/mailgun/mailguntest"
)

const signingKey = "recorded-signing-key"

var credentials = inboundprovider.Credentials{mailgun.FieldWebhookSigningKey: signingKey}

// recordedPosts are the Route posts in testdata, the content type each was
// posted with, and the time each was signed at.
var recordedPosts = map[string]struct {
	contentType string
	signedAt    int64
}{
	"route_forward.urlencoded": {"application/x-www-form-urlencoded", 1791195151},
	"route_forward.multipart":  {"multipart/form-data; boundary=f7c2b1d4e9a84c3b", 1791248692},
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
	headers.Set("Content-Type", post.contentType)
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
	payload, headers, provider := recorded(t, "route_forward.urlencoded")
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
	if msg.ReplayKey != "a3f9c1e07b5d42e8961f0c7d2b4e8a6f31d5c9e2b7a04f6d18" {
		t.Errorf("ReplayKey = %q, want the signed token", msg.ReplayKey)
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
	payload, headers, provider := recorded(t, "route_forward.multipart")
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
	payload, headers, provider := recorded(t, "route_forward.urlencoded")
	signedAt := time.Unix(recordedPosts["route_forward.urlencoded"].signedAt, 0)
	form, err := url.ParseQuery(string(payload))
	if err != nil {
		t.Fatalf("parse the recorded post: %v", err)
	}
	altered := func(change func(url.Values)) []byte {
		values := url.Values{}
		for name, list := range form {
			values[name] = slices.Clone(list)
		}
		change(values)
		return []byte(values.Encode())
	}

	for name, tc := range map[string]struct {
		provider    *mailgun.Provider
		payload     []byte
		credentials inboundprovider.Credentials
	}{
		"another signing key": {provider, payload, inboundprovider.Credentials{mailgun.FieldWebhookSigningKey: "another-signing-key"}},
		"no signing key":      {provider, payload, inboundprovider.Credentials{}},
		"signed too long ago": {at(signedAt.Add(8*time.Hour + time.Second)), payload, credentials},
		"signed in the future": {
			at(signedAt.Add(-5*time.Minute - time.Second)), payload, credentials,
		},
		"another token": {provider, altered(func(v url.Values) { v.Set("token", strings.Repeat("0", 50)) }), credentials},
		"another timestamp": {
			provider, altered(func(v url.Values) { v.Set("timestamp", "1791195150") }), credentials,
		},
		"no signature":        {provider, altered(func(v url.Values) { v.Del("signature") }), credentials},
		"a signature not hex": {provider, altered(func(v url.Values) { v.Set("signature", "zz") }), credentials},
		"a timestamp not a number": {
			provider, altered(func(v url.Values) { v.Set("timestamp", "yesterday") }), credentials,
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := tc.provider.ParseWebhook(t.Context(), tc.payload, headers, tc.credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
				t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
			}
		})
	}
}

// Mailgun retries a post it was refused for 8 hours, and a retry may carry
// the first attempt's timestamp.
func TestParseWebhookReadsARetryHoursAfterItWasSigned(t *testing.T) {
	payload, headers, _ := recorded(t, "route_forward.urlencoded")
	signedAt := time.Unix(recordedPosts["route_forward.urlencoded"].signedAt, 0)
	msg := parse(t, at(signedAt.Add(7*time.Hour+55*time.Minute)), payload, headers)
	if msg.MessageID != "CAJ4k2m1+9xQ@mail.example.net" {
		t.Errorf("MessageID = %q", msg.MessageID)
	}
}

// The token becomes the mail's replay key, which is stored, so a token longer
// than one is refused even when it is signed.
func TestParseWebhookRefusesATokenTooLongToKeep(t *testing.T) {
	mail := inboundprovidertest.Mail{From: "reader@example.net", To: "contact+7Hn3QzW9kPfa@reply.example.com", Text: "Hello"}
	payload, headers := mailguntest.Multipart(t, mailguntest.Sign(mailguntest.Fields(mail), signingKey, time.Now(), strings.Repeat("0", 257)))
	if _, err := mailgun.New().ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
		t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
	}
}

// The signature travels in the form, so a body that is not one carries no
// signature to verify.
func TestParseWebhookRefusesARequestThatIsNotAForm(t *testing.T) {
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	if _, err := mailgun.New().ParseWebhook(t.Context(), []byte(`{}`), headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
		t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
	}
}

func TestParseWebhookFallsBackOnTheHTMLBody(t *testing.T) {
	fields := []mailguntest.Field{
		{Name: "recipient", Value: "contact+7Hn3QzW9kPfa@reply.example.com"},
		{Name: "from", Value: "reader@example.net"},
		{Name: "body-plain", Value: ""},
		{Name: "body-html", Value: "<p>It works now.</p><blockquote><p>Please try again.</p></blockquote>"},
	}
	payload, headers := mailguntest.Multipart(t, mailguntest.Sign(fields, signingKey, time.Now(), "html-token"))
	msg := parse(t, mailgun.New(), payload, headers)
	if got := inboundprovider.StripQuoted(msg.Text); got != "It works now." {
		t.Errorf("StripQuoted(Text) = %q (Text %q)", got, msg.Text)
	}
}

func TestParseWebhookRefusesAMailItCannotRead(t *testing.T) {
	mail := inboundprovidertest.Mail{From: "reader@example.net", To: "contact+7Hn3QzW9kPfa@reply.example.com", Text: "Hello"}
	for name, change := range map[string]func([]mailguntest.Field) []mailguntest.Field{
		"no sender": func(fields []mailguntest.Field) []mailguntest.Field {
			return slices.DeleteFunc(fields, func(f mailguntest.Field) bool {
				return f.Name == "from" || f.Name == "sender" || f.Name == "From" || f.Name == "message-headers"
			})
		},
		"a header list that is not JSON": func(fields []mailguntest.Field) []mailguntest.Field {
			for i := range fields {
				if fields[i].Name == "message-headers" {
					fields[i].Value = "From: reader@example.net"
				}
			}
			return fields
		},
	} {
		t.Run(name, func(t *testing.T) {
			fields := change(mailguntest.Fields(mail))
			payload, headers := mailguntest.Multipart(t, mailguntest.Sign(fields, signingKey, time.Now(), "malformed-token"))
			if _, err := mailgun.New().ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrMalformedRequest) {
				t.Fatalf("ParseWebhook error = %v, want ErrMalformedRequest", err)
			}
		})
	}
}
