import { NextResponse } from "next/server";

import { apiClient } from "#lib/api-client";
import { answerWebhook, parseWebhookPath } from "#lib/webhook";

/**
 * The largest body forwarded, which is the largest payload
 * `ProcessInboundEmailWebhook` reads. SendGrid posts a mail with its
 * attachments, and with "POST the raw, full MIME message" on, the whole MIME
 * of a mail of up to its 30 MB limit.
 *
 * `experimental.proxyClientMaxBodySize` in `next.config.ts` sits one MiB above
 * this. `proxy.ts` runs on this route, and Next.js hands the route only the
 * part of a body it buffered for the proxy, cut at a chunk boundary without an
 * error; the margin keeps a cut body larger than this, so it is recognised
 * here rather than forwarded as a truncated mail.
 */
export const MAX_INBOUND_EMAIL_PAYLOAD_BYTES = 32 * 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super("inbound email webhook body exceeds the payload limit");
    this.name = "PayloadTooLargeError";
  }
}

/**
 * The request body, or `null` once it runs past `maxBytes`. Reading stops at
 * that point, so the route never holds more than the API server would read.
 */
const readBoundedBody = async (
  request: Request,
  maxBytes: number
): Promise<Uint8Array | null> => {
  if (!request.body) {
    return new Uint8Array();
  }

  let length = 0;
  const bounded = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        length += chunk.byteLength;
        if (length > maxBytes) {
          controller.error(new PayloadTooLargeError());
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
  try {
    return new Uint8Array(await new Response(bounded).arrayBuffer());
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return null;
    }
    throw error;
  }
};

/**
 * Forward an inbound email provider's request to the API server without
 * inspecting it: the exact bytes and every header go through — the content
 * type a multipart post is split by, SendGrid's basic auth token in
 * `Authorization`, Resend's Svix signature headers — and the API server
 * verifies and reads the mail with the credentials the provider declares.
 *
 * A body past {@link MAX_INBOUND_EMAIL_PAYLOAD_BYTES} is acknowledged and
 * dropped, as the API server does with a payload past the same bound: SendGrid
 * redelivers anything it is refused for three days, and a mail that size would
 * be refused every time.
 *
 * The same-origin check does not apply. A provider sends no browser session
 * cookie; the token or the signature is what authenticates the request.
 */
export const forwardInboundEmailWebhook = async (
  request: Request,
  { provider, tenantId }: { provider: string; tenantId: string }
): Promise<NextResponse> => {
  const path = parseWebhookPath("email", { provider, tenantId });
  if (path instanceof NextResponse) {
    return path;
  }

  const payload = await readBoundedBody(
    request,
    MAX_INBOUND_EMAIL_PAYLOAD_BYTES
  );
  if (!payload) {
    console.warn(
      "[web-host] inbound email webhook body exceeds the payload limit and was dropped",
      { provider: path.provider, tenantId: path.tenantId }
    );
    return new NextResponse(null, { status: 204 });
  }

  return answerWebhook("email", () =>
    apiClient.contact.processInboundEmailWebhook({
      headers: Object.fromEntries(request.headers),
      payload,
      provider: path.provider,
      tenant: { tenantId: path.tenantId },
    })
  );
};
