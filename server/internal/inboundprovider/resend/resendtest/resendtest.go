// Package resendtest posts mail the way Resend does, and stands in for the
// receiving API the provider reads the mail from, for the inbound provider
// contract and the tests of the webhook.
package resendtest

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	"github.com/publira/publira/server/internal/inboundprovider/resend"
)

const (
	// APIKey and WebhookSecret are the credentials of the fixture's tenant.
	APIKey        = "re_contract_key"
	WebhookSecret = "whsec_Y29udHJhY3Qtc2lnbmluZy1zZWNyZXQ="
)

// Fixture is the Resend contract fixture, with a fake of the receiving API
// that answers the mail each request posted.
type Fixture struct {
	server *httptest.Server
	mu     sync.Mutex
	emails map[string][]byte
}

// NewFixture starts the fake API for as long as t lives.
func NewFixture(t testing.TB) *Fixture {
	t.Helper()
	f := &Fixture{emails: map[string][]byte{}}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	return f
}

// BaseURL is the origin of the fake API.
func (f *Fixture) BaseURL() string {
	return f.server.URL
}

func (f *Fixture) serve(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer "+APIKey {
		http.Error(w, `{"name":"validation_error","message":"API key is invalid"}`, http.StatusUnauthorized)
		return
	}
	id, ok := strings.CutPrefix(r.URL.Path, "/emails/receiving/")
	if r.Method != http.MethodGet || !ok {
		http.NotFound(w, r)
		return
	}
	f.mu.Lock()
	email, ok := f.emails[id]
	f.mu.Unlock()
	if !ok {
		http.Error(w, `{"name":"not_found","message":"Email not found"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(email)
}

// Hold makes the fake API answer email, a received email as the API returns
// it, under id.
func (f *Fixture) Hold(id string, email []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.emails[id] = email
}

func (f *Fixture) Provider() inboundprovider.Provider {
	return resend.New(resend.WithBaseURL(f.server.URL), resend.WithHTTPClient(f.server.Client()))
}

func (*Fixture) Credentials() inboundprovider.Credentials {
	return inboundprovider.Credentials{
		resend.FieldAPIKey:        APIKey,
		resend.FieldWebhookSecret: WebhookSecret,
	}
}

func (*Fixture) OtherCredentials() inboundprovider.Credentials {
	return inboundprovider.Credentials{
		resend.FieldAPIKey:        APIKey,
		resend.FieldWebhookSecret: "whsec_YW5vdGhlci1zaWduaW5nLXNlY3JldA==",
	}
}

func (f *Fixture) Received(t testing.TB, credentials inboundprovider.Credentials, mail inboundprovidertest.Mail) ([]byte, http.Header) {
	t.Helper()
	id := uuid.NewString()
	f.Hold(id, ReceivedEmail(t, id, mail))
	return Signed(t, credentials[resend.FieldWebhookSecret], EmailReceived(t, id, mail))
}

func (*Fixture) Unrelated(t testing.TB, credentials inboundprovider.Credentials) ([]byte, http.Header, bool) {
	t.Helper()
	payload := []byte(`{"type":"email.delivered","created_at":"2026-10-06T00:00:00.000Z","data":{"email_id":"` + uuid.NewString() + `"}}`)
	payload, headers := Signed(t, credentials[resend.FieldWebhookSecret], payload)
	return payload, headers, true
}

// EmailReceived answers the `email.received` event for mail stored as id.
func EmailReceived(t testing.TB, id string, mail inboundprovidertest.Mail) []byte {
	t.Helper()
	data := map[string]any{
		"email_id":   id,
		"created_at": "2026-10-06T00:00:00.000Z",
		"from":       mail.From,
		"to":         []string{mail.To},
		"cc":         []string{},
		"bcc":        []string{},
		"subject":    mail.Subject,
	}
	if mail.MessageID != "" {
		data["message_id"] = "<" + mail.MessageID + ">"
	}
	return marshal(t, map[string]any{
		"type":       resend.EventEmailReceived,
		"created_at": "2026-10-06T00:00:00.000Z",
		"data":       data,
	})
}

// ReceivedEmail answers mail as the receiving API returns it under id.
func ReceivedEmail(t testing.TB, id string, mail inboundprovidertest.Mail) []byte {
	t.Helper()
	headers := map[string]any{
		"from":    "Reader <" + mail.From + ">",
		"to":      mail.To,
		"subject": mail.Subject,
	}
	if mail.InReplyTo != "" {
		headers["in-reply-to"] = "<" + mail.InReplyTo + ">"
	}
	if len(mail.References) > 0 {
		refs := make([]string, 0, len(mail.References))
		for _, ref := range mail.References {
			refs = append(refs, "<"+ref+">")
		}
		headers["references"] = strings.Join(refs, " ")
	}
	email := map[string]any{
		"object":       "email",
		"id":           id,
		"to":           []string{mail.To},
		"from":         mail.From,
		"created_at":   "2026-10-06T00:00:00.000Z",
		"subject":      mail.Subject,
		"text":         mail.Text,
		"html":         nil,
		"headers":      headers,
		"bcc":          []string{},
		"cc":           []string{},
		"reply_to":     []string{},
		"received_for": []string{},
		"attachments":  []any{},
	}
	if mail.MessageID != "" {
		email["message_id"] = "<" + mail.MessageID + ">"
	}
	return marshal(t, email)
}

// Signed answers payload with the headers Svix sends it with, signed with
// secret now.
func Signed(t testing.TB, secret string, payload []byte) ([]byte, http.Header) {
	t.Helper()
	return payload, Sign(t, payload, secret, "msg_"+uuid.NewString(), time.Now())
}

// Sign answers the headers Svix sends payload with, signed with secret at
// timestamp under the request id.
func Sign(t testing.TB, payload []byte, secret, id string, timestamp time.Time) http.Header {
	t.Helper()
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil {
		t.Fatalf("decode signing secret: %v", err)
	}
	seconds := strconv.FormatInt(timestamp.Unix(), 10)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + seconds + "."))
	mac.Write(payload)
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	headers.Set("svix-id", id)
	headers.Set("svix-timestamp", seconds)
	headers.Set("svix-signature", "v1,"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	return headers
}

func marshal(t testing.TB, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return data
}
