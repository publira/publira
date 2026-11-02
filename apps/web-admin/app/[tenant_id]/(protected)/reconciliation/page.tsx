import * as ConsolePage from "@publira/layouts/admin/console-page";
import { Button } from "@publira/ui-components/button";
import * as Drawer from "@publira/ui-components/drawer";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { UrlDrawer } from "#components/url-drawer";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  isReconciliationUnfinished,
  listPaymentReconciliations,
} from "#lib/payment-reconciliation";
import { listPaymentProviders } from "#lib/payment-settings";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { ReconcileForm } from "./_components/reconcile-form";
import { ReconciliationFindings } from "./_components/reconciliation-findings";
import { ReconciliationList } from "./_components/reconciliation-list";
import { RefreshWhileUnfinished } from "./_components/refresh-while-unfinished";
import { previousMonth } from "./_lib/period";
import {
  parseReconciliationSearchParams,
  reconciliationQuery,
} from "./_lib/search-params";

type ReconciliationPageProps = PageProps<"/[tenant_id]/reconciliation">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.reconciliation.title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const FindingsSkeleton = () => (
  <div className="grid gap-3">
    <SkeletonLine className="h-5 w-48" />
    <Skeleton className="h-64 w-full" />
  </div>
);

const ReconciliationContent = async ({
  searchParams,
}: Pick<ReconciliationPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const params = parseReconciliationSearchParams(sp);

  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  const [listResult, providersResult] = await Promise.all([
    listPaymentReconciliations(tenantId, locale, { token: params.token }),
    listPaymentProviders(tenantId, locale),
  ]);

  await redirectToLoginIfSessionRejected(listResult, providersResult);

  // Without the providers' names a run still says which one it read, by the
  // id the server stores.
  const providerNames: ReadonlyMap<string, string> = new Map(
    providersResult.ok
      ? providersResult.providers.map((provider) => [
          provider.id,
          provider.displayName,
        ])
      : []
  );

  const today = Temporal.Now.plainDateISO(timeZone);
  const { reconciliations } = listResult;

  return (
    <div className="grid gap-6">
      <ReconcileForm
        defaultPeriod={previousMonth(today)}
        tenantId={tenantId}
        timeZone={timeZone}
        today={today.toString()}
      />
      <ReconciliationList
        detailHref={(runId) =>
          reconciliationQuery({ run: runId, token: params.token })
        }
        listErrorMessage={listResult.ok ? undefined : listResult.message}
        locale={locale}
        nextHref={
          listResult.nextToken
            ? reconciliationQuery({ token: listResult.nextToken })
            : undefined
        }
        pageSize={DEFAULT_PAGE_SIZE}
        previousHref={
          listResult.previousToken
            ? reconciliationQuery({ token: listResult.previousToken })
            : undefined
        }
        providerNames={providerNames}
        reconciliations={reconciliations}
        timeZone={timeZone}
      />
      {reconciliations.some(isReconciliationUnfinished) ? (
        <RefreshWhileUnfinished />
      ) : null}
      {params.run ? (
        <UrlDrawer
          closeHref={reconciliationQuery({ token: params.token })}
          key={params.run}
        >
          <Drawer.Header>
            <Drawer.Title className="text-lg font-semibold">
              <Suspense fallback={<SkeletonLine className="h-6 w-24" />}>
                <Message message="admin.reconciliation.findings.title" />
              </Suspense>
            </Drawer.Title>
            <Drawer.Close
              render={<Button size="sm" type="button" variant="outline" />}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.reconciliation.findings.close" />
              </Suspense>
            </Drawer.Close>
          </Drawer.Header>
          <Suspense fallback={<FindingsSkeleton />}>
            <ReconciliationFindings
              locale={locale}
              providerNames={providerNames}
              run={reconciliations.find((run) => run.id === params.run)}
              searchParams={params}
              tenantId={tenantId}
              timeZone={timeZone}
            />
          </Suspense>
        </UrlDrawer>
      ) : null}
    </div>
  );
};

const ReconciliationPage = ({ searchParams }: ReconciliationPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
                <Message message="admin.reconciliation.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.reconciliation.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.reconciliation.list_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<Table.Skeleton />}>
              <ReconciliationContent searchParams={searchParams} />
            </Suspense>
          </SectionErrorBoundary>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default ReconciliationPage;
