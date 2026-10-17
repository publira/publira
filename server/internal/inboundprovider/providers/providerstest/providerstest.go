// Package providerstest holds the contract fixture of every provider
// [providers.Registry] registers.
package providerstest

import (
	"testing"

	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	"github.com/publira/publira/server/internal/inboundprovider/mailgun"
	"github.com/publira/publira/server/internal/inboundprovider/mailgun/mailguntest"
	"github.com/publira/publira/server/internal/inboundprovider/mime"
	"github.com/publira/publira/server/internal/inboundprovider/mime/mimetest"
	"github.com/publira/publira/server/internal/inboundprovider/resend"
	"github.com/publira/publira/server/internal/inboundprovider/resend/resendtest"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid/sendgridtest"
	"github.com/publira/publira/server/internal/inboundprovider/ses"
	"github.com/publira/publira/server/internal/inboundprovider/ses/sestest"
)

var fixtures = map[string]func(testing.TB) inboundprovidertest.Fixture{
	mailgun.ID:  func(testing.TB) inboundprovidertest.Fixture { return mailguntest.Fixture{} },
	mime.ID:     func(testing.TB) inboundprovidertest.Fixture { return mimetest.Fixture{} },
	resend.ID:   func(t testing.TB) inboundprovidertest.Fixture { return resendtest.NewFixture(t) },
	sendgrid.ID: func(testing.TB) inboundprovidertest.Fixture { return sendgridtest.Fixture{} },
	// The S3 action is the one a reply with an attachment needs, and reads
	// through both fakes; the SNS action is covered by the provider's tests.
	ses.ID: func(t testing.TB) inboundprovidertest.Fixture { return sestest.NewFixture(t, sestest.ActionS3) },
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
