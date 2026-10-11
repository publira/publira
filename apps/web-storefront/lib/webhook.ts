import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { NextResponse } from "next/server";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";

/** The shape the API server's provider registries accept as an id. */
const providerIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/u);

const webhookPathSchema = z.object({
  provider: providerIdSchema,
  tenantId: tenantIdSchema,
});

/**
 * The kind segment of `/api/v1/webhook/<kind>/<provider>`, which names the
 * registry the provider is looked up in.
 */
export type WebhookKind = "email" | "payment";

const NOT_FOUND_MESSAGES: Record<WebhookKind, string> = {
  email: "inbound email provider not found",
  payment: "payment provider not found",
};

const notFound = (kind: WebhookKind) =>
  NextResponse.json({ error: NOT_FOUND_MESSAGES[kind] }, { status: 404 });

export const invalidTenantPath = () =>
  NextResponse.json({ error: "invalid tenant path" }, { status: 400 });

/**
 * The provider and tenant of a webhook path, or the answer for a path that
 * cannot name one: 404 for a provider id the API server could never have
 * registered, 400 for a malformed tenant segment.
 */
export const parseWebhookPath = (
  kind: WebhookKind,
  { provider, tenantId }: { provider: string; tenantId: string }
): { provider: string; tenantId: string } | NextResponse => {
  const path = webhookPathSchema.safeParse({ provider, tenantId });
  if (path.success) {
    return path.data;
  }
  return path.error.issues.some((issue) => issue.path[0] === "provider")
    ? notFound(kind)
    : invalidTenantPath();
};

/**
 * Answer the sender of a webhook from the API server's verdict: a status it
 * will not retry for a request that can never be accepted, and one it retries
 * while the tenant or the server cannot take it yet.
 */
export const answerWebhook = async (
  kind: WebhookKind,
  forward: () => Promise<unknown>
): Promise<NextResponse> => {
  try {
    await forward();
  } catch (error) {
    if (isRpcError(error, Code.NotFound)) {
      return notFound(kind);
    }
    if (isRpcError(error, Code.InvalidArgument)) {
      return NextResponse.json({ error: "invalid webhook" }, { status: 400 });
    }
    if (isRpcError(error, Code.Unauthenticated)) {
      return NextResponse.json(
        { error: "invalid webhook credentials" },
        { status: 401 }
      );
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
