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
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { listNotifications } from "#lib/notification";
import { getTenantId } from "#lib/tenant-id";

import { NotificationManager } from "./_components/notification-manager";

type NotificationsPageProps = PageProps<"/[tenant_id]/notifications">;

export const metadata: Metadata = {
  title: "通知",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NotificationManagerSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const NotificationManagerData = async ({
  searchParams,
}: Pick<NotificationsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const listResult = await listNotifications(tenantId, { token });

  return (
    <NotificationManager
      {...cursorPageHrefs(listResult)}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      notifications={listResult.notifications}
      pageSize={DEFAULT_PAGE_SIZE}
    />
  );
};

const NotificationsPage = ({ searchParams }: NotificationsPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>通知</AdminPageTitle>
        <AdminPageDescription>
          通知の作成状況と配信対象を確認できます。
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<NotificationManagerSkeleton />}>
        <NotificationManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default NotificationsPage;
