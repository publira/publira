package providers_test

import (
	"context"
	"testing"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/providers/providerstest"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
)

func TestEveryRegisteredProviderReadsItsNotifications(t *testing.T) {
	for _, provider := range providers.Registry().Providers() {
		id := provider.Declaration().ID
		t.Run(id, func(t *testing.T) {
			fixture, ok := providerstest.Fixture(t, id)
			if !ok {
				t.Fatalf("provider %q has no contract fixture in providerstest", id)
			}
			paymentprovidertest.RunParse(t, fixture)
		})
	}
}

func TestConfigFromEnvReadsTheStripeAPIURL(t *testing.T) {
	t.Run("unset keeps Stripe's own API", func(t *testing.T) {
		t.Setenv("PUBLIRA_STRIPE_API_URL", "")
		cfg, err := providers.ConfigFromEnv()
		if err != nil {
			t.Fatalf("ConfigFromEnv: %v", err)
		}
		if cfg != (providers.Config{}) {
			t.Fatalf("cfg = %+v, want the zero value", cfg)
		}
	})

	t.Run("set replaces it", func(t *testing.T) {
		t.Setenv("PUBLIRA_STRIPE_API_URL", " http://127.0.0.1:8500 ")
		cfg, err := providers.ConfigFromEnv()
		if err != nil {
			t.Fatalf("ConfigFromEnv: %v", err)
		}
		if cfg.StripeAPIURL != "http://127.0.0.1:8500" {
			t.Fatalf("cfg = %+v", cfg)
		}
	})

	for _, value := range []string{"not a url", "127.0.0.1:8500", "ftp://127.0.0.1:8500", "http://"} {
		t.Run("refuses "+value, func(t *testing.T) {
			t.Setenv("PUBLIRA_STRIPE_API_URL", value)
			if _, err := providers.ConfigFromEnv(); err == nil {
				t.Fatalf("ConfigFromEnv(%q) = nil error, want one", value)
			}
		})
	}
}

func TestNewPointsStripeAtTheConfiguredAPI(t *testing.T) {
	api := stripetest.NewAPI(t)
	const secretKey = "sk_test_51ConfiguredAPIAAAA"
	api.SetPaymentIntent(secretKey, "pi_configured", 300, "JPY")

	provider, ok := providers.New(providers.Config{StripeAPIURL: api.URL()}).Lookup(stripe.ID)
	if !ok {
		t.Fatal("the registry has no Stripe provider")
	}
	refunded, err := provider.Refund(context.Background(), paymentprovider.Credentials{stripe.FieldSecretKey: secretKey}, paymentprovider.RefundRequest{
		PaymentID:      "pi_configured",
		IdempotencyKey: "refund-configured",
	})
	if err != nil || !refunded {
		t.Fatalf("Refund = %v, %v; want true, nil", refunded, err)
	}
	if got := api.RefundedTotal(secretKey, "pi_configured"); got != 300 {
		t.Fatalf("refunded on the configured API = %d, want 300", got)
	}
}
