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
 * opens My Page.
 *
 * Any failed read of the Authors leaves the link out, one nothing classifies
 * included, as a failed read of the footer links does: the link is chrome,
 * and a throw would take the whole of My Page down with it, while a section
 * error in its place would tell every reader of the site, most of them no
 * Author, that pages they never had could not be shown.
 */
export const CreatorPagesLink = async () => {
  const tenantId = await getTenantId();

  if (!(await getTenantCreatorPagesEnabled(tenantId))) {
    return null;
  }

  let result;

  try {
    result = await listMyCreators(tenantId, await getLocale());
  } catch (error) {
    console.warn("[web-storefront] listMyCreators failed", error);

    return null;
  }

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
