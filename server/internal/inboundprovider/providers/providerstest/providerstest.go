// Package providerstest holds the contract fixture of every provider
// [providers.Registry] registers.
package providerstest

import (
	"testing"

	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	"github.com/publira/publira/server/internal/inboundprovider/resend"
	"github.com/publira/publira/server/internal/inboundprovider/resend/resendtest"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid/sendgridtest"
)

var fixtures = map[string]func(testing.TB) inboundprovidertest.Fixture{
	resend.ID:   func(t testing.TB) inboundprovidertest.Fixture { return resendtest.NewFixture(t) },
	sendgrid.ID: func(testing.TB) inboundprovidertest.Fixture { return sendgridtest.Fixture{} },
}

// Fixture answers a new contract fixture of the provider registered as id,
// which lives as long as t.
func Fixture(t testing.TB, id string) (inboundprovidertest.Fixture, bool) {
	newFixture, ok := fixtures[id]
	if !ok {
		return nil, false
	}
	return newFixture(t), true
}
