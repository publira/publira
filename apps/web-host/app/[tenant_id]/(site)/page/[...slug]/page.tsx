import {
  createPlaceholderStaticParams,
  guardPlaceholder,
  STATIC_PARAM_PLACEHOLDER,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageLoadError } from "#components/page-load-error";
import { getPublishedPage } from "#lib/pages";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { PublishedPageContent } from "./_components/published-page-view";

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
  const [{ slug }, tenantId] = await Promise.all([props.params, getTenantId()]);
  guardCatchAllSlug(slug);

  const [siteLabel, result] = await Promise.all([
    getTenantSiteLabel(tenantId),
    getPublishedPage(tenantId, slug),
  ]);

  // An unavailable page reads as "not found" for the `<title>` alone; the page
  // body below says what actually happened.
  const page = result.ok ? result.value : null;

  return {
    title: `${page ? page.title : "ページが見つかりません"} | ${siteLabel}`,
  };
};

const Page = async (props: PageProps<"/[tenant_id]/page/[...slug]">) => {
  const [{ slug }, tenantId] = await Promise.all([props.params, getTenantId()]);
  guardCatchAllSlug(slug);

  // Missing / unpublished / other-tenant pages all resolve to `null`. A genuine
  // fetch failure is a value as well: this page awaits before anything is
  // flushed, so a throw would answer a bare 500 no boundary can reach (#672).
  const result = await getPublishedPage(tenantId, slug);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  if (!result.value) {
    notFound();
  }

  return <PublishedPageContent page={result.value} />;
};

export default Page;
