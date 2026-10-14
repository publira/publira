import type { Locale } from "@publira/i18n";
import { cachedReadFailure } from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import { z } from "zod";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantPagesTag } from "./cache-tags";
import {
  ACCOUNT_FLOW_PATHS,
  GUEST_ONLY_PATHS,
  MEMBER_PATH_PREFIXES,
} from "./reader-paths";
import { getTenantPublicOrigin, getTenantSiteInfo } from "./tenant";
import { isTenantIdFormat } from "./tenant-id-format";

const READER_ONLY_PATHS = [
  ...MEMBER_PATH_PREFIXES,
  ...GUEST_ONLY_PATHS,
  ...ACCOUNT_FLOW_PATHS,
];

/**
 * The unprefixed path and a prefix per locale the tenant offers. A prefix the
 * tenant does not offer redirects to the unprefixed path, which these rules
 * already cover.
 */
const localePrefixes = (supportedLocales: readonly Locale[]): string[] => [
  "",
  ...supportedLocales.map((locale) => `/${locale}`),
];

/**
 * Each reader-only path as itself, as the parent of further segments, and with
 * a query, bare and under every locale prefix. A plain prefix rule would also
 * shut out a published page whose slug merely starts the same way (`/my` and
 * `/mystery`).
 */
const readerOnlyPatterns = (supportedLocales: readonly Locale[]): string[] =>
  localePrefixes(supportedLocales).flatMap((prefix) =>
    READER_ONLY_PATHS.flatMap((path) => [
      `${prefix}${path}$`,
      `${prefix}${path}/`,
      `${prefix}${path}?`,
    ])
  );

/**
 * The published pages that take the place of a reader-only path, which the
 * proxy serves ahead of that screen (`/my`, `/notifications/help`). Each is
 * allowed as itself and with a query: a rule as long as the disallowing one
 * wins over it, so the screens beneath the page stay out of reach.
 */
const shadowingPagePatterns = (
  supportedLocales: readonly Locale[],
  publishedSlugs: readonly string[]
): string[] => {
  const shadowing = publishedSlugs.filter((slug) =>
    READER_ONLY_PATHS.some(
      (path) => slug === path || slug.startsWith(`${path}/`)
    )
  );
  return localePrefixes(supportedLocales).flatMap((prefix) =>
    shadowing.flatMap((slug) => [`${prefix}${slug}$`, `${prefix}${slug}?`])
  );
};

/**
 * The tenant's `robots.txt`: the catalogue is open, the pages that belong to
 * one reader and the Route Handlers under `/api/` are not, and the sitemap is
 * named at `origin`. `supportedLocales` are the locales the tenant offers, and
 * `publishedSlugs` its published pages in storage form (`/privacy`).
 */
export const buildRobotsTxt = (
  origin: string,
  supportedLocales: readonly Locale[],
  publishedSlugs: readonly string[]
): string =>
  [
    "User-agent: *",
    "Allow: /",
    ...shadowingPagePatterns(supportedLocales, publishedSlugs).map(
      (pattern) => `Allow: ${pattern}`
    ),
    "Disallow: /api/",
    ...readerOnlyPatterns(supportedLocales).map(
      (pattern) => `Disallow: ${pattern}`
    ),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

/**
 * Every path the tenant serves a published page at, under the tag a page's
 * publication drops. `ok: false` where the API could not be asked.
 */
export const getPublishedPageSlugs = async (
  tenantId: string
): Promise<CachedReadResult<string[]>> => {
  // Shared public content: remote so multi-instance hosts share entries.
  "use cache: remote";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantPagesTag(normalizedTenantId));

  try {
    const response = await apiClient.pages.listPublishedPageSlugs({
      tenant: { tenantId: normalizedTenantId },
    });
    return { ok: true, value: response.slugs ?? [] };
  } catch (error) {
    // A cache fill must not throw, so every failure is reported as a value.
    console.warn("[web-storefront] listPublishedPageSlugs failed", error);
    return cachedReadFailure("The published pages are unavailable.");
  }
};

/**
 * The rewritten `[tenant_id]` segment. A value that is not a tenant UUID
 * means the request bypassed `proxy.ts`, so there is no tenant to answer for.
 */
const robotsRouteParamsSchema = z.object({
  tenant_id: routeParamString().refine(isTenantIdFormat),
});

/**
 * Answer `robots.txt` for the tenant `proxy.ts` rewrote the request onto. A
 * tenant whose address or pages are unavailable is a 503, so a crawler retries
 * rather than reading a file that names no sitemap or shuts out a page.
 */
export const respondWithRobotsTxt = async (
  params: unknown
): Promise<Response> => {
  const parsed = parseRouteParams(robotsRouteParamsSchema, params);
  if (!parsed) {
    return new Response("Not Found", { status: 404 });
  }

  const [tenant, origin, slugs] = await Promise.all([
    getTenantSiteInfo(parsed.tenant_id),
    getTenantPublicOrigin(parsed.tenant_id),
    getPublishedPageSlugs(parsed.tenant_id),
  ]);
  if (!(tenant && origin && slugs.ok)) {
    return new Response("Service Unavailable", {
      headers: { "Cache-Control": "no-store", "Retry-After": "30" },
      status: 503,
    });
  }

  return new Response(
    buildRobotsTxt(origin, tenant.supportedLocales, slugs.value),
    {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }
  );
};
