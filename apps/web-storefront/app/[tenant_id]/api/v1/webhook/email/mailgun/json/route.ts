import { forwardInboundEmailWebhook } from "#lib/inbound-email-webhook";

/**
 * The endpoint a Mailgun Route forwards a reader's reply to. Mailgun posts the
 * mail as JSON, signed over the whole body, only to a URL ending in `json`.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/webhook/email/mailgun/json">
) => {
  const { tenant_id } = await params;
  return forwardInboundEmailWebhook(request, {
    provider: "mailgun",
    tenantId: tenant_id,
  });
};
