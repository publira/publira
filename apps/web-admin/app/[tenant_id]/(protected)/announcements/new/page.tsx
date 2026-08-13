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
import { listAllAnnouncementTargetUsers } from "#lib/announcement";
import { getTenantId } from "#lib/tenant-id";

import { AnnouncementForm } from "../_components/announcement-form";
import { createAnnouncementAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "お知らせ作成",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const AnnouncementFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-10 animate-pulse rounded bg-muted/70" />
      <div className="h-28 animate-pulse rounded bg-muted/70" />
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-32 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const AnnouncementFormData = async () => {
  const tenantId = await getTenantId();
  const usersResult = await listAllAnnouncementTargetUsers(tenantId);

  return (
    <AnnouncementForm
      action={createAnnouncementAction}
      users={usersResult.users}
      usersErrorMessage={usersResult.ok ? undefined : usersResult.message}
    />
  );
};

const NewAnnouncementPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>お知らせを作成</AdminPageTitle>
        <AdminPageDescription>
          本文・リンク先・配信対象を指定してお知らせを配信します。
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/announcements" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<AnnouncementFormSkeleton />}>
        <AnnouncementFormData />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default NewAnnouncementPage;
