import { toPubliraThemeCssText } from "@publira/utils/theme-css-variables";
import type { NextRequest } from "next/server";

import { getTenantSiteInfo } from "#lib/tenant";

/** Browser / edge short cache; Next `"use cache"` + site tag handles invalidation. */
const CACHE_CONTROL =
  "public, max-age=30, s-maxage=30, stale-while-revalidate=60";

interface RouteContext {
  params: Promise<{ tenant_id: string }>;
}

export const GET = async (_request: NextRequest, { params }: RouteContext) => {
  const { tenant_id: tenantId } = await params;
  const info = await getTenantSiteInfo(tenantId.trim());
  const body = toPubliraThemeCssText(info?.theme ?? null);

  return new Response(body, {
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Content-Type": "text/css; charset=utf-8",
    },
  });
};
