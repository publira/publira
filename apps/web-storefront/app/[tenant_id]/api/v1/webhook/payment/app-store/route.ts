import { forwardAppStoreNotification } from "#lib/payment-webhook";

/**
 * Tenant-scoped endpoint App Store Server Notifications V2 are sent to. A
 * static segment, so it answers before the `[provider]` route, whose provider
 * ids are the web payment providers'.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/webhook/payment/app-store">
) => {
  const { tenant_id } = await params;
  return forwardAppStoreNotification(request, { tenantId: tenant_id });
};
