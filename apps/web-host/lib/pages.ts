import { isMissingResourceRpcError } from "@publira/api-client/errors";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantPageTag, tenantPagesTag } from "./cache-tags";
import { PageNotFoundError } from "./page-not-found-error";

export { PageNotFoundError } from "./page-not-found-error";

/** Cached scopes may rehydrate errors so `instanceof` alone is unreliable. */
export const isPageNotFoundError = (error: unknown): boolean =>
  error instanceof PageNotFoundError ||
  (error instanceof Error && error.name === "PageNotFoundError");

export interface PublishedPage {
  id: string;
  slug: string;
  title: string;
  contentMarkdown: string;
  publishedAt: string;
  versionId: string;
  versionNumber: number;
}

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
  normalized = normalized.replaceAll(/^\/+|\/+$/gu, "");
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
  slug: string
): Promise<
  | { ok: true; response: GetPublishedPageResponse }
  | { error: unknown; ok: false }
> => {
  try {
    const response = await apiClient.pages.getPublishedPage({
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
 * Cached fetch of footer page links. Throws on API failure so the remote cache
 * does not store a soft-empty result that would hide links until revalidation.
 */
const listPublishedPageLinksCached = async (
  tenantId: string
): Promise<PublishedPageLink[]> => {
  // Shared public content: remote so multi-instance hosts share entries.
  "use cache: remote";

  applyCacheTag(tenantPagesTag(tenantId));

  const response = await apiClient.pages.listPublishedPages({
    tenant: { tenantId },
  });

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

/**
 * Public footer links. Failures resolve to [] outside the cache so a transient
 * API error is not persisted as an empty remote cache entry.
 */
export const listPublishedPageLinks = async (
  tenantId: string
): Promise<PublishedPageLink[]> => {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return [];
  }

  try {
    return await listPublishedPageLinksCached(normalizedTenantId);
  } catch {
    // Footer links are non-critical chrome; fail soft so the site shell still renders.
    return [];
  }
};

export const getPublishedPage = async (
  tenantId: string,
  slug: string | readonly string[]
): Promise<PublishedPage> => {
  // Shared public content: remote so multi-instance hosts share entries (#532).
  "use cache: remote";

  const normalizedTenantId = tenantId.trim();
  const normalizedSlug = normalizePublishedPageSlug(slug);

  if (!normalizedTenantId) {
    throw new PageNotFoundError();
  }

  // Root slug is not served as a content page on the public site.
  if (!normalizedSlug) {
    throw new PageNotFoundError();
  }

  applyCacheTag(tenantPagesTag(normalizedTenantId));

  // Prefer storage form `/privacy`. Fall back to bare `privacy` for legacy rows.
  const primary = await fetchPublishedPageBySlug(
    normalizedTenantId,
    normalizedSlug
  );

  let response: GetPublishedPageResponse;
  if (primary.ok) {
    ({ response } = primary);
  } else if (isMissingResourceRpcError(primary.error)) {
    const bareSlug = normalizedSlug.slice(1);
    const secondary = await fetchPublishedPageBySlug(
      normalizedTenantId,
      bareSlug
    );
    if (secondary.ok) {
      ({ response } = secondary);
    } else if (isMissingResourceRpcError(secondary.error)) {
      throw new PageNotFoundError();
    } else {
      throw secondary.error;
    }
  } else {
    throw primary.error;
  }

  const { page, version } = response;
  if (!page?.id || !version) {
    throw new PageNotFoundError();
  }

  applyCacheTag(tenantPageTag(normalizedTenantId, page.id));

  return {
    contentMarkdown: version.contentMarkdown ?? "",
    id: page.id,
    publishedAt: version.publishedAt ?? "",
    slug: page.slug ?? normalizedSlug,
    title: page.title?.trim() || "ページ",
    versionId: version.id ?? "",
    versionNumber: version.versionNumber ?? 0,
  };
};
