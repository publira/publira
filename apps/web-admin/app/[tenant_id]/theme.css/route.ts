import { isPlaceholderStaticParam } from "@publira/utils/static-param-placeholder";
import { toPubliraThemeCssText } from "@publira/utils/theme-css-variables";
import type { NextRequest } from "next/server";

import { getTenantThemeColors } from "#lib/public-api";
import { isTenantIdFormat } from "#lib/tenant-id-format";

/** Browser / edge short cache; Next `"use cache"` + site tag handles invalidation. */
const CACHE_CONTROL =
  "public, max-age=30, s-maxage=30, stale-while-revalidate=60";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/theme.css">
) => {
  const { tenant_id: tenantId } = await params;

  // Route Handlers cannot use `next/root-params`, so the raw segment is read
  // here instead of via `getTenantId()`.
  // The placeholder appears while generating this route's static paths, and a
  // non-UUID segment means the request bypassed `proxy.ts`. `/favicon.ico`
  // itself is handled by `app/favicon.ico` (#646).
  const theme =
    isPlaceholderStaticParam(tenantId) || !isTenantIdFormat(tenantId)
      ? null
      : await getTenantThemeColors(tenantId.trim());
  const body = toPubliraThemeCssText(theme);

  return new Response(body, {
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Content-Type": "text/css; charset=utf-8",
    },
  });
};
