import type { Locale } from "@publira/utils/i18n";

/**
 * First segments **below the locale prefix** that belong to app features or
 * auth rather than to a tenant-published content page — every route directory
 * under `app/[tenant_id]/[locale]`.
 *
 * The locale is stripped before this set is consulted, so a locale code can
 * never collide with a reserved name and `/{locale}/{locale}` still reaches a
 * published page whose slug happens to be `ja` or `en`. The paths served
 * outside the locale tree — `/theme.css`, `/api/*`, `/livez`, `/readyz` — are
 * settled in `lib/locale-path.ts` and `@publira/utils/health` before a
 * pathname gets here.
 */
const RESERVED_TOP_LEVEL_SEGMENTS = new Set([
  "announcements",
  "authors",
  "confirm-email",
  "confirm-password",
  "labels",
  "login",
  "my",
  "notifications",
  "page",
  "reset-password",
  "search",
  "series",
  "settings",
  "signup",
  "verify",
]);

/**
 * One path segment of a published page slug (admin storage: `/seg` or `/a/b`).
 */
const PUBLISHED_PAGE_SLUG_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

export const isReservedTopLevelSegment = (segment: string): boolean =>
  RESERVED_TOP_LEVEL_SEGMENTS.has(segment.trim().toLowerCase());

/**
 * Returns the path under `/page/` for a candidate published-page URL
 * (e.g. `/privacy` → `privacy`, `/legal/terms` → `legal/terms`), or null
 * when the path is reserved, empty, or not a valid page slug path.
 */
export const getPublishedPageSlugFromPathname = (
  pathname: string
): string | null => {
  const normalized = pathname.trim();
  if (!normalized || normalized === "/") {
    return null;
  }

  const withoutLeading = normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;
  if (!withoutLeading) {
    return null;
  }

  // Collapse empty segments from accidental "//".
  const segments = withoutLeading
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return null;
  }

  const [first] = segments;
  if (!first || isReservedTopLevelSegment(first)) {
    return null;
  }

  for (const segment of segments) {
    if (!PUBLISHED_PAGE_SLUG_SEGMENT_PATTERN.test(segment)) {
      return null;
    }
  }

  return segments.join("/");
};

/**
 * Rewrite a locale-less public pathname onto the resolved tenant and locale:
 * - `/privacy` → `/{tenantId}/{locale}/page/privacy`
 * - `/legal/terms` → `/{tenantId}/{locale}/page/legal/terms`
 * - `/series` (reserved) → `/{tenantId}/{locale}/series`
 *
 * `pathname` is what `splitLocalePathname` left behind, so the published-page
 * decision is made on the path the reader actually asked for rather than on a
 * locale code.
 */
export const buildTenantRewritePathname = (
  tenantId: string,
  locale: Locale,
  pathname: string
): string => {
  const prefix = `/${tenantId.trim()}/${locale}`;
  const publishedSlug = getPublishedPageSlugFromPathname(pathname);
  if (publishedSlug) {
    return `${prefix}/page/${publishedSlug}`;
  }

  const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (suffix === "/") {
    return prefix;
  }
  return `${prefix}${suffix}`;
};
