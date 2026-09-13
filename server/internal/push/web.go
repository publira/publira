package push

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// ErrEndpointGone reports that a Web Push service has permanently removed a
// subscription endpoint.
var ErrEndpointGone = errors.New("push: subscription endpoint is no longer valid")

type WebPushConfig struct {
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	Subscriber      string
}

type WebPushSubscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

type WebPushMessage struct {
	Title string            `json:"title"`
	Body  string            `json:"body"`
	Data  map[string]string `json:"data,omitempty"`
}

type WebPushClient struct {
	options webpush.Options
}

func NewWebPushClient(cfg WebPushConfig) (*WebPushClient, error) {
	options := webpush.Options{
		Subscriber:      strings.TrimSpace(cfg.Subscriber),
		VAPIDPublicKey:  strings.TrimSpace(cfg.VAPIDPublicKey),
		VAPIDPrivateKey: strings.TrimSpace(cfg.VAPIDPrivateKey),
		TTL:             60,
	}
	if options.Subscriber == "" || options.VAPIDPublicKey == "" || options.VAPIDPrivateKey == "" {
		return nil, errors.New("push: Web Push VAPID configuration is incomplete")
	}
	if err := validateVAPIDKeyPair(options.VAPIDPublicKey, options.VAPIDPrivateKey); err != nil {
		return nil, err
	}
	return &WebPushClient{options: options}, nil
}

func validateVAPIDKeyPair(publicKey, privateKey string) error {
	public, err := base64.RawURLEncoding.DecodeString(publicKey)
	if err != nil {
		return fmt.Errorf("push: decode VAPID public key: %w", err)
	}
	private, err := base64.RawURLEncoding.DecodeString(privateKey)
	if err != nil {
		return fmt.Errorf("push: decode VAPID private key: %w", err)
	}
	curve := ecdh.P256()
	parsedPublic, err := curve.NewPublicKey(public)
	if err != nil {
		return fmt.Errorf("push: VAPID public key is not a P-256 point: %w", err)
	}
	parsedPrivate, err := curve.NewPrivateKey(private)
	if err != nil {
		return fmt.Errorf("push: VAPID private key is not a P-256 scalar: %w", err)
	}
	if !bytes.Equal(parsedPublic.Bytes(), parsedPrivate.PublicKey().Bytes()) {
		return errors.New("push: VAPID public and private keys do not match")
	}
	return nil
}

func (c *WebPushClient) Send(ctx context.Context, subscription WebPushSubscription, message WebPushMessage) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("push: encode Web Push message: %w", err)
	}
	response, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: strings.TrimSpace(subscription.Endpoint),
		Keys: webpush.Keys{
			P256dh: strings.TrimSpace(subscription.P256dh),
			Auth:   strings.TrimSpace(subscription.Auth),
		},
	}, &c.options)
	if err != nil {
		return fmt.Errorf("push: send Web Push: %w", err)
	}
	defer response.Body.Close() //nolint:errcheck
	if response.StatusCode == 410 {
		return ErrEndpointGone
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("push: Web Push returned HTTP %d", response.StatusCode)
	}
	return nil
}
