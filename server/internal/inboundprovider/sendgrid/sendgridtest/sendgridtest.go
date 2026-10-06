// Package sendgridtest posts mail the way SendGrid Inbound Parse does, for the
// inbound provider contract and the tests of the webhook.
package sendgridtest

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid"
)

// Fixture is the SendGrid contract fixture. SendGrid has no API the provider
// reads, so the fixture holds nothing.
type Fixture struct{}

func (Fixture) Provider() inboundprovider.Provider {
	return sendgrid.New()
}

func (Fixture) Credentials() inboundprovider.Credentials {
	return inboundprovider.Credentials{sendgrid.FieldWebhookToken: "contract-token"}
}

func (Fixture) OtherCredentials() inboundprovider.Credentials {
	return inboundprovider.Credentials{sendgrid.FieldWebhookToken: "another-token"}
}

// Received posts mail in Inbound Parse's default form, with its header block
// and text body as separate fields.
func (Fixture) Received(t testing.TB, credentials inboundprovider.Credentials, mail inboundprovidertest.Mail) ([]byte, http.Header) {
	t.Helper()
	return Form(t, credentials[sendgrid.FieldWebhookToken], map[string]string{
		"headers":  HeaderBlock(mail),
		"from":     mail.From,
		"to":       mail.To,
		"subject":  mail.Subject,
		"text":     mail.Text,
		"envelope": Envelope(mail),
		"charsets": `{"to":"UTF-8","from":"UTF-8","subject":"UTF-8","text":"UTF-8"}`,
	})
}

func (Fixture) Unrelated(testing.TB, inboundprovider.Credentials) ([]byte, http.Header, bool) {
	return nil, nil, false
}

// Form answers a multipart/form-data request of fields, authorized with token
// as the password of its basic auth.
func Form(t testing.TB, token string, fields map[string]string) ([]byte, http.Header) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatalf("write form field %s: %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close form: %v", err)
	}
	headers := http.Header{}
	headers.Set("Content-Type", writer.FormDataContentType())
	headers.Set("Authorization", BasicAuth(token))
	return body.Bytes(), headers
}

// BasicAuth answers the Authorization header SendGrid sends for a webhook URL
// whose password is token.
func BasicAuth(token string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte("inbound:"+token))
}

// HeaderBlock answers the raw header block of mail, as Inbound Parse posts it
// in its `headers` field.
func HeaderBlock(mail inboundprovidertest.Mail) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Received: from mail.example.net by mx.sendgrid.net\r\n")
	fmt.Fprintf(&b, "From: Reader <%s>\r\n", mail.From)
	fmt.Fprintf(&b, "To: %s\r\n", mail.To)
	fmt.Fprintf(&b, "Subject: %s\r\n", mail.Subject)
	if mail.MessageID != "" {
		fmt.Fprintf(&b, "Message-ID: <%s>\r\n", mail.MessageID)
	}
	if mail.InReplyTo != "" {
		fmt.Fprintf(&b, "In-Reply-To: <%s>\r\n", mail.InReplyTo)
	}
	if len(mail.References) > 0 {
		refs := make([]string, 0, len(mail.References))
		for _, id := range mail.References {
			refs = append(refs, "<"+id+">")
		}
		fmt.Fprintf(&b, "References: %s\r\n", strings.Join(refs, "\r\n "))
	}
	fmt.Fprintf(&b, "Content-Type: text/plain; charset=UTF-8\r\n")
	return b.String()
}

// Envelope answers the SMTP envelope of mail, as Inbound Parse posts it in its
// `envelope` field.
func Envelope(mail inboundprovidertest.Mail) string {
	envelope, _ := json.Marshal(map[string]any{
		"to":   []string{mail.To},
		"from": mail.From,
	})
	return string(envelope)
}
