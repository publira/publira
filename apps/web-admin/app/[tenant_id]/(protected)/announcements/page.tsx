import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
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
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.announcements.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const AnnouncementManagerSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const AnnouncementManagerData = async ({
  searchParams,
}: Pick<AnnouncementsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);
  const [listResult, timeZone] = await Promise.all([
    listAnnouncements(tenantId, { token }, locale),
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
        <AdminPageEyebrow>Console</AdminPageEyebrow>
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
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<AnnouncementManagerSkeleton />}>
        <AnnouncementManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default AnnouncementsPage;
