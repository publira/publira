import type { Locale } from "@publira/i18n";

/**
 * The published page a locale-less public pathname names, as the path under
 * `/page/` (`/privacy` → `privacy`, `/legal/terms` → `legal/terms`), or null
 * when no published page has that slug.
 *
 * `publishedSlugs` is the tenant's set in storage form (`/privacy`). A page
 * wins over one of the site's own routes at the same path.
 */
export const getPublishedPageSlugFromPathname = (
  pathname: string,
  publishedSlugs: ReadonlySet<string> | null
): string | null => {
  if (!publishedSlugs || publishedSlugs.size === 0) {
    return null;
  }

  // Collapse empty segments from accidental "//".
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }

  const slug = segments.join("/");
  return publishedSlugs.has(`/${slug}`) ? slug : null;
};

/**
 * Rewrite a locale-less public pathname onto the resolved tenant and locale:
 * - `/privacy` (a published page) → `/{tenantId}/{locale}/page/privacy`
 * - `/legal/terms` (a published page) → `/{tenantId}/{locale}/page/legal/terms`
 * - `/series` (no page) → `/{tenantId}/{locale}/series`
 *
 * `pathname` is what `splitLocalePathname` left behind, so the published-page
 * decision is made on the path the reader actually asked for rather than on a
 * locale code.
 */
export const buildTenantRewritePathname = (
  tenantId: string,
  locale: Locale,
  pathname: string,
  publishedSlugs: ReadonlySet<string> | null
): string => {
  const prefix = `/${tenantId.trim()}/${locale}`;
  const publishedSlug = getPublishedPageSlugFromPathname(
    pathname,
    publishedSlugs
  );
  if (publishedSlug) {
    return `${prefix}/page/${publishedSlug}`;
  }

  const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (suffix === "/") {
    return prefix;
  }
  return `${prefix}${suffix}`;
};
