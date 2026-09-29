import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiClient } from "#lib/api-client";
import { tenantIdSchema } from "#lib/auth-input";

/** The shape the API server's provider registry accepts as an id. */
const providerIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/u);

const webhookPathSchema = z.object({
  provider: providerIdSchema,
  tenantId: tenantIdSchema,
});

const notFound = () =>
  NextResponse.json({ error: "payment provider not found" }, { status: 404 });

/**
 * Answer the sender of a webhook from the API server's verdict: a status it
 * will not retry for a notification that can never be accepted, and one it
 * retries while the tenant or the server cannot take it yet.
 */
const answerWebhook = async (
  forward: () => Promise<unknown>
): Promise<NextResponse> => {
  try {
    await forward();
  } catch (error) {
    if (isRpcError(error, Code.NotFound)) {
      return notFound();
    }
    if (isRpcError(error, Code.InvalidArgument)) {
      return NextResponse.json({ error: "invalid webhook" }, { status: 400 });
    }
    if (
      isRpcError(error, Code.FailedPrecondition) ||
      isRpcError(error, Code.Unavailable)
    ) {
      return NextResponse.json(
        { error: "webhook processing is unavailable" },
        { status: 503 }
      );
    }
    rethrowUnclassifiedRpcError(error);
    return NextResponse.json(
      { error: "webhook processing failed" },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
};

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
  const path = webhookPathSchema.safeParse({ provider, tenantId });
  if (!path.success) {
    return path.error.issues.some((issue) => issue.path[0] === "provider")
      ? notFound()
      : NextResponse.json({ error: "invalid tenant path" }, { status: 400 });
  }

  const payload = new Uint8Array(await request.arrayBuffer());
  return answerWebhook(() =>
    apiClient.purchase.processPaymentWebhook({
      headers: Object.fromEntries(request.headers),
      payload,
      provider: path.data.provider,
      tenant: { tenantId: path.data.tenantId },
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
    return NextResponse.json({ error: "invalid tenant path" }, { status: 400 });
  }

  const payload = new Uint8Array(await request.arrayBuffer());
  return answerWebhook(() =>
    apiClient.purchase.processAppStoreNotification({
      payload,
      tenant: { tenantId: tenant.data },
    })
  );
};
