package push

import (
	"net"
	"net/http"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"
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
