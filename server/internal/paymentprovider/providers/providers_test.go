package providers_test

import (
	"testing"

	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/providers/providerstest"
)

func TestEveryRegisteredProviderReadsItsRecordedNotifications(t *testing.T) {
	for _, provider := range providers.Registry().Providers() {
		id := provider.Declaration().ID
		t.Run(id, func(t *testing.T) {
			fixture, ok := providerstest.Fixture(id)
			if !ok {
				t.Fatalf("provider %q has no contract fixture in providerstest", id)
			}
			paymentprovidertest.RunParse(t, provider, fixture)
		})
	}
}
