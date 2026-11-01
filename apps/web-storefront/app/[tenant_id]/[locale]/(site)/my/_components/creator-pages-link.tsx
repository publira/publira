import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { creatorPageHref } from "#lib/creator-page-paths";
import { listMyCreators } from "#lib/creator-pages";
import { getLocale } from "#lib/locale";
import { getTenantCreatorPagesEnabled } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

/**
 * The way to the reader's Author pages, beside the way to their purchases.
 * It is there only for a reader the tenant shows such pages to, linked to at
 * least one Author, and leads straight to the first of them.
 *
 * The tenant's setting is read first, from the shared tenant read, so a site
 * that shows no Author pages asks nothing more of the API for a reader who
 * opens My Page. A failed read of the Authors leaves the link out: the rest of
 * the header still stands, and the page it leads to reports the failure.
 */
export const CreatorPagesLink = async () => {
  const tenantId = await getTenantId();

  if (!(await getTenantCreatorPagesEnabled(tenantId))) {
    return null;
  }

  const result = await listMyCreators(tenantId, await getLocale());
  const [first] = result.ok ? result.value.creators : [];

  if (!first) {
    return null;
  }

  return (
    <LocaleLink
      className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
      href={creatorPageHref(first.id)}
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
        <Message message="storefront.my.to_creator_pages" />
      </Suspense>
    </LocaleLink>
  );
};
