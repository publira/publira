import { routeParamString } from "@publira/utils/route-params";
import { NextResponse } from "next/server";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import { isSameOriginRequest } from "#lib/csrf";
import { recordEpisodeRead } from "#lib/episode-reads";

/** Matches the bound the catalog's own public-id fields carry. */
const PUBLIC_ID_MAX_LENGTH = 64;

const episodeReadPathSchema = z.object({
  episodePublicId: routeParamString({ maxLength: PUBLIC_ID_MAX_LENGTH }),
  seriesPublicId: routeParamString({ maxLength: PUBLIC_ID_MAX_LENGTH }),
  tenantId: tenantIdSchema,
});

const noContent = () => new NextResponse(null, { status: 204 });

/**
 * The reader finished this episode, sent by `navigator.sendBeacon` from the
 * viewer the moment its last page is on screen.
 *
 * A beacon rather than a Server Action: the reader is shown nothing about the
 * record, so the response is a bare 204 rather than a re-render of the route,
 * and the browser delivers it even when the reader closes the episode straight
 * after the last page. Nothing here is reported back, which is also why the
 * viewer's own suppression only counts what it has already sent.
 *
 * Everything the write is filed under comes from the path or the session, and
 * nothing from the request body — the sender must not get to choose whose
 * catalog its read lands in, nor whose account. The series segment addresses
 * the episode the way the reader's own URL does; the RPC identifies the
 * episode by its public id alone, and the API re-checks publication and
 * paid-body access on the write itself.
 *
 * #600's Origin check applies here for that reason: without it any page on the
 * web could file reads against this reader's account.
 */
export const POST = async (
  request: Request,
  {
    params,
  }: RouteContext<"/[tenant_id]/api/v1/series/[series_id]/episodes/[episode_id]/read">
) => {
  if (!isSameOriginRequest(request.headers)) {
    return new NextResponse(null, { status: 403 });
  }

  const { episode_id, series_id, tenant_id } = await params;
  const path = episodeReadPathSchema.safeParse({
    episodePublicId: episode_id,
    seriesPublicId: series_id,
    tenantId: tenant_id,
  });
  if (!path.success) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  await recordEpisodeRead({
    publicId: path.data.episodePublicId,
    tenantId: path.data.tenantId,
  });
  return noContent();
};
