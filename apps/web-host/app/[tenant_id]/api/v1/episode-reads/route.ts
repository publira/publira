import { NextResponse } from "next/server";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import { isSameOriginRequest } from "#lib/csrf";
import { recordEpisodeRead } from "#lib/episode-reads";

const episodeReadPathSchema = z.object({ tenantId: tenantIdSchema });

const episodeReadBodySchema = z.object({
  publicId: z.string().trim().min(1).max(64),
});

const noContent = () => new NextResponse(null, { status: 204 });

/**
 * The reader finished an episode, sent by `navigator.sendBeacon` from the
 * viewer the moment its last page is on screen.
 *
 * A beacon rather than a Server Action: the reader is shown nothing about the
 * record, so the response is a bare 204 rather than a re-render of the route,
 * and the browser delivers it even when the reader closes the episode straight
 * after the last page. Nothing here is reported back, which is also why the
 * viewer's own suppression only counts what it has already sent.
 *
 * The tenant comes from the segment the proxy rewrote onto this request, not
 * from the beacon body: the sender must not get to choose whose catalog its
 * read is filed under. Who the reader is comes from the session cookie the
 * beacon carries, never from the body.
 *
 * #600's Origin check applies here for that reason — without it any page on
 * the web could file reads against this reader's account.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/episode-reads">
) => {
  if (!isSameOriginRequest(request.headers)) {
    return new NextResponse(null, { status: 403 });
  }

  const { tenant_id } = await params;
  const path = episodeReadPathSchema.safeParse({ tenantId: tenant_id });
  if (!path.success) {
    return NextResponse.json({ error: "invalid tenant path" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const body = episodeReadBodySchema.safeParse(payload);
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  await recordEpisodeRead({
    publicId: body.data.publicId,
    tenantId: path.data.tenantId,
  });
  return noContent();
};
