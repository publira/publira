import { forwardInboundEmailWebhook } from "#lib/inbound-email-webhook";

/** Tenant-scoped endpoint an inbound email provider posts a reader's reply to. */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/webhook/email/[provider]">
) => {
  const { provider, tenant_id } = await params;
  return forwardInboundEmailWebhook(request, { provider, tenantId: tenant_id });
};
