import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLogin } from "#lib/auth-session";
import { getLocale, loadHostMessages } from "#lib/locale";
import { listMyPurchases } from "#lib/purchases";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { PurchaseLibrary } from "./_components/purchase-library";
import {
  defaultPurchasesPageSize,
  parsePurchasesSearchParams,
  purchasesListHref,
} from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.library.title") };
};

type PurchaseLibraryPageProps = PageProps<"/[tenant_id]/[locale]/my/library">;

const PurchaseLibrarySkeleton = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <div className="h-6 w-24 animate-pulse rounded bg-muted" />
    <div className="mt-4 h-44 w-full animate-pulse rounded-xl bg-muted" />
  </section>
);

const PurchaseLibraryData = async ({
  searchParams,
}: Pick<PurchaseLibraryPageProps, "searchParams">) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { token } = parsePurchasesSearchParams(resolvedSearchParams);
  const [result, timeZone] = await Promise.all([
    listMyPurchases(tenantId, {
      limit: defaultPurchasesPageSize,
      locale,
      token,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok && result.requiresSignIn) {
    await redirectToLogin(locale, purchasesListHref(token), tenantId);
  }

  return (
    <PurchaseLibrary
      listErrorMessage={result.ok ? undefined : result.message}
      nextToken={result.nextToken}
      previousToken={result.previousToken}
      purchases={result.purchases}
      timeZone={timeZone}
    />
  );
};

const PurchaseLibraryPage = ({ searchParams }: PurchaseLibraryPageProps) => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold">
        <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
          <Message message="host.library.title" />
        </Suspense>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="host.library.description" />
        </Suspense>
      </p>
    </section>
    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.library.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<PurchaseLibrarySkeleton />}>
        <PurchaseLibraryData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default PurchaseLibraryPage;
