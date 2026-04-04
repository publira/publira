import { LinkButton } from "@publira/ui-components/button";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminPage } from "#components/admin-page";
import { listNotifications } from "#lib/notification";

import { NotificationForm } from "../_components/notification-form";
import { createNotificationAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "通知作成",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

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

const NotificationFormData = async ({
  tenantPublicId,
}: {
  tenantPublicId: string;
}) => {
  const listResult = await listNotifications(tenantPublicId);

  return (
    <NotificationForm
      action={createNotificationAction}
      tenantPublicId={tenantPublicId}
      users={listResult.users}
      usersErrorMessage={listResult.usersErrorMessage}
    />
  );
};

export default async function NewNotificationPage({
  params,
}: PageProps<"/[tenant_public_id]/notifications/new">) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  return (
    <AdminPage
      actions={
        <LinkButton render={<Link href="/notifications" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description="本文・リンク先・配信対象を指定して通知を配信します。"
      title="通知を作成"
    >
      <Suspense fallback={<NotificationFormSkeleton />}>
        <NotificationFormData tenantPublicId={tenant_public_id} />
      </Suspense>
    </AdminPage>
  );
}
