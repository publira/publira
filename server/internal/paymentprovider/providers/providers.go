// Package providers lists the payment providers this build ships.
package providers

import (
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
)

// Registry answers every payment provider a tenant may choose from.
func Registry() *paymentprovider.Registry {
	return paymentprovider.NewRegistry(
		stripe.New(),
	)
}
