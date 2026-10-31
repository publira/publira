import {
  parseRouteParams,
  routeParamStringArray,
} from "@publira/utils/route-params";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { openGraphCardResponse } from "#lib/open-graph-card";

const paramsSchema = z.object({ slug: routeParamStringArray() });

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/[locale]/og/page/[...slug]">
) => {
  const segments = await params;
  const parsed = parseRouteParams(paramsSchema, segments);

  return openGraphCardResponse(
    segments,
    parsed && { kind: "page", slug: parsed.slug }
  );
};
