import type { NextRequest } from "next/server";

import { openGraphCardResponse } from "#lib/open-graph-card";

import { parseLabelDetailParams } from "../../../(site)/labels/[label_id]/_lib/search-params";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/[locale]/og/labels/[label_id]">
) => {
  const segments = await params;
  const labelId = parseLabelDetailParams(segments);
  return openGraphCardResponse(
    segments,
    labelId ? { kind: "label", labelId } : null
  );
};
