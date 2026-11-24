import { getClientAddress } from "@publira/utils/client-address";
import { NextResponse } from "next/server";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import { isSameOriginRequest } from "#lib/csrf";
import { recordIdSchema } from "#lib/record-id";
import { createViewBeaconLimiter } from "#lib/view-beacon-rate-limit";
import { contentViewKinds, recordContentView } from "#lib/view-events";

const chargeViewBeacon = createViewBeaconLimiter();

const viewPathSchema = z.object({ tenantId: tenantIdSchema });

const viewBodySchema = z.object({
  id: recordIdSchema,
  kind: z.enum(contentViewKinds),
});

const noContent = () => new NextResponse(null, { status: 204 });

/**
 * The `429` for a client past the view beacon's allowance, or `null` for one
 * within it. Every request for the path is counted, whatever it carries. A
 * client is the reader's address as the forwarded headers name it, the way the
 * search page counts one; a setting the address cannot be read with, such as a
 * malformed `PUBLIRA_TRUSTED_PROXIES`, answers `500`.
 */
const refuseOverLimit = async (
  request: Request
): Promise<NextResponse | null> => {
  let client: string;

  try {
    client = getClientAddress(request.headers) ?? "";
  } catch (error) {
    console.error("[web-storefront] cannot resolve the client address", error);

    return new NextResponse(null, { status: 500 });
  }

  const decision = await chargeViewBeacon(client);

  if (decision.allowed) {
    return null;
  }

  return new NextResponse(null, {
    headers: { "Retry-After": String(decision.retryAfterSeconds) },
    status: 429,
  });
};

/**
 * The reader's own page view, sent by `navigator.sendBeacon` from the detail
 * page that was opened.
 *
 * A beacon rather than a Server Action: the browser queues it and delivers it
 * even if the reader navigates away immediately, and the response is a bare
 * 204 instead of a re-render of the route. It is also what keeps this endpoint
 * off the prefetch path — a prefetched page renders nothing that could send
 * one — and off the cache path, since the detail reads the page itself makes
 * are `"use cache"` and a hit never reaches the API.
 *
 * The tenant comes from the segment the proxy rewrote onto this request, not
 * from the beacon body: the sender must not get to choose whose catalog its
 * view is filed under.
 *
 * The same-origin check applies here. The beacon carries the reader's cookies,
 * so without it any page on the web could file views against this tenant.
 *
 * Each client's beacons are limited before anything else is read: one without
 * the actor cookie files a new viewer, so without the limit one client could
 * add viewers to any page as fast as it can send.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/views">
) => {
  const refused = await refuseOverLimit(request);

  if (refused) {
    return refused;
  }

  if (!isSameOriginRequest(request.headers)) {
    return new NextResponse(null, { status: 403 });
  }

  const { tenant_id } = await params;
  const path = viewPathSchema.safeParse({ tenantId: tenant_id });

  if (!path.success) {
    return NextResponse.json({ error: "invalid tenant path" }, { status: 400 });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const body = viewBodySchema.safeParse(payload);

  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  await recordContentView({ ...body.data, tenantId: path.data.tenantId });

  return noContent();
};
