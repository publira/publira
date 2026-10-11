import { NextResponse } from "next/server";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import { isSameOriginRequest } from "#lib/csrf";
import { saveReadingPosition } from "#lib/reading-position";
import { recordIdSchema } from "#lib/record-id";

const readingPositionPathSchema = z.object({
  episodeId: recordIdSchema,
  tenantId: tenantIdSchema,
});

/**
 * The page is the one value the sender chooses, so it is the one value that
 * comes from the body. Which episode it belongs to and whose position it is
 * are settled by the path and the session. The upper bound is the episode's
 * own page count, which only the API knows, and it refuses anything past it.
 */
const readingPositionBodySchema = z.object({
  pageIndex: z.number().int().min(0),
});

const noContent = () => new NextResponse(null, { status: 204 });

/**
 * Where the reader stopped in this episode, sent from the viewer by a
 * `keepalive` fetch as they settle on a page, and by `navigator.sendBeacon` as
 * the page goes away.
 *
 * A plain request rather than a Server Action, for the reasons the sibling
 * `read` endpoint gives: the reader is shown nothing about the record, so the
 * response is a bare 204 rather than a re-render of the route, and the browser
 * delivers it even when the reader closes the episode straight after the turn
 * that produced it.
 *
 * Everything the write is filed under comes from the path or the session — the
 * sender must not get to choose whose catalog its position lands in, nor whose
 * account. The path names the episode by the ID its detail read returned, and
 * the API re-checks publication and paid-body access on the write itself.
 *
 * The same-origin check applies here for that reason: without it any page on
 * the web could move this reader's position.
 */
export const POST = async (
  request: Request,
  {
    params,
  }: RouteContext<"/[tenant_id]/api/v1/episodes/[episode_id]/reading-position">
) => {
  if (!isSameOriginRequest(request.headers)) {
    return new NextResponse(null, { status: 403 });
  }

  const { episode_id, tenant_id } = await params;
  const path = readingPositionPathSchema.safeParse({
    episodeId: episode_id,
    tenantId: tenant_id,
  });
  if (!path.success) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const body = readingPositionBodySchema.safeParse(payload);
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  await saveReadingPosition({
    episodeId: path.data.episodeId,
    pageIndex: body.data.pageIndex,
    tenantId: path.data.tenantId,
  });
  return noContent();
};
