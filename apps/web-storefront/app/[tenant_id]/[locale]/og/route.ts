import type { NextRequest } from "next/server";

import { openGraphCardResponse } from "#lib/open-graph-card";

/** The tenant's own card, which every page under `(site)` without one of its own unfurls into. */
export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/[locale]/og">
) => openGraphCardResponse(await params, { kind: "site" });
