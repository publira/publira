import { LinkButton } from "@publira/ui-components/button";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { listAllNotificationTargetUsers } from "#lib/notification";
import { getTenantId } from "#lib/tenant-id";

import { NotificationForm } from "../_components/notification-form";
import { createNotificationAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "通知作成",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NotificationFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-10 animate-pulse rounded bg-muted/70" />
      <div className="h-28 animate-pulse rounded bg-muted/70" />
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-32 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const NotificationFormData = async () => {
  const tenantId = await getTenantId();
  const usersResult = await listAllNotificationTargetUsers(tenantId);

  return (
    <NotificationForm
      action={createNotificationAction}
      users={usersResult.users}
      usersErrorMessage={usersResult.ok ? undefined : usersResult.message}
    />
  );
};

const NewNotificationPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>通知を作成</AdminPageTitle>
        <AdminPageDescription>
          本文・リンク先・配信対象を指定して通知を配信します。
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/notifications" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<NotificationFormSkeleton />}>
        <NotificationFormData />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default NewNotificationPage;
