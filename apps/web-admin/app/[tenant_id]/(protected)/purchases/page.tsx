import { Button } from "@publira/ui-components/button";
import * as Drawer from "@publira/ui-components/drawer";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listPaymentProviders } from "#lib/payment-settings";
import { listPurchases } from "#lib/purchase";
import type { ListPurchasesResult } from "#lib/purchase";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { PurchaseDetail } from "./_components/purchase-detail";
import { PurchaseDrawer } from "./_components/purchase-drawer";
import { PurchaseFilterForm } from "./_components/purchase-filter-form";
import { PurchaseList } from "./_components/purchase-list";
import {
  parsePurchaseFilters,
  purchaseListQuery,
  purchasePeriod,
} from "./_lib/search-params";

type PurchasesPageProps = PageProps<"/[tenant_id]/purchases">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin ? t("admin.purchases.title") : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const PurchaseDetailSkeleton = () => (
  <div className="grid gap-3">
    <SkeletonLine className="h-5 w-24" />
    <Skeleton className="h-64 w-full" />
  </div>
);

const PurchasesContent = async ({
  searchParams,
}: Pick<PurchasesPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const filters = parsePurchaseFilters(sp);
  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const period = purchasePeriod(filters, timeZone);
  const now = Temporal.Now.instant();

  const [t, listResult, providersResult] = await Promise.all([
    getMessagesFor(locale),
    // A period that ends before it starts matches nothing, and the API refuses
    // it, so it is reported rather than asked.
    period
      ? listPurchases(tenantId, locale, {
          episodePublicId: filters.episode,
          readerEmail: filters.email,
          seriesPublicId: filters.series,
          token: filters.token,
          ...period,
        })
      : Promise.resolve<ListPurchasesResult | null>(null),
    listPaymentProviders(tenantId, locale),
  ]);
  if (listResult) {
    await redirectToLoginIfSessionRejected(listResult, providersResult);
  }

  let listErrorMessage: string | undefined;
  if (!listResult) {
    listErrorMessage = t("admin.purchases.period_invalid");
  } else if (!listResult.ok) {
    listErrorMessage = listResult.message;
  }

  // Without the providers' names a purchase still says which one it was paid
  // through, by the id the server stores.
  const providerNames: ReadonlyMap<string, string> = new Map(
    providersResult.ok
      ? providersResult.providers.map((provider) => [
          provider.id,
          provider.displayName,
        ])
      : []
  );

  return (
    <div className="grid gap-6">
      <PurchaseFilterForm
        filters={filters}
        locale={locale}
        timeZone={timeZone}
      />
      <PurchaseList
        detailHref={(purchaseId) =>
          purchaseListQuery(filters, {
            purchase: purchaseId,
            token: filters.token,
          })
        }
        listErrorMessage={listErrorMessage}
        locale={locale}
        nextHref={
          listResult?.nextToken
            ? purchaseListQuery(filters, { token: listResult.nextToken })
            : undefined
        }
        now={now}
        pageSize={DEFAULT_PAGE_SIZE}
        previousHref={
          listResult?.previousToken
            ? purchaseListQuery(filters, { token: listResult.previousToken })
            : undefined
        }
        providerNames={providerNames}
        purchases={listResult?.purchases ?? []}
        timeZone={timeZone}
      />
      {filters.purchase ? (
        <PurchaseDrawer
          closeHref={purchaseListQuery(filters, { token: filters.token })}
          key={filters.purchase}
        >
          <Drawer.Header>
            <Drawer.Title className="text-lg font-semibold">
              <Suspense fallback={<SkeletonLine className="h-6 w-24" />}>
                <Message message="admin.purchases.detail_title" />
              </Suspense>
            </Drawer.Title>
            <Drawer.Close
              render={<Button size="sm" type="button" variant="outline" />}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.purchases.close" />
              </Suspense>
            </Drawer.Close>
          </Drawer.Header>
          <Suspense fallback={<PurchaseDetailSkeleton />}>
            <PurchaseDetail
              locale={locale}
              now={now}
              providerNames={providerNames}
              purchaseId={filters.purchase}
              tenantId={tenantId}
              timeZone={timeZone}
            />
          </Suspense>
        </PurchaseDrawer>
      ) : null}
    </div>
  );
};

const PurchasesPage = ({ searchParams }: PurchasesPageProps) => (
  <AdminPage>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <AdminPageHeader>
          <AdminPageHeading>
            <AdminPageTitle>
              <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
                <Message message="admin.purchases.title" />
              </Suspense>
            </AdminPageTitle>
            <AdminPageDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.purchases.page_description" />
              </Suspense>
            </AdminPageDescription>
          </AdminPageHeading>
        </AdminPageHeader>
        <AdminPageContent>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.purchases.list_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<Table.Skeleton />}>
              <PurchasesContent searchParams={searchParams} />
            </Suspense>
          </SectionErrorBoundary>
        </AdminPageContent>
      </TenantAdminRoute>
    </Suspense>
  </AdminPage>
);

export default PurchasesPage;
