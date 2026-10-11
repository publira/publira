import type { NextRequest } from "next/server";

import { respondWithSitemapFile } from "#lib/sitemap";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/sitemap/[sitemap_id]">
) => respondWithSitemapFile(await params);
