// Package providers lists the payment providers this build ships.
package providers

import (
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
)

// Config builds a registry with [New]. The zero value has every provider call
// its own API.
type Config struct {
	// StripeAPIURL replaces the origin of Stripe's API, which is how the E2E
	// stack has the server call its fake of Stripe.
	StripeAPIURL string
}

// ConfigFromEnv reads PUBLIRA_STRIPE_API_URL. An unset variable keeps Stripe's
// own API, which is what every deployment calls.
func ConfigFromEnv() (Config, error) {
	const name = "PUBLIRA_STRIPE_API_URL"
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return Config{}, nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return Config{}, fmt.Errorf("%s must be an absolute http or https URL", name)
	}
	return Config{StripeAPIURL: raw}, nil
}

// New answers every payment provider a tenant may choose from, configured by
// cfg.
func New(cfg Config) *paymentprovider.Registry {
	var stripeOptions []stripe.Option
	if cfg.StripeAPIURL != "" {
		stripeOptions = append(stripeOptions, stripe.WithAPIURL(cfg.StripeAPIURL))
	}
	return paymentprovider.NewRegistry(
		payjp.New(),
		stripe.New(stripeOptions...),
	)
}

// Registry answers every payment provider a tenant may choose from, each
// calling its own API.
func Registry() *paymentprovider.Registry {
	return New(Config{})
}
