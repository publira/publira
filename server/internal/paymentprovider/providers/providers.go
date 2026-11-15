// Package providers lists the payment providers this build ships.
package providers

import (
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paidy"
	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/paypay"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
)

// Config builds a registry with [New]. The zero value has every provider call
// its own API.
type Config struct {
	// StripeAPIURL replaces the origin of Stripe's API, which is how the E2E
	// stack has the server call its fake of Stripe.
	StripeAPIURL string
	// PaidyAPIURL replaces the origin of Paidy's API, as StripeAPIURL does
	// Stripe's.
	PaidyAPIURL string
}

// ConfigFromEnv reads PUBLIRA_STRIPE_API_URL and PUBLIRA_PAIDY_API_URL. An
// unset variable keeps the provider's own API, which is what every deployment
// calls.
func ConfigFromEnv() (Config, error) {
	stripeAPIURL, err := apiURLFromEnv("PUBLIRA_STRIPE_API_URL")
	if err != nil {
		return Config{}, err
	}
	paidyAPIURL, err := apiURLFromEnv("PUBLIRA_PAIDY_API_URL")
	if err != nil {
		return Config{}, err
	}
	return Config{StripeAPIURL: stripeAPIURL, PaidyAPIURL: paidyAPIURL}, nil
}

// apiURLFromEnv reads the origin the variable name holds, which is empty when
// it is unset.
func apiURLFromEnv(name string) (string, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return "", nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", fmt.Errorf("%s must be an absolute http or https URL", name)
	}
	return raw, nil
}

// New answers every payment provider a tenant may choose from, configured by
// cfg.
func New(cfg Config) *paymentprovider.Registry {
	var stripeOptions []stripe.Option
	if cfg.StripeAPIURL != "" {
		stripeOptions = append(stripeOptions, stripe.WithAPIURL(cfg.StripeAPIURL))
	}
	var paidyOptions []paidy.Option
	if cfg.PaidyAPIURL != "" {
		paidyOptions = append(paidyOptions, paidy.WithAPIURL(cfg.PaidyAPIURL))
	}
	return paymentprovider.NewRegistry(
		paidy.New(paidyOptions...),
		payjp.New(),
		paypay.New(),
		stripe.New(stripeOptions...),
	)
}

// Registry answers every payment provider a tenant may choose from, each
// calling its own API.
func Registry() *paymentprovider.Registry {
	return New(Config{})
}
