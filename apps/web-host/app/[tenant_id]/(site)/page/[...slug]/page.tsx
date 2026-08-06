import {
  createPlaceholderStaticParams,
  guardPlaceholder,
  STATIC_PARAM_PLACEHOLDER,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublishedPage, isPageNotFoundError } from "#lib/pages";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  PublishedPageContent,
  PublishedPageFetchError,
} from "./_components/published-page-view";

/**
 * Missing pages must call `notFound()` outside `<Suspense>` so the response
 * status is HTTP 404 (same pattern as authors detail). Instant shell is not
 * used for this segment.
 */
export const instant = false;

export const generateStaticParams = () => [
  {
    ...createPlaceholderStaticParams("tenant_id")[0],
    slug: [STATIC_PARAM_PLACEHOLDER],
  },
];

const guardCatchAllSlug = (slug: string[] | undefined): void => {
  if (!slug || slug.length === 0) {
    guardPlaceholder(STATIC_PARAM_PLACEHOLDER);
    return;
  }
  for (const segment of slug) {
    guardPlaceholder(segment);
  }
};

export const generateMetadata = async (
  props: PageProps<"/[tenant_id]/page/[...slug]">
): Promise<Metadata> => {
  const { slug } = await props.params;
  const tenantId = await getTenantId();
  guardCatchAllSlug(slug);

  const siteLabel = await getTenantSiteLabel(tenantId);

  try {
    const page = await getPublishedPage(tenantId, slug);
    return {
      title: `${page.title} | ${siteLabel}`,
    };
  } catch (error) {
    if (isPageNotFoundError(error)) {
      return {
        title: `ページが見つかりません | ${siteLabel}`,
      };
    }
    return {
      title: `ページ | ${siteLabel}`,
    };
  }
};

const Page = async (props: PageProps<"/[tenant_id]/page/[...slug]">) => {
  const { slug } = await props.params;
  const tenantId = await getTenantId();
  guardCatchAllSlug(slug);

  let result:
    | { ok: true; page: Awaited<ReturnType<typeof getPublishedPage>> }
    | { ok: false; reason: "error" };
  try {
    result = { ok: true, page: await getPublishedPage(tenantId, slug) };
  } catch (error) {
    if (isPageNotFoundError(error)) {
      notFound();
    }
    result = { ok: false, reason: "error" };
  }

  if (!result.ok) {
    return <PublishedPageFetchError />;
  }

  return <PublishedPageContent page={result.page} />;
};

export default Page;
