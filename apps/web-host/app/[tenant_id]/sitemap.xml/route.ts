import type { NextRequest } from "next/server";

import { respondWithSitemap } from "#lib/sitemap";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/sitemap.xml">
) => respondWithSitemap(await params);
