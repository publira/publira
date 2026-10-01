import { isMissingResourceRpcError } from "@publira/api-client/errors";
import type { Page, PageVersion } from "@publira/api-client/public/types";
import { getLocaleLabel, isLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantPageTag, tenantPagesTag } from "./cache-tags";
import { getMessagesFor } from "./messages";
import { localizedReadFailure } from "./read-failure";

export interface PublishedPage {
  id: string;
  slug: string;
  title: string;
  contentMarkdown: string;
  publishedAt: string;
  versionId: string;
  versionNumber: number;
  /**
   * The locale of the translation that was served. It differs from the locale
   * the reader asked for when that one has no published translation.
   */
  locale: Locale;
  /** Every locale with a published translation, the served one included. */
  publishedLocales: readonly Locale[];
}

/**
 * The autonym of the language a page is shown in when that is not the language
 * the reader asked for, or `null` when the requested translation was served.
 *
 * The name comes from the locale registry — the same autonym the language
 * switcher shows — so the sentence around it is the only part the catalog owns.
 */
export const publishedPageFallbackLanguage = (
  requestedLocale: Locale,
  servedLocale: Locale
): string | null =>
  requestedLocale === servedLocale ? null : getLocaleLabel(servedLocale);

/**
 * The generated `Page` fields a public read keeps. Naming them against the
 * message is what makes a proto rename fail here.
 */
type PublishedPageFields = Pick<Page, "id" | "locale" | "slug" | "title">;

/** The generated `PageVersion` fields a public read keeps. */
type PublishedPageVersionFields = Pick<
  PageVersion,
  "contentMarkdown" | "id" | "publishedAt" | "versionNumber"
>;

const publishedLocalesFrom = (
  codes: readonly string[] | undefined,
  servedLocale: Locale
): readonly Locale[] => {
  const locales: Locale[] = [];
  const seen = new Set<Locale>();
  const add = (code: string) => {
    if (!isLocale(code) || seen.has(code)) {
      return;
    }
    seen.add(code);
    locales.push(code);
  };

  for (const code of codes ?? []) {
    add(code);
  }
  // The served translation is published by definition, even when the list of
  // alternates omitted it.
  add(servedLocale);
  return locales;
};

/**
 * An unreadable served locale is treated as the one the reader asked for: the
 * page still renders, and it does not claim a fallback it cannot name.
 */
const servedLocaleFrom = (
  locale: string | undefined,
  requestedLocale: Locale
): Locale => (isLocale(locale) ? locale : requestedLocale);

export interface PublishedPageLink {
  href: string;
  label: string;
  id: string;
  slug: string;
}

/**
 * Normalize a route param or form slug to the storage form used by admin/public APIs.
 * Accepts a string or catch-all segment array.
 * Empty / root → `""`. Otherwise always a single leading `/`
 * (e.g. `privacy` → `/privacy`, `['legal','terms']` → `/legal/terms`).
 */
export const normalizePublishedPageSlug = (
  slug: string | readonly string[]
): string => {
  const joined: string = typeof slug === "string" ? slug : slug.join("/");

  let normalized = joined.trim();
  if (!normalized || normalized === "/") {
    return "";
  }

  while (normalized.includes("//")) {
    normalized = normalized.replaceAll("//", "/");
  }
  normalized = normalized.replaceAll(/^\/|\/$/gu, "");
  if (!normalized) {
    return "";
  }

  return `/${normalized}`;
};

type GetPublishedPageResponse = Awaited<
  ReturnType<typeof apiClient.pages.getPublishedPage>
>;

const fetchPublishedPageBySlug = async (
  tenantId: string,
  slug: string,
  locale: Locale
): Promise<
  | { ok: true; response: GetPublishedPageResponse }
  | { error: unknown; ok: false }
> => {
  try {
    const response = await apiClient.pages.getPublishedPage({
      locale,
      slug,
      tenant: { tenantId },
    });
    return { ok: true, response };
  } catch (error) {
    return { error, ok: false };
  }
};

/**
 * Build the public site path for a stored page slug.
 * Storage form is `/privacy` or `/legal/terms`; public href matches that path.
 */
export const publishedPageHrefFromSlug = (slug: string): string => {
  const normalized = normalizePublishedPageSlug(slug);
  return normalized || "/";
};

/**
 * Cached fetch of footer page links.
 *
 * A failure resolves to `[]` — the footer is non-critical chrome and is
 * resolved in the site layout, where a throw would take every route down with
 * a bare 500 — and drops the entry, so the links come back as soon as
 * the API does instead of a soft-empty result sticking until revalidation.
 */
const listPublishedPageLinksCached = async (
  tenantId: string,
  locale: Locale
): Promise<PublishedPageLink[]> => {
  // Shared public content: remote so multi-instance hosts share entries.
  // `locale` is an argument, so each language is its own entry; the tag below
  // names every one of them.
  "use cache: remote";

  applyCacheTag(tenantPagesTag(tenantId));

  let response: Awaited<ReturnType<typeof apiClient.pages.listPublishedPages>>;
  try {
    response = await apiClient.pages.listPublishedPages({
      locale,
      tenant: { tenantId },
    });
  } catch (error) {
    console.warn("[web-host] listPublishedPages failed", error);
    dropFailedCacheEntry();
    return [];
  }

  const links: PublishedPageLink[] = [];
  for (const page of response.pages ?? []) {
    const id = page.id?.trim() ?? "";
    const slug = page.slug?.trim() ?? "";
    const title = page.title?.trim() ?? "";
    if (!id || !slug || !title) {
      continue;
    }
    // API already filters to display_in_footer + published; keep a defensive check.
    if (page.displayInFooter === false) {
      continue;
    }
    links.push({
      href: publishedPageHrefFromSlug(slug),
      id,
      label: title,
      slug,
    });
  }
  return links;
};

/** Public footer links, titled in `locale` or the translation it falls back to. */
export const listPublishedPageLinks = async (
  tenantId: string,
  locale: Locale
): Promise<PublishedPageLink[]> => {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return [];
  }

  return await listPublishedPageLinksCached(normalizedTenantId, locale);
};

const toPublishedPage = (
  page: PublishedPageFields,
  version: PublishedPageVersionFields,
  publishedLocales: readonly Locale[],
  normalizedSlug: string,
  servedLocale: Locale,
  t: Awaited<ReturnType<typeof getMessagesFor>>
): PublishedPage => ({
  contentMarkdown: version.contentMarkdown ?? "",
  id: page.id,
  locale: servedLocale,
  publishedAt: version.publishedAt ?? "",
  publishedLocales,
  slug: page.slug ?? normalizedSlug,
  title: page.title?.trim() || t("host.pages.untitled"),
  versionId: version.id ?? "",
  versionNumber: version.versionNumber ?? 0,
});

/**
 * `ok: true` with a `null` value when the page does not exist, is unpublished,
 * or belongs to another tenant — the server returns `not_found` or
 * `permission_denied` for those and the public site must not tell them apart.
 *
 * `ok: false` when the fetch itself failed. It is a value rather than a throw
 * because this runs inside a `"use cache"` scope, and a cache fill that throws
 * fails the whole request — the caller's `try` / `catch` never gets the chance
 * to render anything. The failed entry is dropped, so a recovered API
 * serves the page again on the next request.
 */
export const getPublishedPage = async (
  tenantId: string,
  slug: string | readonly string[],
  locale: Locale
): Promise<CachedReadResult<PublishedPage | null>> => {
  // Shared public content: remote so multi-instance hosts share entries.
  "use cache: remote";

  const normalizedTenantId = tenantId.trim();
  const normalizedSlug = normalizePublishedPageSlug(slug);

  if (!normalizedTenantId) {
    return { ok: true, value: null };
  }

  // Root slug is not served as a content page on the public site.
  if (!normalizedSlug) {
    return { ok: true, value: null };
  }

  applyCacheTag(tenantPagesTag(normalizedTenantId));

  // Prefer storage form `/privacy`. Fall back to bare `privacy` for legacy rows.
  const primary = await fetchPublishedPageBySlug(
    normalizedTenantId,
    normalizedSlug,
    locale
  );

  let response: GetPublishedPageResponse;
  if (primary.ok) {
    ({ response } = primary);
  } else if (isMissingResourceRpcError(primary.error)) {
    const bareSlug = normalizedSlug.slice(1);
    const secondary = await fetchPublishedPageBySlug(
      normalizedTenantId,
      bareSlug,
      locale
    );
    if (secondary.ok) {
      ({ response } = secondary);
    } else if (isMissingResourceRpcError(secondary.error)) {
      return { ok: true, value: null };
    } else {
      return localizedReadFailure(
        secondary.error,
        locale,
        "host.pages.read_failed"
      );
    }
  } else {
    return localizedReadFailure(
      primary.error,
      locale,
      "host.pages.read_failed"
    );
  }

  const { page, publishedLocales, version } = response;
  if (!(page?.id && version)) {
    return { ok: true, value: null };
  }

  applyCacheTag(tenantPageTag(normalizedTenantId, page.id));

  const t = await getMessagesFor(locale);
  const servedLocale = servedLocaleFrom(page.locale, locale);

  return {
    ok: true,
    value: toPublishedPage(
      page,
      version,
      publishedLocalesFrom(publishedLocales, servedLocale),
      normalizedSlug,
      servedLocale,
      t
    ),
  };
};
