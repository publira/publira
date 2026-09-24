import { forwardPaymentWebhook } from "#lib/payment-webhook";

/** Tenant-scoped endpoint every payment provider posts its notifications to. */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/webhook/payment/[provider]">
) => {
  const { provider, tenant_id } = await params;
  return forwardPaymentWebhook(request, { provider, tenantId: tenant_id });
};
