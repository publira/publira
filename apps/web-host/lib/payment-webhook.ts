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
  try {
    await apiClient.purchase.processPaymentWebhook({
      headers: Object.fromEntries(request.headers),
      payload,
      provider: path.data.provider,
      tenant: { tenantId: path.data.tenantId },
    });
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
