/**
 * Top-level path segments that belong to app features / auth / API,
 * not to tenant-published content pages.
 */
const RESERVED_TOP_LEVEL_SEGMENTS = new Set([
  "announcements",
  "api",
  "authors",
  "confirm-email",
  "confirm-password",
  "labels",
  "livez",
  "readyz",
  "login",
  "logout",
  "my",
  "notifications",
  "page",
  "reset-password",
  "series",
  "settings",
  "signup",
  "theme.css",
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
 * Rewrite public pathname under a resolved tenant:
 * - `/privacy` → `/{tenantId}/page/privacy`
 * - `/legal/terms` → `/{tenantId}/page/legal/terms`
 * - `/series` (reserved) → `/{tenantId}/series`
 */
export const buildTenantRewritePathname = (
  tenantId: string,
  pathname: string
): string => {
  const normalizedTenantId = tenantId.trim();
  const publishedSlug = getPublishedPageSlugFromPathname(pathname);
  if (publishedSlug) {
    return `/${normalizedTenantId}/page/${publishedSlug}`;
  }

  const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (suffix === "/") {
    return `/${normalizedTenantId}`;
  }
  return `/${normalizedTenantId}${suffix}`;
};
