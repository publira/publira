import { NextResponse } from "next/server";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import { isSameOriginRequest } from "#lib/csrf";
import { contentViewKinds, recordContentView } from "#lib/view-events";

const viewPathSchema = z.object({ tenantId: tenantIdSchema });

const viewBodySchema = z.object({
  kind: z.enum(contentViewKinds),
  publicId: z.string().trim().min(1).max(64),
});

const noContent = () => new NextResponse(null, { status: 204 });

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
 * #600's Origin check applies here. The beacon carries the reader's cookies,
 * so without it any page on the web could file views against this tenant.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/views">
) => {
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
