// Package providerstest holds the contract fixture of every provider
// [providers.Registry] registers.
package providerstest

import (
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
)

var fixtures = map[string]paymentprovidertest.Fixture{
	stripe.ID: stripetest.Fixture{},
}

// Fixture answers the contract fixture of the provider registered as id.
func Fixture(id string) (paymentprovidertest.Fixture, bool) {
	fixture, ok := fixtures[id]
	return fixture, ok
}
