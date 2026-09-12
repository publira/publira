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
import { listAnnouncements } from "#lib/announcement";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { AnnouncementManager } from "./_components/announcement-manager";

type AnnouncementsPageProps = PageProps<"/[tenant_id]/announcements">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.announcements.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const AnnouncementManagerData = async ({
  searchParams,
}: Pick<AnnouncementsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);
  const [listResult, timeZone] = await Promise.all([
    listAnnouncements(tenantId, locale, { token }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <AnnouncementManager
      {...cursorPageHrefs(listResult)}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      announcements={listResult.announcements}
      locale={locale}
      pageSize={DEFAULT_PAGE_SIZE}
      timeZone={timeZone}
    />
  );
};

const AnnouncementsPage = ({ searchParams }: AnnouncementsPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
            <Message message="admin.announcements.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.announcements.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton
          render={<Link href="/announcements/new" />}
          variant="outline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.announcements.new_action" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<TableSkeleton />}>
        <AnnouncementManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default AnnouncementsPage;
