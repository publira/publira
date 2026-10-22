import type { Locale } from "@publira/i18n";
import { cachedReadFailure } from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import { z } from "zod";

import { apiClient } from "./api-client";
import {
  applyCacheTag,
  tenantCrawlerSettingsTag,
  tenantPagesTag,
} from "./cache-tags";
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
 * What the tenant's `robots.txt` excludes, as `GetTenantCrawlerSettings`
 * answers it: crawlers refused every path, and paths refused to every crawler,
 * each covering what lies under it.
 */
export interface CrawlerExclusions {
  paths: readonly string[];
  userAgents: readonly string[];
}

/** `slug` is `path` itself or lies under it. */
const isWithin = (slug: string, path: string): boolean =>
  slug === path || slug.startsWith(`${path}/`);

/**
 * Each path as itself, as the parent of further segments, and with a query,
 * bare and under every locale prefix. A plain prefix rule would also shut out
 * a published page whose slug merely starts the same way (`/my` and
 * `/mystery`).
 */
const pathPatterns = (
  supportedLocales: readonly Locale[],
  paths: readonly string[]
): string[] =>
  localePrefixes(supportedLocales).flatMap((prefix) =>
    paths.flatMap((path) => [
      `${prefix}${path}$`,
      `${prefix}${path}/`,
      `${prefix}${path}?`,
    ])
  );

/**
 * The published pages that take the place of a reader-only path, which the
 * proxy serves ahead of that screen (`/my`, `/notifications/help`). Each is
 * allowed as itself and with a query: a rule as long as the disallowing one
 * wins over it, so the screens beneath the page stay out of reach. A page
 * within a path the tenant excludes is not allowed again, since that Allow
 * would win over the tenant's own Disallow. An excluded path is written bare
 * as well as under each prefix, so `/en/my` is within `/my` and within an
 * excluded `/en/my` alike.
 */
const shadowingPagePatterns = (
  supportedLocales: readonly Locale[],
  publishedSlugs: readonly string[],
  excludedPaths: readonly string[]
): string[] => {
  const shadowing = publishedSlugs.filter((slug) =>
    READER_ONLY_PATHS.some((path) => isWithin(slug, path))
  );
  return localePrefixes(supportedLocales).flatMap((prefix) =>
    shadowing.flatMap((slug) =>
      excludedPaths.some(
        (path) => isWithin(slug, path) || isWithin(`${prefix}${slug}`, path)
      )
        ? []
        : [`${prefix}${slug}$`, `${prefix}${slug}?`]
    )
  );
};

/**
 * The group of every crawler the tenant has not excluded by name. A tenant
 * that excludes `/` refuses every page but the sitemap, which no exclusion may
 * close, in a group without `Allow: /`: that rule would tie with
 * `Disallow: /` and win.
 */
const everyCrawlerGroup = (
  supportedLocales: readonly Locale[],
  publishedSlugs: readonly string[],
  excludedPaths: readonly string[]
): string[] => {
  if (excludedPaths.includes("/")) {
    return [
      "User-agent: *",
      "Disallow: /",
      "Allow: /sitemap.xml$",
      "Allow: /sitemap/",
    ];
  }
  // An excluded path the reader-only paths already cover is written once.
  const disallowed = new Set([
    ...pathPatterns(supportedLocales, READER_ONLY_PATHS),
    ...pathPatterns(supportedLocales, excludedPaths),
  ]);
  return [
    "User-agent: *",
    "Allow: /",
    ...shadowingPagePatterns(
      supportedLocales,
      publishedSlugs,
      excludedPaths
    ).map((pattern) => `Allow: ${pattern}`),
    "Disallow: /api/",
    ...[...disallowed].map((pattern) => `Disallow: ${pattern}`),
  ];
};

/**
 * The tenant's `robots.txt`: the catalogue is open, the pages that belong to
 * one reader and the Route Handlers under `/api/` are not, and the sitemap is
 * named at `origin`. `supportedLocales` are the locales the tenant offers, and
 * `publishedSlugs` its published pages in storage form (`/privacy`).
 *
 * Each crawler in `exclusions` is a group of its own ahead of the `*` group,
 * since a crawler that finds a group naming it reads that group alone, and
 * each excluded path joins the `*` group's rules the way a reader-only path
 * does.
 */
export const buildRobotsTxt = (
  origin: string,
  supportedLocales: readonly Locale[],
  publishedSlugs: readonly string[],
  exclusions: CrawlerExclusions
): string =>
  [
    ...exclusions.userAgents.flatMap((userAgent) => [
      `User-agent: ${userAgent}`,
      "Disallow: /",
      "",
    ]),
    ...everyCrawlerGroup(supportedLocales, publishedSlugs, exclusions.paths),
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
 * What the tenant's `robots.txt` excludes, under a tag of its own that the
 * console's save drops. `ok: false` where the API could not be asked: "nothing
 * excluded" in its place would lift every exclusion in a file crawlers keep.
 */
export const getCrawlerExclusions = async (
  tenantId: string
): Promise<CachedReadResult<CrawlerExclusions>> => {
  // Shared public content: remote so multi-instance hosts share entries.
  "use cache: remote";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantCrawlerSettingsTag(normalizedTenantId));

  try {
    const response = await apiClient.tenant.getTenantCrawlerSettings({
      tenant: { tenantId: normalizedTenantId },
    });
    return {
      ok: true,
      value: {
        paths: response.excludedPaths ?? [],
        userAgents: response.excludedUserAgents ?? [],
      },
    };
  } catch (error) {
    // A cache fill must not throw, so every failure is reported as a value.
    console.warn("[web-storefront] getTenantCrawlerSettings failed", error);
    return cachedReadFailure("The crawler exclusions are unavailable.");
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
 * tenant whose address, pages, or exclusions are unavailable is a 503, so a
 * crawler retries rather than reading a file that names no sitemap, shuts out
 * a page, or lets in what the tenant excluded.
 */
export const respondWithRobotsTxt = async (
  params: unknown
): Promise<Response> => {
  const parsed = parseRouteParams(robotsRouteParamsSchema, params);
  if (!parsed) {
    return new Response("Not Found", { status: 404 });
  }

  const [tenant, origin, slugs, exclusions] = await Promise.all([
    getTenantSiteInfo(parsed.tenant_id),
    getTenantPublicOrigin(parsed.tenant_id),
    getPublishedPageSlugs(parsed.tenant_id),
    getCrawlerExclusions(parsed.tenant_id),
  ]);
  if (!(tenant && origin && slugs.ok && exclusions.ok)) {
    return new Response("Service Unavailable", {
      headers: { "Cache-Control": "no-store", "Retry-After": "30" },
      status: 503,
    });
  }

  return new Response(
    buildRobotsTxt(
      origin,
      tenant.supportedLocales,
      slugs.value,
      exclusions.value
    ),
    {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }
  );
};
