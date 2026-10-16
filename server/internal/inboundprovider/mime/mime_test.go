package mime_test

import (
	"bytes"
	"errors"
	"net/http"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/mime"
	"github.com/publira/publira/server/internal/inboundprovider/mime/mimetest"
)

const token = "recorded-token"

var credentials = inboundprovider.Credentials{mime.FieldWebhookToken: token}

func recorded(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return raw
}

func parse(t *testing.T, payload []byte, headers http.Header) inboundprovider.Message {
	t.Helper()
	result, err := mime.New().ParseWebhook(t.Context(), payload, headers, credentials)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	msg, ok := result.(inboundprovider.Message)
	if !ok {
		t.Fatalf("result = %T, want Message", result)
	}
	return msg
}

func TestParseWebhookReadsAMailACloudflareEmailWorkerPosts(t *testing.T) {
	raw := recorded(t, "cloudflare_email_worker.eml")
	payload, headers := mimetest.Post(token, raw, "contact+7Hn3QzW9kPfa@reply.example.com")
	msg := parse(t, payload, headers)

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

func TestParseWebhookPutsTheEnvelopeRecipientsFirst(t *testing.T) {
	raw := recorded(t, "forwarded_alias.eml")

	t.Run("a forwarded mail is delivered to the address its To no longer names", func(t *testing.T) {
		payload, headers := mimetest.Post(token, raw, "contact+7Hn3QzW9kPfa@reply.example.com")
		msg := parse(t, payload, headers)
		want := []string{"contact+7Hn3QzW9kPfa@reply.example.com", "support@comics.example.com"}
		if !slices.Equal(msg.Recipients, want) {
			t.Errorf("Recipients = %q, want %q", msg.Recipients, want)
		}
	})

	t.Run("several recipients in one header or in several", func(t *testing.T) {
		payload, headers := mimetest.Post(token, raw)
		headers.Set(mime.HeaderEnvelopeTo, "<contact+7Hn3QzW9kPfa@reply.example.com>, contact+AAAAAAAAAAAA@reply.example.com")
		headers.Add(mime.HeaderEnvelopeTo, "SUPPORT@comics.example.com")
		msg := parse(t, payload, headers)
		want := []string{"contact+7Hn3QzW9kPfa@reply.example.com", "contact+AAAAAAAAAAAA@reply.example.com", "SUPPORT@comics.example.com"}
		if !slices.Equal(msg.Recipients, want) {
			t.Errorf("Recipients = %q, want %q", msg.Recipients, want)
		}
	})

	t.Run("no envelope header leaves the mail's own headers", func(t *testing.T) {
		payload, headers := mimetest.Post(token, raw)
		msg := parse(t, payload, headers)
		if !slices.Equal(msg.Recipients, []string{"support@comics.example.com"}) {
			t.Errorf("Recipients = %q", msg.Recipients)
		}
	})
}

// A mail written by hand or by a script, as a development machine posts one,
// often ends its lines in a bare line feed.
func TestParseWebhookReadsAMailWithBareLineFeeds(t *testing.T) {
	raw := []byte("From: Reader <reader@example.net>\nTo: contact+7Hn3QzW9kPfa@reply.localhost\nSubject: Re: About my purchase\nContent-Type: text/plain; charset=UTF-8\n\nIt opens now, thank you.\n")
	payload, headers := mimetest.Post(token, raw, "contact+7Hn3QzW9kPfa@reply.localhost")
	msg := parse(t, payload, headers)
	if msg.From != "reader@example.net" || msg.Subject != "Re: About my purchase" {
		t.Errorf("From = %q, Subject = %q", msg.From, msg.Subject)
	}
	if got := inboundprovider.StripQuoted(msg.Text); got != "It opens now, thank you." {
		t.Errorf("StripQuoted(Text) = %q", got)
	}
}

// A script posts mails whose headers can be the same; only the bytes of the
// whole post name a delivery.
func TestParseWebhookNamesADeliveryByTheWholeMail(t *testing.T) {
	header := "From: Reader <reader@example.net>\r\nTo: contact+7Hn3QzW9kPfa@reply.localhost\r\nSubject: Re: About my purchase\r\n\r\n"
	read := func(body string) inboundprovider.Message {
		t.Helper()
		payload, headers := mimetest.Post(token, []byte(header+body))
		return parse(t, payload, headers)
	}
	first := read("It opens now, thank you.\r\n")
	if first.DeliveryKey == "" || first.ID != first.DeliveryKey {
		t.Fatalf("DeliveryKey = %q, ID = %q, want the key standing in for the missing Message-ID", first.DeliveryKey, first.ID)
	}
	if again := read("It opens now, thank you.\r\n"); again.DeliveryKey != first.DeliveryKey {
		t.Errorf("DeliveryKey of the same post again = %q, want %q", again.DeliveryKey, first.DeliveryKey)
	}
	if other := read("One more question.\r\n"); other.DeliveryKey == first.DeliveryKey {
		t.Errorf("DeliveryKey of a mail with the same header and another body = %q, the same as the first", other.DeliveryKey)
	}
}

func TestParseWebhookRendersAnHTMLOnlyMail(t *testing.T) {
	raw := []byte("From: reader@example.net\r\nTo: contact+7Hn3QzW9kPfa@reply.example.com\r\nSubject: Re: Hello\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>It works now.</p><blockquote>Please try again.</blockquote>")
	payload, headers := mimetest.Post(token, raw)
	msg := parse(t, payload, headers)
	if got := inboundprovider.StripQuoted(msg.Text); got != "It works now." {
		t.Errorf("StripQuoted(Text) = %q (Text %q)", got, msg.Text)
	}
}

func TestParseWebhookRefusesAnUnauthorizedRequest(t *testing.T) {
	raw := recorded(t, "cloudflare_email_worker.eml")
	cases := map[string]func(http.Header){
		"another token":               func(h http.Header) { h.Set("Authorization", mimetest.BasicAuth("another-token")) },
		"no Authorization header":     func(h http.Header) { h.Del("Authorization") },
		"the token as a bearer token": func(h http.Header) { h.Set("Authorization", "Bearer "+token) },
	}
	for name, alter := range cases {
		t.Run(name, func(t *testing.T) {
			payload, headers := mimetest.Post(token, raw)
			alter(headers)
			if _, err := mime.New().ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
				t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
			}
		})
	}

	t.Run("no token stored", func(t *testing.T) {
		payload, headers := mimetest.Post("", raw)
		if _, err := mime.New().ParseWebhook(t.Context(), payload, headers, inboundprovider.Credentials{}); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
			t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
		}
	})
}

func TestParseWebhookRefusesWhatIsNotAMail(t *testing.T) {
	mail := recorded(t, "cloudflare_email_worker.eml")
	cases := map[string]struct {
		payload     []byte
		contentType string
	}{
		"a body that is not a mail":   {[]byte("this is not a mail"), mime.ContentType},
		"a JSON body":                 {[]byte(`{"from":"reader@example.net","to":"contact+7Hn3QzW9kPfa@reply.example.com"}`), mime.ContentType},
		"a mail that names no sender": {[]byte("To: contact+7Hn3QzW9kPfa@reply.example.com\r\nSubject: Hi\r\n\r\nHello"), mime.ContentType},
		"a mail posted as a form":     {mail, "application/x-www-form-urlencoded"},
		"a mail with no content type": {mail, ""},
		"a mail past the size bound":  {append(bytes.Clone(mail), strings.Repeat("x", 32<<20)...), mime.ContentType},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			payload, headers := mimetest.Post(token, tc.payload)
			headers.Set("Content-Type", tc.contentType)
			if _, err := mime.New().ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrMalformedRequest) {
				t.Fatalf("ParseWebhook error = %v, want ErrMalformedRequest", err)
			}
		})
	}

	t.Run("a content type with parameters is accepted", func(t *testing.T) {
		payload, headers := mimetest.Post(token, mail)
		headers.Set("Content-Type", "message/rfc822; charset=utf-8")
		parse(t, payload, headers)
	})
}
