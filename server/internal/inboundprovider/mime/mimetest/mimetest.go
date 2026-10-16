// Package mimetest posts mail whole, as a Cloudflare Email Worker or a Postfix
// pipe transport does, for the inbound provider contract and the tests of the
// webhook.
package mimetest

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	"github.com/publira/publira/server/internal/inboundprovider/mime"
)

// Fixture is the contract fixture. The provider reads no API, so the fixture
// holds nothing.
type Fixture struct{}

func (Fixture) Provider() inboundprovider.Provider {
	return mime.New()
}

func (Fixture) Credentials() inboundprovider.Credentials {
	return inboundprovider.Credentials{mime.FieldWebhookToken: "contract-token"}
}

func (Fixture) OtherCredentials() inboundprovider.Credentials {
	return inboundprovider.Credentials{mime.FieldWebhookToken: "another-token"}
}

// Received posts mail with its To as the envelope recipient.
func (Fixture) Received(t testing.TB, credentials inboundprovider.Credentials, mail inboundprovidertest.Mail) ([]byte, http.Header) {
	t.Helper()
	return Post(credentials[mime.FieldWebhookToken], Raw(mail), mail.To)
}

func (Fixture) Unrelated(testing.TB, inboundprovider.Credentials) ([]byte, http.Header, bool) {
	return nil, nil, false
}

// Post answers a request that posts raw, authorized with token as the
// password of its basic auth, naming envelopeTo as the envelope recipients.
func Post(token string, raw []byte, envelopeTo ...string) ([]byte, http.Header) {
	headers := http.Header{}
	headers.Set("Content-Type", mime.ContentType)
	headers.Set("Authorization", BasicAuth(token))
	if len(envelopeTo) > 0 {
		headers.Set(mime.HeaderEnvelopeTo, strings.Join(envelopeTo, ", "))
	}
	return raw, headers
}

// BasicAuth answers the Authorization header sent for a webhook URL whose
// password is token.
func BasicAuth(token string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte("inbound:"+token))
}

// Raw answers mail as a whole RFC 5322 message. Each call is another receipt
// of mail, with a Received line of its own.
func Raw(mail inboundprovidertest.Mail) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "Received: from mail.example.net by mx.example.com with ESMTPS id %s\r\n", rand.Text())
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
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	b.WriteString("\r\n")
	b.WriteString(strings.ReplaceAll(mail.Text, "\n", "\r\n"))
	return []byte(b.String())
}
