import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminPage } from "#components/admin-page";
import { listNotifications } from "#lib/notification";
import { getTenantId } from "#lib/tenant-id";

import { NotificationManager } from "./_components/notification-manager";

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

const NotificationManagerData = async () => {
  const tenantId = await getTenantId();
  const listResult = await listNotifications(tenantId);

  return (
    <NotificationManager
      initialListErrorMessage={listResult.ok ? undefined : listResult.message}
      initialNotifications={listResult.notifications}
    />
  );
};

const NotificationsPage = () => (
  <AdminPage
    description="通知の作成状況と配信対象を確認できます。"
    title="通知"
  >
    <Suspense fallback={<NotificationManagerSkeleton />}>
      <NotificationManagerData />
    </Suspense>
  </AdminPage>
);

export default NotificationsPage;
