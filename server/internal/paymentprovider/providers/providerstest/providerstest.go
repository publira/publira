// Package providerstest holds the contract fixture of every provider
// [providers.Registry] registers.
package providerstest

import (
	"testing"

	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/payjp/payjptest"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
)

var fixtures = map[string]func(testing.TB) paymentprovidertest.Fixture{
	payjp.ID:  func(t testing.TB) paymentprovidertest.Fixture { return payjptest.NewFixture(t) },
	stripe.ID: func(testing.TB) paymentprovidertest.Fixture { return stripetest.Fixture{} },
}

// Fixture answers a new contract fixture of the provider registered as id,
// which lives as long as t.
func Fixture(t testing.TB, id string) (paymentprovidertest.Fixture, bool) {
	newFixture, ok := fixtures[id]
	if !ok {
		return nil, false
	}
	return newFixture(t), true
}
