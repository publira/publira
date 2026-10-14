// Package mailguntest posts mail the way a Mailgun Route's `forward()` action
// does to a URL ending in `json`, for the inbound provider contract and the
// tests of the webhook.
package mailguntest

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	"github.com/publira/publira/server/internal/inboundprovider/mailgun"
)

// Fixture is the Mailgun contract fixture. Mailgun has no API the provider
// reads, so the fixture holds nothing.
type Fixture struct{}

func (Fixture) Provider() inboundprovider.Provider {
	return mailgun.New()
}

func (Fixture) Credentials() inboundprovider.Credentials {
	return inboundprovider.Credentials{mailgun.FieldWebhookSigningKey: "key-contract-signing"}
}

func (Fixture) OtherCredentials() inboundprovider.Credentials {
	return inboundprovider.Credentials{mailgun.FieldWebhookSigningKey: "key-another-signing"}
}

// Received posts mail signed now.
func (Fixture) Received(t testing.TB, credentials inboundprovider.Credentials, mail inboundprovidertest.Mail) ([]byte, http.Header) {
	t.Helper()
	body := Encode(t, Document(mail))
	return body, Sign(body, credentials[mailgun.FieldWebhookSigningKey], time.Now())
}

func (Fixture) Unrelated(testing.TB, inboundprovider.Credentials) ([]byte, http.Header, bool) {
	return nil, nil, false
}

// Document answers the JSON document a Route posts for mail: Mailgun's own
// fields, and each header of the mail at the top level beside them.
func Document(mail inboundprovidertest.Mail) map[string]any {
	headers := [][]string{
		{"Received", "from mail.example.net by mxa.mailgun.org"},
		{"From", "Reader <" + mail.From + ">"},
		{"To", mail.To},
		{"Subject", mail.Subject},
	}
	if mail.MessageID != "" {
		headers = append(headers, []string{"Message-Id", "<" + mail.MessageID + ">"})
	}
	if mail.InReplyTo != "" {
		headers = append(headers, []string{"In-Reply-To", "<" + mail.InReplyTo + ">"})
	}
	if len(mail.References) > 0 {
		refs := make([]string, 0, len(mail.References))
		for _, id := range mail.References {
			refs = append(refs, "<"+id+">")
		}
		headers = append(headers, []string{"References", strings.Join(refs, " ")})
	}
	headers = append(headers, []string{"Content-Type", "text/plain; charset=\"UTF-8\""})

	doc := map[string]any{
		"recipient":       mail.To,
		"sender":          mail.From,
		"from":            "Reader <" + mail.From + ">",
		"subject":         mail.Subject,
		"body-plain":      mail.Text,
		"message-headers": headers,
		"attachments":     []any{},
	}
	for _, header := range headers {
		doc[header[0]] = header[1]
	}
	return doc
}

// Encode answers doc as the body of a post.
func Encode(t testing.TB, doc map[string]any) []byte {
	t.Helper()
	body, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("encode the post: %v", err)
	}
	return body
}

// Sign answers the headers a Route posts body with, signed as of at under
// key.
func Sign(body []byte, key string, at time.Time) http.Header {
	timestamp := strconv.FormatInt(at.Unix(), 10)
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("X-Mailgun-Timestamp", timestamp)
	headers.Set("X-Mailgun-Signature", Signature(key, timestamp, body))
	return headers
}

// Signature answers the signature Mailgun sends for body posted at timestamp
// under key.
func Signature(key, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(timestamp))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}
