import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { TableSkeleton } from "@publira/ui-components/table";
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
  AdminSections,
} from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { buildQueryString } from "#lib/query-string";
import { listReaders } from "#lib/reader";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { ReaderFilterForm } from "./_components/reader-filter-form";
import { ReaderManager } from "./_components/reader-manager";
import { parseReaderFilters } from "./_lib/search-params";
import type { ReaderFilters } from "./_lib/search-params";

type ReadersPageProps = PageProps<"/[tenant_id]/readers">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.readers.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const ReadersSkeleton = () => (
  <AdminSections>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Skeleton className="h-16 md:col-span-2" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
    <TableSkeleton />
  </AdminSections>
);

/**
 * Query-only href for one page of the list. A cursor names a row of the list
 * it was issued for, so the search and the status travel with it.
 */
const readerPageHref = (filters: ReaderFilters, token: string) =>
  buildQueryString({ q: filters.query, status: filters.status, token });

const ReadersContent = async ({
  searchParams,
}: Pick<ReadersPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const filters = parseReaderFilters(sp);
  const locale = await getLocale(tenantId);

  const [result, timeZone] = await Promise.all([
    listReaders(tenantId, locale, {
      limit: DEFAULT_PAGE_SIZE,
      query: filters.query,
      status: filters.status,
      token: filters.token,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(result);

  return (
    <AdminSections>
      <ReaderFilterForm filters={filters} locale={locale} />
      <ReaderManager
        filtered={Boolean(filters.query || filters.status)}
        listErrorMessage={result.ok ? undefined : result.message}
        locale={locale}
        nextHref={
          result.nextToken
            ? readerPageHref(filters, result.nextToken)
            : undefined
        }
        pageSize={DEFAULT_PAGE_SIZE}
        previousHref={
          result.previousToken
            ? readerPageHref(filters, result.previousToken)
            : undefined
        }
        readers={result.readers}
        timeZone={timeZone}
      />
    </AdminSections>
  );
};

const ReadersPage = ({ searchParams }: ReadersPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.readers.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.readers.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast keyName="deleted" message="admin.readers.deleted" />
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.readers.list_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<ReadersSkeleton />}>
          <ReadersContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default ReadersPage;
