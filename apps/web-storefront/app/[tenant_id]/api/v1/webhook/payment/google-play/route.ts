import { forwardGooglePlayNotification } from "#lib/payment-webhook";

/**
 * Tenant-scoped endpoint Cloud Pub/Sub pushes Google Play real-time developer
 * notifications to. A static segment, so it answers before the `[provider]`
 * route, whose provider ids are the web payment providers'.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/webhook/payment/google-play">
) => {
  const { tenant_id } = await params;

  return forwardGooglePlayNotification(request, { tenantId: tenant_id });
};
