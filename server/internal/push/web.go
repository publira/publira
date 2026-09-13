package push

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

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
		HTTPClient:      newWebPushHTTPClient(),
	}
	if err := ValidateWebPushConfig(cfg); err != nil {
		return nil, err
	}
	return &WebPushClient{options: options}, nil
}

// ValidateWebPushConfig ensures that a process will not advertise Web Push
// when its VAPID credentials cannot sign deliveries.
func ValidateWebPushConfig(cfg WebPushConfig) error {
	if strings.TrimSpace(cfg.Subscriber) == "" || strings.TrimSpace(cfg.VAPIDPublicKey) == "" || strings.TrimSpace(cfg.VAPIDPrivateKey) == "" {
		return errors.New("push: Web Push VAPID configuration is incomplete")
	}
	return validateVAPIDKeyPair(strings.TrimSpace(cfg.VAPIDPublicKey), strings.TrimSpace(cfg.VAPIDPrivateKey))
}

// ValidateWebPushEndpoint accepts only absolute HTTPS subscription URLs. The
// sender also resolves and filters the host on every dial, because DNS can
// change after registration.
func ValidateWebPushEndpoint(raw string) (string, error) {
	endpoint := strings.TrimSpace(raw)
	parsed, err := url.ParseRequestURI(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return "", errors.New("push: Web Push endpoint must be an absolute HTTPS URL")
	}
	return endpoint, nil
}

func newWebPushHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{
			Proxy:       nil,
			DialContext: dialPublicAddress,
		},
	}
}

func dialPublicAddress(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("push: split endpoint address: %w", err)
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("push: resolve endpoint host: %w", err)
	}
	dialer := &net.Dialer{}
	var lastErr error
	for _, address := range addresses {
		if !isPublicAddress(address.IP) {
			lastErr = fmt.Errorf("push: endpoint resolves to a restricted address")
			continue
		}
		connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(address.IP.String(), port))
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("push: endpoint host resolves to no addresses")
}

func isPublicAddress(address net.IP) bool {
	return !address.IsLoopback() && !address.IsPrivate() && !address.IsLinkLocalUnicast() && !address.IsLinkLocalMulticast() && !address.IsMulticast() && !address.IsUnspecified()
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
	endpoint, err := ValidateWebPushEndpoint(subscription.Endpoint)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("push: encode Web Push message: %w", err)
	}
	response, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: endpoint,
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
