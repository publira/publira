// Package inboundprovidertest is the contract every inbound email provider
// passes. A provider supplies a [Fixture] that posts mail the way the provider
// does, and of its API where the provider reads one; [RunParse] checks the
// provider reads it.
package inboundprovidertest

import (
	"errors"
	"net/http"
	"slices"
	"testing"

	"github.com/publira/publira/server/internal/inboundprovider"
)

// Mail is one mail a fixture posts.
type Mail struct {
	From    string
	To      string
	Subject string
	Text    string
	// MessageID, InReplyTo, and References are ids without angle brackets.
	// An empty MessageID posts a mail that carries none.
	MessageID  string
	InReplyTo  string
	References []string
}

// Fixture is one provider's webhook requests, signed on demand so that a
// provider whose signatures expire can still be tested.
type Fixture interface {
	// Provider answers the provider as the fixture's requests reach it,
	// reading the fixture's fake of its API where it reads one.
	Provider() inboundprovider.Provider
	// Credentials answers a tenant's credentials for the provider.
	Credentials() inboundprovider.Credentials
	// OtherCredentials answers credentials of the same shape that sign
	// differently, as another tenant's would.
	OtherCredentials() inboundprovider.Credentials
	// Received answers the request that posts mail, and makes the mail one the
	// provider's API holds.
	Received(t testing.TB, credentials inboundprovider.Credentials, mail Mail) ([]byte, http.Header)
	// Unrelated answers a request the provider sends about something other
	// than a received mail, and false for a provider that sends none.
	Unrelated(t testing.TB, credentials inboundprovider.Credentials) ([]byte, http.Header, bool)
}

// RunParse checks that the fixture's provider reads its requests.
func RunParse(t *testing.T, fixture Fixture) {
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	mail := Mail{
		From:       "reader@example.net",
		To:         "contact+ABCDEFGHJKLM@reply.example.com",
		Subject:    "Re: About my purchase",
		Text:       "Thank you, that worked.\n\nOn Mon, Oct 5, 2026 at 10:00 AM Example <contact+ABCDEFGHJKLM@reply.example.com> wrote:\n> Please try again.\n",
		MessageID:  "reply-1@mail.example.net",
		InReplyTo:  "answer-2@shop.example.com",
		References: []string{"answer-1@shop.example.com", "answer-2@shop.example.com"},
	}

	t.Run("a received mail is read", func(t *testing.T) {
		payload, headers := fixture.Received(t, credentials, mail)
		result, err := provider.ParseWebhook(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseWebhook: %v", err)
		}
		msg, ok := result.(inboundprovider.Message)
		if !ok {
			t.Fatalf("result = %T, want Message", result)
		}
		if msg.From != mail.From {
			t.Errorf("From = %q, want %q", msg.From, mail.From)
		}
		if !slices.Contains(msg.Recipients, mail.To) {
			t.Errorf("Recipients = %q, want them to hold %q", msg.Recipients, mail.To)
		}
		if msg.Subject != mail.Subject {
			t.Errorf("Subject = %q, want %q", msg.Subject, mail.Subject)
		}
		if got, want := inboundprovider.StripQuoted(msg.Text), "Thank you, that worked."; got != want {
			t.Errorf("StripQuoted(Text) = %q, want %q (Text %q)", got, want, msg.Text)
		}
		if msg.MessageID != mail.MessageID {
			t.Errorf("MessageID = %q, want %q", msg.MessageID, mail.MessageID)
		}
		if !slices.Equal(msg.InReplyTo, []string{mail.InReplyTo}) {
			t.Errorf("InReplyTo = %q, want [%q]", msg.InReplyTo, mail.InReplyTo)
		}
		if !slices.Equal(msg.References, mail.References) {
			t.Errorf("References = %q, want %q", msg.References, mail.References)
		}
	})

	t.Run("a mail without a Message-ID is read", func(t *testing.T) {
		withoutID := mail
		withoutID.MessageID = ""
		withoutID.InReplyTo = ""
		withoutID.References = nil
		payload, headers := fixture.Received(t, credentials, withoutID)
		result, err := provider.ParseWebhook(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseWebhook: %v", err)
		}
		msg, ok := result.(inboundprovider.Message)
		if !ok {
			t.Fatalf("result = %T, want Message", result)
		}
		if msg.MessageID != "" || len(msg.InReplyTo) != 0 || len(msg.References) != 0 {
			t.Fatalf("ids = (%q, %q, %q), want none", msg.MessageID, msg.InReplyTo, msg.References)
		}
	})

	t.Run("an unrelated request is ignored", func(t *testing.T) {
		payload, headers, ok := fixture.Unrelated(t, credentials)
		if !ok {
			t.Skip("the provider posts nothing but received mail")
		}
		result, err := provider.ParseWebhook(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseWebhook: %v", err)
		}
		if _, ok := result.(inboundprovider.Ignored); !ok {
			t.Fatalf("result = %T, want Ignored", result)
		}
	})

	t.Run("a request signed with other credentials is refused", func(t *testing.T) {
		payload, headers := fixture.Received(t, fixture.OtherCredentials(), mail)
		if _, err := provider.ParseWebhook(t.Context(), payload, headers, credentials); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
			t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
		}
	})

	t.Run("a request with no credentials stored is refused", func(t *testing.T) {
		payload, headers := fixture.Received(t, credentials, mail)
		if _, err := provider.ParseWebhook(t.Context(), payload, headers, inboundprovider.Credentials{}); !errors.Is(err, inboundprovider.ErrInvalidSignature) {
			t.Fatalf("ParseWebhook error = %v, want ErrInvalidSignature", err)
		}
	})
}
