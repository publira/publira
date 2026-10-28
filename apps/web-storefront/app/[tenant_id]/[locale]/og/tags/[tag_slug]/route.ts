import type { NextRequest } from "next/server";

import { openGraphCardResponse } from "#lib/open-graph-card";

import { parseTagDetailParams } from "../../../(site)/tags/[tag_slug]/_lib/search-params";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/[locale]/og/tags/[tag_slug]">
) => {
  const segments = await params;
  const tagSlug = parseTagDetailParams(segments);
  return openGraphCardResponse(
    segments,
    tagSlug ? { kind: "tag", tagSlug } : null
  );
};
