import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listMyPurchases } from "#lib/purchases";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { PurchaseLibrary } from "./_components/purchase-library";
import {
  defaultPurchasesPageSize,
  parsePurchasesSearchParams,
  purchasesListHref,
} from "./_lib/search-params";

export const metadata: Metadata = { title: "購入済み一覧" };

type PurchaseLibraryPageProps = PageProps<"/[tenant_id]/my/library">;

const PurchaseLibrarySkeleton = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <div className="h-6 w-24 animate-pulse rounded bg-muted" />
    <div className="mt-4 h-44 w-full animate-pulse rounded-xl bg-muted" />
  </section>
);

const PurchaseLibraryData = async ({
  searchParams,
}: Pick<PurchaseLibraryPageProps, "searchParams">) => {
  const [resolvedSearchParams, tenantId] = await Promise.all([
    searchParams,
    getTenantId(),
  ]);
  const { token } = parsePurchasesSearchParams(resolvedSearchParams);
  const [result, timeZone] = await Promise.all([
    listMyPurchases(tenantId, { limit: defaultPurchasesPageSize, token }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok && result.requiresSignIn) {
    redirect(`/login?returnTo=${encodeURIComponent(purchasesListHref(token))}`);
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
      <h1 className="text-xl font-semibold">購入済み一覧</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        購入したエピソードと、その閲覧期限を確認できます。
      </p>
    </section>
    <SectionErrorBoundary title="購入済み一覧を表示できませんでした">
      <Suspense fallback={<PurchaseLibrarySkeleton />}>
        <PurchaseLibraryData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default PurchaseLibraryPage;
