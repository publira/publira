/**
 * Pure path arithmetic for the `/{locale}/...` public URLs.
 *
 * Three pathname shapes exist in this app and this module is what converts
 * between them:
 *
 * - **public** — what the reader sees, `/{locale}/series/SR01`.
 * - **rewritten** — what `proxy.ts` hands the App Router,
 *   `/{tenantId}/{locale}/series/SR01`.
 * - **bare** — an app-internal path written in source, `/series/SR01`.
 *
 * Nothing here reads request state, so the proxy, Server Components, Client
 * Components, and tests all share one implementation.
 */

import { isLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

import { isTenantIdFormat } from "./tenant-id-format";

/**
 * Top-level segments served outside the locale tree: the tenant stylesheet and
 * the Route Handlers. They answer machines rather than readers, and Route
 * Handlers cannot read `next/root-params` anyway, so a locale in their URL
 * would be a segment nothing could use.
 */
const LOCALE_EXEMPT_TOP_LEVEL_SEGMENTS = new Set(["api", "theme.css"]);

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
 * `/api/revalidate`, `/api/v1/webhook/stripe`.
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
 * Prefix an app-internal path with `locale`: `/series` → `/ja/series`.
 *
 * A query string or hash rides along untouched, and an href that points
 * outside the app is returned as-is, so this is safe to apply blindly to
 * whatever a link was given.
 */
export const withLocalePrefix = (locale: Locale, href: string): string => {
  if (isExternalHref(href)) {
    return href;
  }

  return href === "/" ? `/${locale}` : `/${locale}${href}`;
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
