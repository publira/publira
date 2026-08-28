import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiClient } from "#lib/api-client";
import { tenantIdSchema } from "#lib/auth-input";

const webhookPathSchema = z.object({ tenantId: tenantIdSchema });

/**
 * Tenant-scoped Stripe endpoint. This BFF deliberately does not inspect the
 * event: it forwards the exact bytes and signature so the API server can
 * verify and fulfil the purchase with its server-side payment configuration.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/webhook/stripe">
) => {
  // #600's Origin check protects cookie-authenticated mutations. Stripe does
  // not send a browser session cookie; the API server verifies its signature.
  const { tenant_id } = await params;
  const path = webhookPathSchema.safeParse({ tenantId: tenant_id });
  if (!path.success) {
    return NextResponse.json({ error: "invalid tenant path" }, { status: 400 });
  }
  const { tenantId } = path.data;

  const payload = new Uint8Array(await request.arrayBuffer());
  try {
    await apiClient.purchase.processStripeWebhook({
      payload,
      stripeSignature: request.headers.get("stripe-signature") ?? "",
      tenant: { tenantId },
    });
  } catch (error) {
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
