import { getLocales } from "@publira/i18n";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import { z } from "zod";

import {
  ACCOUNT_FLOW_PATHS,
  GUEST_ONLY_PATHS,
  MEMBER_PATH_PREFIXES,
} from "./reader-paths";
import { getTenantPublicOrigin } from "./tenant";
import { isTenantIdFormat } from "./tenant-id-format";

const READER_ONLY_PATHS = [
  ...MEMBER_PATH_PREFIXES,
  ...GUEST_ONLY_PATHS,
  ...ACCOUNT_FLOW_PATHS,
];

/**
 * Each reader-only path as itself, as the parent of further segments, and with
 * a query, bare and under every locale prefix. A plain prefix rule would also
 * shut out a published page whose slug merely starts the same way (`/my` and
 * `/mystery`).
 */
const readerOnlyPatterns = (): string[] =>
  ["", ...getLocales().map((locale) => `/${locale}`)].flatMap((prefix) =>
    READER_ONLY_PATHS.flatMap((path) => [
      `${prefix}${path}$`,
      `${prefix}${path}/`,
      `${prefix}${path}?`,
    ])
  );

/**
 * The tenant's `robots.txt`: the catalogue is open, the pages that belong to
 * one reader and the Route Handlers under `/api/` are not, and the sitemap is
 * named at `origin`.
 */
export const buildRobotsTxt = (origin: string): string =>
  [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    ...readerOnlyPatterns().map((pattern) => `Disallow: ${pattern}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

/**
 * The rewritten `[tenant_id]` segment. A value that is not a tenant UUID
 * means the request bypassed `proxy.ts`, so there is no tenant to answer for.
 */
const robotsRouteParamsSchema = z.object({
  tenant_id: routeParamString().refine(isTenantIdFormat),
});

/**
 * Answer `robots.txt` for the tenant `proxy.ts` rewrote the request onto. A
 * tenant whose address is unavailable is a 503, so a crawler retries rather
 * than reading a file that names no sitemap.
 */
export const respondWithRobotsTxt = async (
  params: unknown
): Promise<Response> => {
  const parsed = parseRouteParams(robotsRouteParamsSchema, params);
  if (!parsed) {
    return new Response("Not Found", { status: 404 });
  }

  const origin = await getTenantPublicOrigin(parsed.tenant_id);
  if (!origin) {
    return new Response("Service Unavailable", {
      headers: { "Cache-Control": "no-store", "Retry-After": "30" },
      status: 503,
    });
  }

  return new Response(buildRobotsTxt(origin), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
