import { NextResponse } from "next/server";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import { isSameOriginRequest } from "#lib/csrf";
import { recordEpisodeRead } from "#lib/episode-reads";
import { recordIdSchema } from "#lib/record-id";

const episodeReadPathSchema = z.object({
  episodeId: recordIdSchema,
  tenantId: tenantIdSchema,
});

const noContent = () => new NextResponse(null, { status: 204 });

/**
 * The reader finished this episode, sent by a `keepalive` fetch from the
 * viewer the moment its last page is on screen.
 *
 * A plain request rather than a Server Action: the reader is shown nothing
 * about the record, so the response is a bare 204 rather than a re-render of
 * the route, and `keepalive` delivers it even when the reader leaves the
 * episode straight after the last page. The viewer reads only whether an
 * answer came, and sends again after a failure, which a re-read already
 * tolerates.
 *
 * Everything the write is filed under comes from the path or the session, and
 * nothing from the request body — the sender must not get to choose whose
 * catalog its read lands in, nor whose account. The path names the episode by
 * the ID its detail read returned, and the API re-checks publication and
 * paid-body access on the write itself.
 *
 * The same-origin check applies here for that reason: without it any page on the
 * web could file reads against this reader's account.
 */
export const POST = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/episodes/[episode_id]/read">
) => {
  if (!isSameOriginRequest(request.headers)) {
    return new NextResponse(null, { status: 403 });
  }

  const { episode_id, tenant_id } = await params;
  const path = episodeReadPathSchema.safeParse({
    episodeId: episode_id,
    tenantId: tenant_id,
  });
  if (!path.success) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  await recordEpisodeRead({
    episodeId: path.data.episodeId,
    tenantId: path.data.tenantId,
  });
  return noContent();
};
