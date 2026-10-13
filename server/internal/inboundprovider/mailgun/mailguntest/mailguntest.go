// Package mailguntest posts mail the way a Mailgun Route's `forward()` action
// does, for the inbound provider contract and the tests of the webhook.
package mailguntest

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

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

// Received posts mail as multipart/form-data, the form a Route posts a mail
// with attachments in, signed now.
func (Fixture) Received(t testing.TB, credentials inboundprovider.Credentials, mail inboundprovidertest.Mail) ([]byte, http.Header) {
	t.Helper()
	fields := Fields(mail)
	fields = Sign(fields, credentials[mailgun.FieldWebhookSigningKey], time.Now(), uuid.NewString())
	return Multipart(t, fields)
}

func (Fixture) Unrelated(testing.TB, inboundprovider.Credentials) ([]byte, http.Header, bool) {
	return nil, nil, false
}

// Field is one form field of a Route post. A post is a list rather than a
// map because Mailgun sends `subject` beside the mail's `Subject` header.
type Field struct {
	Name  string
	Value string
}

// Fields answers the fields a Route posts for mail, unsigned.
func Fields(mail inboundprovidertest.Mail) []Field {
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
	encoded, _ := json.Marshal(headers)

	fields := []Field{
		{"recipient", mail.To},
		{"sender", mail.From},
		{"from", "Reader <" + mail.From + ">"},
		{"subject", mail.Subject},
		{"body-plain", mail.Text},
		{"message-headers", string(encoded)},
	}
	for _, header := range headers {
		fields = append(fields, Field{header[0], header[1]})
	}
	return fields
}

// Sign adds the `timestamp`, `token`, and `signature` fields Mailgun signs a
// post with, as of at, under key.
func Sign(fields []Field, key string, at time.Time, token string) []Field {
	timestamp := strconv.FormatInt(at.Unix(), 10)
	return append(fields,
		Field{"timestamp", timestamp},
		Field{"token", token},
		Field{"signature", Signature(key, timestamp, token)},
	)
}

// Signature answers the signature Mailgun sends for timestamp and token under
// key.
func Signature(key, timestamp, token string) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(timestamp + token))
	return hex.EncodeToString(mac.Sum(nil))
}

// Multipart answers a multipart/form-data request of fields, as a Route posts
// a mail with attachments.
func Multipart(t testing.TB, fields []Field) ([]byte, http.Header) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range fields {
		if err := writer.WriteField(field.Name, field.Value); err != nil {
			t.Fatalf("write form field %s: %v", field.Name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close form: %v", err)
	}
	headers := http.Header{}
	headers.Set("Content-Type", writer.FormDataContentType())
	return body.Bytes(), headers
}
