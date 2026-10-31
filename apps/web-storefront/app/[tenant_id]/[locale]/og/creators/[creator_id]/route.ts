import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { openGraphCardResponse } from "#lib/open-graph-card";

const paramsSchema = z.object({ creator_id: routeParamString() });

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/[locale]/og/creators/[creator_id]">
) => {
  const segments = await params;
  const parsed = parseRouteParams(paramsSchema, segments);

  return openGraphCardResponse(
    segments,
    parsed && { creatorId: parsed.creator_id, kind: "creator" }
  );
};
