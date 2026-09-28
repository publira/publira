import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { CursorWalkStop } from "@publira/api-client/pagination";
import { SitemapEntryKind } from "@publira/api-client/public/catalog";
import type { SitemapEntry } from "@publira/api-client/public/catalog";
import { getLocales } from "@publira/i18n";
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
import { localeAlternates, withLocalePrefix } from "./locale-path";
import { publishedPageHrefFromSlug } from "./pages";
import { getTenantPublicOrigin, getTenantSiteInfo } from "./tenant";
import { isTenantIdFormat } from "./tenant-id-format";

/** One page of the storefront a sitemap lists, as a bare path. */
export interface SitemapEntryItem {
  href: string;
  /** RFC 3339; absent where the rows behind the page keep no such time. */
  lastModifiedAt?: string;
}

/** Where the tenant publishes, which every URL of its sitemap is written at. */
export interface SitemapAddress {
  defaultLocale: Locale;
  origin: string;
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
 * column. It bounds what the next API page can add to a file.
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
  "kind" | "lastModifiedAt" | "publicId" | "seriesPublicId" | "slug"
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

/**
 * The storefront path an entry names. An entry missing the identifiers its URL
 * is made of, or of a kind this build does not know, is dropped rather than
 * listed at a path that answers 404.
 */
export const toSitemapEntryItem = (
  entry: RawSitemapEntry
): SitemapEntryItem[] => {
  const href = sitemapEntryHref(entry);
  if (!href) {
    return [];
  }

  const lastModifiedAt = entry.lastModifiedAt?.trim();
  return [lastModifiedAt ? { href, lastModifiedAt } : { href }];
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
 * One `<url>` for each locale the site serves `entry` in, each naming every
 * locale's URL and `x-default` as its alternates, itself included.
 */
const renderEntryUrls = (
  { defaultLocale, origin }: SitemapAddress,
  { href, lastModifiedAt }: SitemapEntryItem
): string => {
  const { languages } = localeAlternates(defaultLocale, defaultLocale, href);
  const links = Object.entries(languages)
    .map(
      ([hreflang, path]) =>
        `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${absoluteUrl(origin, path)}"/>`
    )
    .join("");
  const lastmod = lastModifiedAt
    ? `<lastmod>${escapeXml(lastModifiedAt)}</lastmod>`
    : "";
  return getLocales()
    .map(
      (locale) =>
        `<url><loc>${absoluteUrl(origin, withLocalePrefix(locale, defaultLocale, href))}</loc>${links}${lastmod}</url>`
    )
    .join("\n");
};

/** A `<urlset>` of `entries`, each in every locale the site serves. */
export const renderSitemapUrlset = (
  address: SitemapAddress,
  entries: readonly SitemapEntryItem[]
): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries.map((entry) => renderEntryUrls(address, entry)),
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
 * bytes, measured on the XML this address renders. A token names a position in
 * the list rather than a row, so a file keeps its place when the rows around
 * its boundary change.
 *
 * It carries the tags every write that adds, removes, or renames a listed page
 * drops, the worker's publication of a scheduled episode included, so a newly
 * published page is listed without waiting for the entry to age out.
 *
 * `ok: false` when the walk failed or stopped short of its file. A cache fill
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

  const urlsPerEntry = getLocales().length;
  const pageUrls = SITEMAP_PAGE_SIZE * urlsPerEntry;
  const pageBytes =
    SITEMAP_PAGE_SIZE * utf8Bytes(renderEntryUrls(address, LONGEST_ENTRY));

  const entries: SitemapEntryItem[] =
    token === "" ? CATALOGUE_INDEX_PATHS.map((href) => ({ href })) : [];
  let urls = entries.length * urlsPerEntry;
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
          urls += urlsPerEntry;
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
    console.warn("[web-host] listSitemapEntries failed", error);
    return cachedReadFailure("The sitemap is unavailable.");
  }

  // A full file stops the walk with the rest of the list behind `nextToken`,
  // which is empty when the list happened to end with it.
  if (stop === "completed" || stop === "stopped-by-callback") {
    return { ok: true, value: { entries, nextToken } };
  }
  return cachedReadFailure("The sitemap is unavailable.");
};

/**
 * The tenant's sitemap files in order, read through file `last` or to the end
 * of the list when `last` is omitted. Each file starts where the one before it
 * ended, so they are read one after another.
 */
const readSitemapChunks = async (
  tenantId: string,
  address: SitemapAddress,
  last = MAX_SITEMAP_FILES - 1,
  read: readonly SitemapChunk[] = [],
  token = ""
): Promise<CachedReadResult<SitemapChunk[]>> => {
  if (read.length >= MAX_SITEMAP_FILES) {
    return { message: "The sitemap has too many files.", ok: false };
  }
  const chunk = await getSitemapChunk(tenantId, address, token);
  if (!chunk.ok) {
    return chunk;
  }

  const chunks = [...read, chunk.value];
  const { nextToken } = chunk.value;
  return nextToken && chunks.length <= last
    ? readSitemapChunks(tenantId, address, last, chunks, nextToken)
    : { ok: true, value: chunks };
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
    ? { defaultLocale: tenant.defaultLocale, origin }
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
  const chunks = await readSitemapChunks(parsed.tenant_id, address);
  if (!chunks.ok) {
    return unavailable();
  }

  const [first] = chunks.value;
  if (chunks.value.length === 1 && first) {
    return xmlResponse(renderSitemapUrlset(address, first.entries));
  }
  return xmlResponse(renderSitemapIndex(address.origin, chunks.value.length));
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
  const chunks = await readSitemapChunks(parsed.tenant_id, address, index);
  if (!chunks.ok) {
    return unavailable();
  }

  const chunk = chunks.value[index];
  if (!chunk) {
    return notFound();
  }
  return xmlResponse(renderSitemapUrlset(address, chunk.entries));
};
