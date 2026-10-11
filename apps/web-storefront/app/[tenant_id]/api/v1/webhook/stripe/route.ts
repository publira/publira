import { forwardPaymentWebhook } from "#lib/payment-webhook";

/**
 * Deprecated alias of `/api/v1/webhook/payment/stripe`, kept because tenants
 * registered this URL in the Stripe Dashboard and Stripe does not follow a
 * redirect from a webhook endpoint.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/webhook/stripe">
) => {
  const { tenant_id } = await params;
  return forwardPaymentWebhook(request, {
    provider: "stripe",
    tenantId: tenant_id,
  });
};
