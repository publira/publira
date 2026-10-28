import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { openGraphCardResponse } from "#lib/open-graph-card";

const paramsSchema = z.object({
  episode_id: routeParamString(),
  series_id: routeParamString(),
});

export const GET = async (
  _request: NextRequest,
  {
    params,
  }: RouteContext<"/[tenant_id]/[locale]/og/series/[series_id]/episodes/[episode_id]">
) => {
  const segments = await params;
  const parsed = parseRouteParams(paramsSchema, segments);
  return openGraphCardResponse(
    segments,
    parsed && {
      episodeId: parsed.episode_id,
      kind: "episode",
      seriesId: parsed.series_id,
    }
  );
};
