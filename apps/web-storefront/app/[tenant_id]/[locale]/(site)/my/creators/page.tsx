import { Skeleton } from "@publira/ui-components/skeleton";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageLoadError } from "#components/page-load-error";
import { redirectToLogin } from "#lib/auth-session";
import { creatorPageHref } from "#lib/creator-page-paths";
import { listMyCreators } from "#lib/creator-pages";
import { getLocale } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";
import { tenantLocalePath } from "#lib/tenant-locale-path";

/**
 * Sends the reader to the page of the first Author they are linked to, and
 * back to My Page when there is none to send them to: an account linked to no
 * Author, or a tenant that shows no Author pages.
 */
const CreatorPagesRedirect = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const result = await listMyCreators(tenantId, locale);

  if (!result.ok && !result.missing && result.requiresSignIn) {
    await redirectToLogin(locale, "/my/creators", tenantId);
  }

  if (!result.ok && !result.missing) {
    return <PageLoadError description={result.message} />;
  }

  const [first] = result.ok ? result.value.creators : [];

  redirect(
    await tenantLocalePath(
      tenantId,
      locale,
      first ? creatorPageHref(first.id) : "/my"
    )
  );
};

const CreatorPagesIndex = () => (
  <Suspense
    fallback={
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-40 w-full" />
      </div>
    }
  >
    <CreatorPagesRedirect />
  </Suspense>
);

export default CreatorPagesIndex;
