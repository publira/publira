import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { CursorWalkStop } from "@publira/api-client/pagination";
import { SitemapEntryKind } from "@publira/api-client/public/catalog";
import type { SitemapEntry } from "@publira/api-client/public/catalog";
import { isLocale } from "@publira/i18n";
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
  tenantCreatorsTag,
  tenantLabelsTag,
  tenantPagesTag,
  tenantSeriesDetailTag,
  tenantSeriesListTag,
} from "./cache-tags";
import { localeAlternates, publishedLocaleAlternates } from "./locale-path";
import { publishedPageHrefFromSlug } from "./pages";
import { getTenantPublicOrigin, getTenantSiteInfo } from "./tenant";
import { isTenantIdFormat } from "./tenant-id-format";

/** One page of the storefront a sitemap lists, as a bare path. */
export interface SitemapEntryItem {
  href: string;
  /** RFC 3339; absent where the rows behind the page keep no such time. */
  lastModifiedAt?: string;
  /**
   * The locales a series, an episode, or a page has a translation in, in
   * registry order. Absent for any other page, which is shown in every offered
   * locale.
   */
  publishedLocales?: readonly Locale[];
}

/**
 * Where the tenant publishes, which every URL of its sitemap is written at, and
 * the locales it publishes each page in.
 */
export interface SitemapAddress {
  defaultLocale: Locale;
  origin: string;
  /** In registry order, and always holding `defaultLocale`. */
  supportedLocales: readonly Locale[];
}

/**
 * The catalogue's own index pages, listed at the head of the first file. They
 * change with every entry below them, so they carry no time of their own.
 */
const CATALOGUE_INDEX_PATHS = [
  "/",
  "/series",
  "/ranking",
  "/labels",
  "/creators",
  "/genres",
] as const;

/** The protocol's limits on one sitemap file. */
export const SITEMAP_URL_LIMIT = 50_000;
export const SITEMAP_BYTE_LIMIT = 50 * 1024 * 1024;

/** Entries per API call while a file is filled. */
export const SITEMAP_PAGE_SIZE = 500;

/**
 * The longest path an entry can have: a page slug fills its 255-character
 * column. Written in every offered locale, it bounds what the next API page can
 * add to a file.
 */
const LONGEST_ENTRY: SitemapEntryItem = {
  href: `/${"a".repeat(254)}`,
  lastModifiedAt: "2026-01-01T00:00:00Z",
};

/** Far past any catalogue a tenant runs, and under the index's own limit. */
const MAX_SITEMAP_FILES = 1000;

/** The generated `SitemapEntry` fields {@link toSitemapEntryItem} reads. */
type RawSitemapEntry = Pick<
  SitemapEntry,
  | "kind"
  | "lastModifiedAt"
  | "publicId"
  | "publishedLocales"
  | "seriesPublicId"
  | "slug"
>;

const sitemapEntryHref = (entry: RawSitemapEntry): string | null => {
  const publicId = entry.publicId?.trim() ?? "";
  switch (entry.kind) {
    case SitemapEntryKind.SERIES: {
      return publicId ? `/series/${publicId}` : null;
    }
    case SitemapEntryKind.EPISODE: {
      const seriesPublicId = entry.seriesPublicId?.trim() ?? "";
      return publicId && seriesPublicId
        ? `/series/${seriesPublicId}/episodes/${publicId}`
        : null;
    }
    case SitemapEntryKind.LABEL: {
      return publicId ? `/labels/${publicId}` : null;
    }
    case SitemapEntryKind.CREATOR: {
      return publicId ? `/creators/${publicId}` : null;
    }
    case SitemapEntryKind.GENRE: {
      return publicId ? `/genres/${publicId}` : null;
    }
    case SitemapEntryKind.PAGE: {
      const href = publishedPageHrefFromSlug(entry.slug ?? "");
      return href === "/" ? null : href;
    }
    default: {
      return null;
    }
  }
};

/** The kinds whose page is written per locale, and so names its translations. */
const TRANSLATED_KINDS: ReadonlySet<SitemapEntryKind> = new Set([
  SitemapEntryKind.SERIES,
  SitemapEntryKind.EPISODE,
  SitemapEntryKind.PAGE,
]);

/**
 * The storefront path an entry names, and the locales it is translated into.
 * An entry missing the identifiers its URL is made of, or of a kind this build
 * does not know, is dropped rather than listed at a path that answers 404. So
 * is a series, an episode, or a page translated into no locale the tenant
 * offers: its page names no URL of its own to list.
 */
export const toSitemapEntryItem = (
  entry: RawSitemapEntry
): SitemapEntryItem[] => {
  const href = sitemapEntryHref(entry);
  if (!href) {
    return [];
  }

  const lastModifiedAt = entry.lastModifiedAt?.trim();
  const item: SitemapEntryItem = lastModifiedAt
    ? { href, lastModifiedAt }
    : { href };
  if (!TRANSLATED_KINDS.has(entry.kind)) {
    return [item];
  }

  const publishedLocales = [
    ...new Set((entry.publishedLocales ?? []).filter(isLocale)),
  ];
  return publishedLocales.length > 0 ? [{ ...item, publishedLocales }] : [];
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const absoluteUrl = (origin: string, href: string): string =>
  escapeXml(`${origin}${encodeURI(href)}`);

/**
 * The locales `entry` is listed in: those it is translated into that the
 * tenant offers, or every offered locale where it is not written per locale.
 */
const entryLocales = (
  { supportedLocales }: SitemapAddress,
  { publishedLocales }: SitemapEntryItem
): readonly Locale[] => {
  if (!publishedLocales) {
    return supportedLocales;
  }
  const translated = new Set(publishedLocales);
  return supportedLocales.filter((locale) => translated.has(locale));
};

/**
 * One `<url>` for each locale {@link entryLocales} lists `entry` in, each naming
 * the alternates the page at that URL names itself: every listed locale's URL
 * and `x-default`.
 */
const renderEntryUrls = (
  address: SitemapAddress,
  entry: SitemapEntryItem
): string => {
  const { defaultLocale, origin, supportedLocales } = address;
  const { href, lastModifiedAt, publishedLocales } = entry;
  const locales = entryLocales(address, entry);
  const lastmod = lastModifiedAt
    ? `<lastmod>${escapeXml(lastModifiedAt)}</lastmod>`
    : "";
  // Its URLs name the same alternates but for `x-default`, which is either
  // shared or each URL's own, so the links are written once per `x-default`.
  const linkSets = new Map<string, string>();
  return locales
    .map((locale) => {
      const { canonical, languages } = publishedLocales
        ? publishedLocaleAlternates(
            defaultLocale,
            supportedLocales,
            href,
            locales,
            locale
          )
        : localeAlternates(locale, defaultLocale, supportedLocales, href);
      const linksKey = languages["x-default"];
      const links =
        linkSets.get(linksKey) ??
        Object.entries(languages)
          .map(
            ([hreflang, path]) =>
              `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${absoluteUrl(origin, path)}"/>`
          )
          .join("");
      linkSets.set(linksKey, links);
      return `<url><loc>${absoluteUrl(origin, canonical)}</loc>${links}${lastmod}</url>`;
    })
    .join("\n");
};

/** A `<urlset>` of `entries`, each in the locales {@link entryLocales} lists. */
export const renderSitemapUrlset = (
  address: SitemapAddress,
  entries: readonly SitemapEntryItem[]
): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries.flatMap((entry) => {
      const urls = renderEntryUrls(address, entry);
      return urls ? [urls] : [];
    }),
    "</urlset>",
    "",
  ].join("\n");

/** One file's worth of entries, and where the next file starts. */
export interface SitemapChunk {
  entries: SitemapEntryItem[];
  /** Empty where this chunk ends the list. */
  nextToken: string;
}

const utf8Bytes = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

/**
 * The entries of one sitemap file, starting at `token`. The first file opens
 * with the catalogue's index pages. A file ends once another API page could
 * take it past {@link SITEMAP_URL_LIMIT} URLs or {@link SITEMAP_BYTE_LIMIT}
 * bytes, measured on the XML this address renders, and once the walk has read
 * as many rows as a file could hold URLs: a row that writes none, a series
 * translated into no offered locale, still takes its place in the list, so the
 * file can end with fewer URLs, or none. A token names a position in the list
 * rather than a row, so a file keeps its place when the rows around its
 * boundary change.
 *
 * It carries the tags every write that adds, removes, or renames a listed page
 * drops, the worker's publication of a scheduled episode included, so a newly
 * published page is listed without waiting for the entry to age out.
 *
 * `ok: false` when the walk failed or met a token it had already read. A cache fill
 * must not throw, so an error the API answered with is reported rather than
 * rethrown, whatever its code.
 */
export const getSitemapChunk = async (
  tenantId: string,
  address: SitemapAddress,
  token: string
): Promise<CachedReadResult<SitemapChunk>> => {
  // Shared public content: remote so multi-instance hosts share entries.
  "use cache: remote";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));
  applyCacheTag(tenantSeriesDetailTag(normalizedTenantId));
  applyCacheTag(tenantLabelsTag(normalizedTenantId));
  applyCacheTag(tenantCreatorsTag(normalizedTenantId));
  applyCacheTag(tenantPagesTag(normalizedTenantId));

  const urlsOf = (entry: SitemapEntryItem): number =>
    entryLocales(address, entry).length;
  const pageUrls = SITEMAP_PAGE_SIZE * urlsOf(LONGEST_ENTRY);
  const pageBytes =
    SITEMAP_PAGE_SIZE * utf8Bytes(renderEntryUrls(address, LONGEST_ENTRY));

  const entries: SitemapEntryItem[] =
    token === "" ? CATALOGUE_INDEX_PATHS.map((href) => ({ href })) : [];
  let urls = entries.reduce((sum, entry) => sum + urlsOf(entry), 0);
  let bytes = utf8Bytes(renderSitemapUrlset(address, entries));
  let nextToken = "";
  let stop: CursorWalkStop;
  try {
    stop = await forEachPageWithToken(
      async (pageToken, limit) => {
        const response = await apiClient.catalog.listSitemapEntries({
          limit,
          tenant: { tenantId: normalizedTenantId },
          // The walk starts from "", which for this file is `token`.
          token: pageToken || token,
        });
        nextToken = response.nextToken ?? "";
        return { items: response.entries ?? [], nextToken };
      },
      (items) => {
        for (const entry of items.flatMap(toSitemapEntryItem)) {
          entries.push(entry);
          urls += urlsOf(entry);
          bytes += utf8Bytes(renderEntryUrls(address, entry)) + 1;
        }
        return (
          urls + pageUrls <= SITEMAP_URL_LIMIT &&
          bytes + pageBytes <= SITEMAP_BYTE_LIMIT
        );
      },
      {
        maxPages: Math.ceil(SITEMAP_URL_LIMIT / SITEMAP_PAGE_SIZE),
        maxRows: SITEMAP_URL_LIMIT,
        pageSize: SITEMAP_PAGE_SIZE,
      }
    );
  } catch (error) {
    console.warn("[web-storefront] listSitemapEntries failed", error);
    return cachedReadFailure("The sitemap is unavailable.");
  }

  // A full file, or a walk that read its budget, stops with the rest of the
  // list behind `nextToken`, which is empty when the list happened to end there.
  if (stop === "repeated-token") {
    return cachedReadFailure("The sitemap is unavailable.");
  }
  return { ok: true, value: { entries, nextToken } };
};

/**
 * The start tokens of the files after `tokens`, each file read only for the
 * token that ends it. Each file starts where the one before it ended, so they
 * are read one after another. A file that holds no entry is not a file: a
 * `<urlset>` needs at least one `<url>`, so the next one takes its place.
 * `reads` counts the files read so far, those dropped included.
 */
const walkSitemapFileTokens = async (
  tenantId: string,
  address: SitemapAddress,
  tokens: readonly string[],
  reads: number
): Promise<CachedReadResult<string[]>> => {
  if (reads >= MAX_SITEMAP_FILES) {
    return { message: "The sitemap has too many files.", ok: false };
  }
  const chunk = await getSitemapChunk(tenantId, address, tokens.at(-1) ?? "");
  if (!chunk.ok) {
    return chunk;
  }

  const { entries, nextToken } = chunk.value;
  const kept = entries.length > 0 ? tokens : tokens.slice(0, -1);
  return nextToken
    ? walkSitemapFileTokens(tenantId, address, [...kept, nextToken], reads + 1)
    : { ok: true, value: [...kept] };
};

/**
 * Where each of the tenant's sitemap files starts: `""` for the first, then
 * the token each file hands on. It is what the index counts and what a file
 * starts its own read from, so neither holds the files before it. It carries
 * the tags {@link getSitemapChunk} does, since those files decide it.
 */
export const getSitemapFileTokens = async (
  tenantId: string,
  address: SitemapAddress
): Promise<CachedReadResult<string[]>> => {
  // Shared public content: remote so multi-instance hosts share entries.
  "use cache: remote";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));
  applyCacheTag(tenantSeriesDetailTag(normalizedTenantId));
  applyCacheTag(tenantLabelsTag(normalizedTenantId));
  applyCacheTag(tenantCreatorsTag(normalizedTenantId));
  applyCacheTag(tenantPagesTag(normalizedTenantId));

  const tokens = await walkSitemapFileTokens(
    normalizedTenantId,
    address,
    [""],
    0
  );
  return tokens.ok ? tokens : cachedReadFailure(tokens.message);
};

/** The path of sitemap file `index` behind a `<sitemapindex>`. */
export const sitemapFileHref = (index: number): string =>
  `/sitemap/${index}.xml`;

/** A `<sitemapindex>` naming `count` files. */
export const renderSitemapIndex = (origin: string, count: number): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...Array.from(
      { length: count },
      (_, index) =>
        `<sitemap><loc>${absoluteUrl(origin, sitemapFileHref(index))}</loc></sitemap>`
    ),
    "</sitemapindex>",
    "",
  ].join("\n");

const unavailable = (): Response =>
  new Response("Service Unavailable", {
    headers: { "Cache-Control": "no-store", "Retry-After": "30" },
    status: 503,
  });

const notFound = (): Response => new Response("Not Found", { status: 404 });

const xmlResponse = (body: string): Response =>
  new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });

/**
 * The tenant `proxy.ts` rewrote the request onto. A value that is not a
 * tenant UUID means the request bypassed `proxy.ts`.
 */
const tenantRouteParamsSchema = z.object({
  tenant_id: routeParamString().refine(isTenantIdFormat),
});

/** Where the tenant publishes, or `null` where its read is unavailable. */
const tenantAddress = async (
  tenantId: string
): Promise<SitemapAddress | null> => {
  const [tenant, origin] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantPublicOrigin(tenantId),
  ]);
  return tenant && origin
    ? {
        defaultLocale: tenant.defaultLocale,
        origin,
        supportedLocales: tenant.supportedLocales,
      }
    : null;
};

/**
 * `/sitemap.xml`: the whole sitemap while it fits one file, and an index of
 * its files once it does not. An API that could not be asked is a 503, so a
 * crawler retries instead of recording that the site lists nothing.
 */
export const respondWithSitemap = async (
  params: unknown
): Promise<Response> => {
  const parsed = parseRouteParams(tenantRouteParamsSchema, params);
  if (!parsed) {
    return notFound();
  }

  const address = await tenantAddress(parsed.tenant_id);
  if (!address) {
    return unavailable();
  }
  const tokens = await getSitemapFileTokens(parsed.tenant_id, address);
  if (!tokens.ok) {
    return unavailable();
  }
  if (tokens.value.length > 1) {
    return xmlResponse(renderSitemapIndex(address.origin, tokens.value.length));
  }

  const chunk = await getSitemapChunk(parsed.tenant_id, address, "");
  return chunk.ok
    ? xmlResponse(renderSitemapUrlset(address, chunk.value.entries))
    : unavailable();
};

/** `0.xml`, `1.xml`, …: a file number no larger than {@link MAX_SITEMAP_FILES}. */
const SITEMAP_FILE_NAME = /^\d{1,4}\.xml$/u;

const sitemapFileRouteParamsSchema = tenantRouteParamsSchema.extend({
  sitemap_id: routeParamString().refine((value) =>
    SITEMAP_FILE_NAME.test(value)
  ),
});

/** `/sitemap/{n}.xml`: one file of a sitemap that `/sitemap.xml` indexes. */
export const respondWithSitemapFile = async (
  params: unknown
): Promise<Response> => {
  const parsed = parseRouteParams(sitemapFileRouteParamsSchema, params);
  if (!parsed) {
    return notFound();
  }
  const index = Number(parsed.sitemap_id.slice(0, -".xml".length));

  const address = await tenantAddress(parsed.tenant_id);
  if (!address) {
    return unavailable();
  }
  const tokens = await getSitemapFileTokens(parsed.tenant_id, address);
  if (!tokens.ok) {
    return unavailable();
  }
  const token = tokens.value[index];
  if (token === undefined) {
    return notFound();
  }

  const chunk = await getSitemapChunk(parsed.tenant_id, address, token);
  return chunk.ok
    ? xmlResponse(renderSitemapUrlset(address, chunk.value.entries))
    : unavailable();
};
