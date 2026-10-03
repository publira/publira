/**
 * Pure path arithmetic for public URLs whose tenant default locale has no
 * prefix.
 *
 * Three pathname shapes exist in this app and this module is what converts
 * between them:
 *
 * - **public** — what the reader sees, `/series/SR01` or `/en/series/SR01`.
 * - **rewritten** — what `proxy.ts` hands the App Router,
 *   `/{tenantId}/{locale}/series/SR01`.
 * - **bare** — an app-internal path written in source, `/series/SR01`.
 *
 * Nothing here reads request state, so the proxy, Server Components, Client
 * Components, and tests all share one implementation.
 */

import { getLocales, isLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

import { isTenantIdFormat } from "./tenant-id-format";

/**
 * Top-level segments served outside the locale tree: the tenant stylesheet,
 * the association documents under `.well-known`, the crawler documents, and
 * the Route Handlers. They answer machines rather than readers, and Route
 * Handlers cannot read `next/root-params` anyway, so a locale in their URL
 * would be a segment nothing could use.
 */
const LOCALE_EXEMPT_TOP_LEVEL_SEGMENTS = new Set([
  ".well-known",
  "api",
  "robots.txt",
  "sitemap",
  "sitemap.xml",
  "theme.css",
]);

/** An href that leaves the app (or the document) keeps whatever it says. */
const isExternalHref = (href: string): boolean =>
  !href.startsWith("/") || href.startsWith("//");

const splitSegments = (pathname: string): string[] =>
  pathname.split("/").filter((segment) => segment.length > 0);

const joinSegments = (segments: readonly string[]): string =>
  segments.length === 0 ? "/" : `/${segments.join("/")}`;

export const isLocaleExemptTopLevelSegment = (segment: string): boolean =>
  LOCALE_EXEMPT_TOP_LEVEL_SEGMENTS.has(segment.trim().toLowerCase());

/**
 * Whether `pathname` is served outside the locale tree — `/theme.css`,
 * `/.well-known/assetlinks.json`, `/api/v1/revalidate`,
 * `/api/v1/webhook/payment/stripe`.
 */
export const isLocaleExemptPathname = (pathname: string): boolean => {
  const [first] = splitSegments(pathname);
  return first !== undefined && isLocaleExemptTopLevelSegment(first);
};

/**
 * Split a leading locale segment off a public pathname.
 *
 * `locale` is `null` when the first segment is not a supported locale, which
 * is how `proxy.ts` recognises a bookmark from before the locale prefix
 * existed. `pathname` is what remains, always starting with `/`.
 */
export const splitLocalePathname = (
  pathname: string
): { locale: Locale | null; pathname: string } => {
  const segments = splitSegments(pathname);
  const [first] = segments;
  if (first === undefined || !isLocale(first)) {
    return { locale: null, pathname: joinSegments(segments) };
  }

  return { locale: first, pathname: joinSegments(segments.slice(1)) };
};

/**
 * Turn an app-internal path into its canonical public URL. The tenant's
 * default locale has no prefix; a non-default locale does:
 * `/series` → `/series` (default `ja`) or `/en/series` (non-default `en`).
 *
 * A query string or hash rides along untouched, and an href that points
 * outside the app is returned as-is, so this is safe to apply blindly to
 * whatever a link was given.
 *
 * `defaultLocale` is `null` while the tenant's default is unknown, and the
 * prefix is then kept for every locale: a prefix that names the default is
 * redirected to the bare path by `proxy.ts`, so the link still lands on the
 * same page in the same language, where leaving it off would hand the reader
 * to whatever the default turns out to be.
 */
export const withLocalePrefix = (
  locale: Locale,
  defaultLocale: Locale | null,
  href: string
): string => {
  if (isExternalHref(href)) {
    return href;
  }

  if (locale === defaultLocale) {
    return href;
  }

  return href === "/" ? `/${locale}` : `/${locale}${href}`;
};

/**
 * The `alternates` a page's metadata carries, as paths against `metadataBase`.
 *
 * `languages` lists the locales the page actually publishes. A page that exists
 * in every locale fills every key; a tenant page fills only its published
 * translations, plus `x-default`.
 */
export interface LocaleAlternates {
  canonical: string;
  languages: Partial<Record<Locale, string>> & { "x-default": string };
}

/**
 * The canonical path of one page in `locale`, and the same page in every
 * supported locale, with `x-default` at the tenant default's unprefixed path.
 *
 * `href` is the bare path of the page itself, without a query string: a
 * cursor, a sort order, or a filter names a view of the page, not another one.
 */
export const localeAlternates = (
  locale: Locale,
  defaultLocale: Locale,
  href: string
): LocaleAlternates => {
  const languages = Object.fromEntries(
    getLocales().map((code) => [
      code,
      withLocalePrefix(code, defaultLocale, href),
    ])
  ) as Record<Locale, string>;

  return {
    canonical: withLocalePrefix(locale, defaultLocale, href),
    languages: { ...languages, "x-default": href },
  };
};

/**
 * Language alternates for a page published in only some locales.
 *
 * A locale with no published translation is left out: that URL serves another
 * language, and listing it would tell a search engine the translation exists.
 * The canonical URL is the served language's own address, so a fallback URL is
 * not indexed as a second copy. `x-default` is the tenant default's public
 * path when that locale is published, and the served language's path otherwise.
 */
export const publishedLocaleAlternates = (
  defaultLocale: Locale,
  href: string,
  publishedLocales: readonly Locale[],
  servedLocale: Locale
): LocaleAlternates => {
  const published = new Set<Locale>([...publishedLocales, servedLocale]);

  const languages: Partial<Record<Locale, string>> = {};
  for (const code of getLocales()) {
    if (published.has(code)) {
      languages[code] = withLocalePrefix(code, defaultLocale, href);
    }
  }

  const xDefaultLocale = published.has(defaultLocale)
    ? defaultLocale
    : servedLocale;

  return {
    canonical: withLocalePrefix(servedLocale, defaultLocale, href),
    languages: {
      ...languages,
      "x-default": withLocalePrefix(xDefaultLocale, defaultLocale, href),
    },
  };
};

/**
 * The public pathname behind a value read from `usePathname()`.
 *
 * A prerendered shell reports the rewritten pathname while the browser reports
 * the public one (Next.js documents this mismatch under "Avoid hydration
 * mismatch with rewrites"). Dropping the tenant id and the locale from either
 * shape leaves the same bare path, so UI that compares against a bare path —
 * the settings tabs, the locale switcher — renders identically on both sides
 * of hydration.
 */
export const toBarePathname = (pathname: string): string => {
  const segments = splitSegments(pathname);
  const withoutTenant =
    segments[0] !== undefined && isTenantIdFormat(segments[0])
      ? segments.slice(1)
      : segments;

  return splitLocalePathname(joinSegments(withoutTenant)).pathname;
};
