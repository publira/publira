import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { CursorWalkStop } from "@publira/api-client/pagination";
import { SitemapEntryKind } from "@publira/api-client/public/catalog";
import type { SitemapEntry } from "@publira/api-client/public/catalog";
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
import { localeAlternates } from "./locale-path";
import { publishedPageHrefFromSlug } from "./pages";
import { getTenantPublicOrigin, getTenantSiteInfo } from "./tenant";
import { isTenantIdFormat } from "./tenant-id-format";

/** One page of the storefront a sitemap lists, as a bare path. */
export interface SitemapEntryItem {
  href: string;
  /** RFC 3339; absent where the rows behind the page keep no such time. */
  lastModifiedAt?: string;
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

/**
 * Entries per file. The protocol's limit is 50,000 URLs, and this leaves the
 * first file room for {@link CATALOGUE_INDEX_PATHS} on top of a full chunk.
 */
export const SITEMAP_ENTRIES_PER_FILE = 49_000;

const SITEMAP_PAGE_SIZE = 1000;

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

/** One file's worth of entries, and where the next file starts. */
export interface SitemapChunk {
  entries: SitemapEntryItem[];
  /** Empty where this chunk ends the list. */
  nextToken: string;
}

/**
 * Up to {@link SITEMAP_ENTRIES_PER_FILE} entries of the tenant's sitemap,
 * starting at `token`. A token names a position in the list rather than a row,
 * so a chunk keeps its place when the rows around its boundary change.
 *
 * It carries the tags every write that adds, removes, or renames a listed page
 * drops, the worker's publication of a scheduled episode included, so a newly
 * published page is listed without waiting for the entry to age out.
 *
 * `ok: false` when the walk failed or stopped short of its chunk. A cache fill
 * must not throw, so an error the API answered with is reported rather than
 * rethrown, whatever its code.
 */
export const getSitemapChunk = async (
  tenantId: string,
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

  const entries: SitemapEntryItem[] = [];
  let nextToken = "";
  let stop: CursorWalkStop;
  try {
    stop = await forEachPageWithToken(
      async (pageToken, limit) => {
        const response = await apiClient.catalog.listSitemapEntries({
          limit,
          tenant: { tenantId: normalizedTenantId },
          // The walk starts from "", which for this chunk is `token`.
          token: pageToken || token,
        });
        nextToken = response.nextToken ?? "";
        return { items: response.entries ?? [], nextToken };
      },
      (items) => {
        for (const item of items) {
          entries.push(...toSitemapEntryItem(item));
        }
      },
      {
        maxPages: Math.ceil(SITEMAP_ENTRIES_PER_FILE / SITEMAP_PAGE_SIZE),
        maxRows: SITEMAP_ENTRIES_PER_FILE,
        pageSize: SITEMAP_PAGE_SIZE,
      }
    );
  } catch (error) {
    console.warn("[web-host] listSitemapEntries failed", error);
    return cachedReadFailure("The sitemap is unavailable.");
  }

  if (stop === "completed") {
    return { ok: true, value: { entries, nextToken: "" } };
  }
  // A full chunk, with the rest of the list behind `nextToken`.
  if (stop === "max-rows") {
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
  last = MAX_SITEMAP_FILES - 1,
  read: readonly SitemapChunk[] = [],
  token = ""
): Promise<CachedReadResult<SitemapChunk[]>> => {
  if (read.length >= MAX_SITEMAP_FILES) {
    return { message: "The sitemap has too many files.", ok: false };
  }
  const chunk = await getSitemapChunk(tenantId, token);
  if (!chunk.ok) {
    return chunk;
  }

  const chunks = [...read, chunk.value];
  const { nextToken } = chunk.value;
  return nextToken && chunks.length <= last
    ? readSitemapChunks(tenantId, last, chunks, nextToken)
    : { ok: true, value: chunks };
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
 * A `<urlset>` of `entries`, each at its canonical URL — the tenant default's
 * unprefixed path — with the same page in every locale the site serves.
 */
export const renderSitemapUrlset = (
  origin: string,
  defaultLocale: Locale,
  entries: readonly SitemapEntryItem[]
): string => {
  const urls = entries.map(({ href, lastModifiedAt }) => {
    const { canonical, languages } = localeAlternates(
      defaultLocale,
      defaultLocale,
      href
    );
    const links = Object.entries(languages).map(
      ([hreflang, path]) =>
        `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${absoluteUrl(origin, path)}"/>`
    );
    const lastmod = lastModifiedAt
      ? [`<lastmod>${escapeXml(lastModifiedAt)}</lastmod>`]
      : [];
    return [
      "<url>",
      `<loc>${absoluteUrl(origin, canonical)}</loc>`,
      ...links,
      ...lastmod,
      "</url>",
    ].join("");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
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

/** The entries sitemap file `index` lists. */
const sitemapFileEntries = (
  chunk: SitemapChunk,
  index: number
): SitemapEntryItem[] =>
  index === 0
    ? [...CATALOGUE_INDEX_PATHS.map((href) => ({ href })), ...chunk.entries]
    : chunk.entries;

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
): Promise<{ defaultLocale: Locale; origin: string } | null> => {
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
  const chunks = await readSitemapChunks(parsed.tenant_id);
  if (!chunks.ok) {
    return unavailable();
  }

  const [first] = chunks.value;
  if (chunks.value.length === 1 && first) {
    return xmlResponse(
      renderSitemapUrlset(
        address.origin,
        address.defaultLocale,
        sitemapFileEntries(first, 0)
      )
    );
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
  const chunks = await readSitemapChunks(parsed.tenant_id, index);
  if (!chunks.ok) {
    return unavailable();
  }

  const chunk = chunks.value[index];
  if (!chunk) {
    return notFound();
  }
  return xmlResponse(
    renderSitemapUrlset(
      address.origin,
      address.defaultLocale,
      sitemapFileEntries(chunk, index)
    )
  );
};
