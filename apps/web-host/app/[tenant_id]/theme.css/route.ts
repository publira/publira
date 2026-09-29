import { isPlaceholderStaticParam } from "@publira/utils/static-param-placeholder";
import { toPubliraThemeCssText } from "@publira/utils/theme-css-variables";
import type { NextRequest } from "next/server";

import { getTenantTheme } from "#lib/tenant";
import { isTenantIdFormat } from "#lib/tenant-id-format";

/** Browser / edge short cache; Next `"use cache"` + theme tag handles invalidation. */
const CACHE_CONTROL =
  "public, max-age=30, s-maxage=30, stale-while-revalidate=60";

const cssResponse = (body: string) =>
  new Response(body, {
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Content-Type": "text/css; charset=utf-8",
    },
  });

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/theme.css">
) => {
  const { tenant_id: tenantId } = await params;

  // Route Handlers cannot use `next/root-params`, so the raw segment is read
  // here instead of via `getTenantId()`.
  // The placeholder appears while generating this route's static paths, and a
  // non-UUID segment means the request bypassed `proxy.ts` (e.g. /favicon.ico).
  // Either way there is no tenant: serve the default theme rather than calling
  // the API with a value it will reject.
  if (isPlaceholderStaticParam(tenantId) || !isTenantIdFormat(tenantId)) {
    return cssResponse(toPubliraThemeCssText(null));
  }

  const theme = await getTenantTheme(tenantId.trim());
  return cssResponse(toPubliraThemeCssText(theme));
};
