import { NextResponse } from "next/server";

import { apiClient } from "#lib/api-client";
import { tenantIdSchema } from "#lib/auth-input";
import {
  answerWebhook,
  invalidTenantPath,
  parseWebhookPath,
} from "#lib/webhook";

/**
 * Forward a payment provider's notification to the API server without
 * inspecting it: the exact bytes and every header go through, and the API
 * server picks the signature header the provider declares and verifies it.
 *
 * The same-origin check does not apply. A provider sends no browser session
 * cookie; the signature is what authenticates the request.
 */
export const forwardPaymentWebhook = async (
  request: Request,
  { provider, tenantId }: { provider: string; tenantId: string }
): Promise<NextResponse> => {
  const path = parseWebhookPath("payment", { provider, tenantId });
  if (path instanceof NextResponse) {
    return path;
  }

  const payload = new Uint8Array(await request.arrayBuffer());
  return answerWebhook("payment", () =>
    apiClient.purchase.processPaymentWebhook({
      headers: Object.fromEntries(request.headers),
      payload,
      provider: path.provider,
      tenant: { tenantId: path.tenantId },
    })
  );
};

/**
 * Forward an App Store Server Notifications V2 request to the API server
 * without inspecting it. The App Store is not one of the web payment providers
 * the tenant chooses between, so its notifications go to an RPC of their own,
 * which verifies the signed payload against Apple's root certificate.
 */
export const forwardAppStoreNotification = async (
  request: Request,
  { tenantId }: { tenantId: string }
): Promise<NextResponse> => {
  const tenant = tenantIdSchema.safeParse(tenantId);
  if (!tenant.success) {
    return invalidTenantPath();
  }

  const payload = new Uint8Array(await request.arrayBuffer());
  return answerWebhook("payment", () =>
    apiClient.purchase.processAppStoreNotification({
      payload,
      tenant: { tenantId: tenant.data },
    })
  );
};
