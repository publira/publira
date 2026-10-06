// Package providers lists the inbound email providers this build ships.
package providers

import (
	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/resend"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid"
)

// Registry answers every inbound email provider a tenant may choose from.
func Registry() *inboundprovider.Registry {
	return inboundprovider.NewRegistry(
		resend.New(),
		sendgrid.New(),
	)
}
