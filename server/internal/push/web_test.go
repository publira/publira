package push

import (
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
