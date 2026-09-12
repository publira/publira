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
import { listPages } from "#lib/page";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { PageManager } from "./_components/page-manager";

type PagesPageProps = PageProps<"/[tenant_id]/pages">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.pages.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const PageManagerData = async ({
  searchParams,
}: Pick<PagesPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);
  const [listResult, timeZone] = await Promise.all([
    listPages(tenantId, locale, { token }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <PageManager
      {...cursorPageHrefs(listResult)}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      pageSize={DEFAULT_PAGE_SIZE}
      pages={listResult.pages}
      timeZone={timeZone}
    />
  );
};

const PagesPage = ({ searchParams }: PagesPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.pages.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.pages.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/pages/new" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.pages.new_action" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<TableSkeleton />}>
        <PageManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default PagesPage;
