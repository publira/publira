import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { TableSkeleton } from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { listSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { SeriesManager } from "./_components/series-manager";

type SeriesPageProps = PageProps<"/[tenant_id]/series">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.series.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SeriesManagerData = async ({
  searchParams,
}: Pick<SeriesPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);
  const [listResult, timeZone] = await Promise.all([
    listSeries(tenantId, locale, { token }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <SeriesManager
      {...cursorPageHrefs(listResult)}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      pageSize={DEFAULT_PAGE_SIZE}
      series={listResult.series}
      timeZone={timeZone}
    />
  );
};

const SeriesPage = ({ searchParams }: SeriesPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.series.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.series.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/series/new" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.series.new_action" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<TableSkeleton />}>
        <SeriesManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default SeriesPage;
