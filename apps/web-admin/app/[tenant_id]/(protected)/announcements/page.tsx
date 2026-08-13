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
import { listAnnouncements } from "#lib/announcement";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { AnnouncementManager } from "./_components/announcement-manager";

type AnnouncementsPageProps = PageProps<"/[tenant_id]/announcements">;

export const metadata: Metadata = {
  title: "お知らせ",
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
  const [listResult, timeZone] = await Promise.all([
    listAnnouncements(tenantId, { token }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  return (
    <AnnouncementManager
      {...cursorPageHrefs(listResult)}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      announcements={listResult.announcements}
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
        <AdminPageTitle>お知らせ</AdminPageTitle>
        <AdminPageDescription>
          お知らせの作成状況と配信対象を確認できます。
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
