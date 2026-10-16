// Package mime receives a mail posted whole: the RFC 5322 message as the
// request body, as message/rfc822. It is the provider for whatever can hand a
// received mail to an HTTPS endpoint and has no package of its own — a
// Cloudflare Email Worker, a Postfix pipe transport running curl, a script on
// a development machine.
//
// Nothing that posts this way signs what it posts, so the provider declares a
// token the tenant puts in the webhook URL as the password of its basic auth
// (`https://inbound:<token>@<storefront>/api/v1/webhook/email/mime`), and the
// sender sends it back as an Authorization header.
package mime

import (
	"context"
	"fmt"
	stdmime "mime"
	"net/http"

	"github.com/publira/publira/server/internal/inboundprovider"
)

const (
	// ID is the provider id stored in a tenant's inbound email settings.
	ID = "mime"

	// FieldWebhookToken is the credential field the provider declares: the
	// password of the basic auth in the webhook URL.
	FieldWebhookToken = "webhook_token"

	// HeaderEnvelopeTo is the request header that names the envelope
	// recipients, comma-separated, apart from the mail. A forwarded or
	// aliased mail no longer carries the address it was delivered to in its
	// To or Cc header, while whatever received it still knows it: a Cloudflare
	// Email Worker's message.to, Postfix's ${recipient}.
	HeaderEnvelopeTo = "X-Envelope-To"

	// ContentType is the media type the mail is posted as.
	ContentType = "message/rfc822"

	// maxBodyBytes bounds the mail, attachments included, which is the same
	// bound the SendGrid provider puts on the raw mail it is posted.
	maxBodyBytes = 32 << 20
)

// Provider reads a mail posted whole.
type Provider struct{}

// New answers the provider.
func New() *Provider {
	return &Provider{}
}

func (*Provider) Declaration() inboundprovider.Declaration {
	return inboundprovider.Declaration{
		ID:          ID,
		DisplayName: "Raw MIME over HTTPS",
		Fields: []inboundprovider.Field{
			{Name: FieldWebhookToken, Secret: true, Required: true},
		},
	}
}

// ParseWebhook reads the mail in the request body. The envelope recipients in
// [HeaderEnvelopeTo] come ahead of the ones its To and Cc headers name.
func (*Provider) ParseWebhook(_ context.Context, payload []byte, headers http.Header, credentials inboundprovider.Credentials) (inboundprovider.Result, error) {
	if !inboundprovider.BasicAuthorized(headers.Get("Authorization"), credentials[FieldWebhookToken]) {
		return nil, inboundprovider.ErrInvalidSignature
	}
	if mediaType, _, err := stdmime.ParseMediaType(headers.Get("Content-Type")); err != nil || mediaType != ContentType {
		return nil, fmt.Errorf("%w: the request is not %s", inboundprovider.ErrMalformedRequest, ContentType)
	}
	if len(payload) > maxBodyBytes {
		return nil, fmt.Errorf("%w: the mail is larger than %d bytes", inboundprovider.ErrMalformedRequest, maxBodyBytes)
	}

	header, text, err := inboundprovider.ReadMIME(payload)
	if err != nil {
		return nil, fmt.Errorf("%w: read the mail: %w", inboundprovider.ErrMalformedRequest, err)
	}
	msg := inboundprovider.Message{
		Text:        text,
		DeliveryKey: inboundprovider.HeaderDeliveryKey(inboundprovider.RawHeader(payload)),
	}
	for _, value := range headers.Values(HeaderEnvelopeTo) {
		msg.Recipients = inboundprovider.AppendRecipients(msg.Recipients, inboundprovider.ParseAddressList(value)...)
	}
	inboundprovider.ApplyHeader(&msg, header)
	if msg.From == "" {
		return nil, fmt.Errorf("%w: the mail names no sender", inboundprovider.ErrMalformedRequest)
	}
	msg.ID = msg.MessageID
	if msg.ID == "" {
		msg.ID = msg.DeliveryKey
	}
	return msg, nil
}
