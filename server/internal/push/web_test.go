package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/golang-jwt/jwt/v5"
)

func TestNewWebPushClientValidatesVAPIDKeyPair(t *testing.T) {
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("GenerateVAPIDKeys: %v", err)
	}
	if _, err := NewWebPushClient(WebPushConfig{
		VAPIDPublicKey: publicKey, VAPIDPrivateKey: privateKey, Subscriber: "mailto:push@example.test",
	}); err != nil {
		t.Fatalf("NewWebPushClient: %v", err)
	}
	if _, err := NewWebPushClient(WebPushConfig{
		VAPIDPublicKey: publicKey, VAPIDPrivateKey: "not-a-key", Subscriber: "mailto:push@example.test",
	}); err == nil {
		t.Fatal("NewWebPushClient error = nil, want invalid key rejection")
	}
}

// The sub claim is the contact a push service reaches the operator at, so it
// has to be the subject as saved, in either form RFC 8292 allows.
func TestWebPushClientSignsTheSubjectAsConfigured(t *testing.T) {
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("GenerateVAPIDKeys: %v", err)
	}
	browserKey, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	subscription := WebPushSubscription{
		P256dh: base64.RawURLEncoding.EncodeToString(browserKey.PublicKey().Bytes()),
		Auth:   base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
	}

	for _, subject := range []string{"mailto:push@example.test", "https://example.test/contact"} {
		t.Run(subject, func(t *testing.T) {
			authorization := make(chan string, 1)
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				authorization <- r.Header.Get("Authorization")
				w.WriteHeader(http.StatusCreated)
			}))
			defer server.Close()

			client, err := NewWebPushClient(WebPushConfig{VAPIDPublicKey: publicKey, VAPIDPrivateKey: privateKey, Subscriber: subject})
			if err != nil {
				t.Fatalf("NewWebPushClient: %v", err)
			}
			client.options.HTTPClient = server.Client()
			subscription.Endpoint = server.URL
			if err := client.Send(context.Background(), subscription, WebPushMessage{Title: "New episode"}); err != nil {
				t.Fatalf("Send: %v", err)
			}

			token, _, _ := strings.Cut(strings.TrimPrefix(<-authorization, "vapid t="), ", k=")
			claims := jwt.MapClaims{}
			if _, _, err := jwt.NewParser().ParseUnverified(token, claims); err != nil {
				t.Fatalf("parse the VAPID token: %v", err)
			}
			if sub, err := claims.GetSubject(); err != nil || sub != subject {
				t.Fatalf("sub = %q, %v; want %q", sub, err, subject)
			}
		})
	}
}

func TestValidateWebPushEndpoint(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		valid    bool
	}{
		{name: "HTTPS endpoint", endpoint: "https://push.example.test/subscription", valid: true},
		{name: "HTTP endpoint", endpoint: "http://push.example.test/subscription"},
		{name: "relative endpoint", endpoint: "/subscription"},
		{name: "credentials", endpoint: "https://reader:secret@push.example.test/subscription"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ValidateWebPushEndpoint(tt.endpoint)
			if (err == nil) != tt.valid {
				t.Fatalf("ValidateWebPushEndpoint(%q) error = %v, valid = %t", tt.endpoint, err, tt.valid)
			}
		})
	}
}

func TestWebPushTransportDoesNotFollowRedirects(t *testing.T) {
	client := newWebPushHTTPClient()
	if err := client.CheckRedirect(nil, nil); err != http.ErrUseLastResponse {
		t.Fatalf("CheckRedirect error = %v, want %v", err, http.ErrUseLastResponse)
	}
}

func TestIsPublicAddress(t *testing.T) {
	tests := []struct {
		address string
		public  bool
	}{
		{address: "8.8.8.8", public: true},
		{address: "127.0.0.1"},
		{address: "10.0.0.1"},
		{address: "100.100.100.200"},
		{address: "169.254.0.1"},
		{address: "::1"},
		{address: "fc00::1"},
	}
	for _, tt := range tests {
		t.Run(tt.address, func(t *testing.T) {
			if got := isPublicAddress(net.ParseIP(tt.address)); got != tt.public {
				t.Fatalf("isPublicAddress(%s) = %t, want %t", tt.address, got, tt.public)
			}
		})
	}
}
