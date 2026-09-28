import type { NextRequest } from "next/server";

import { respondWithRobotsTxt } from "#lib/robots";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/robots.txt">
) => respondWithRobotsTxt(await params);
