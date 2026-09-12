import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
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
import { listAllAnnouncementTargetUsers } from "#lib/announcement";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { AnnouncementForm } from "../_components/announcement-form";
import { createAnnouncementAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.announcements.new_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const AnnouncementFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-10" />
    <Skeleton className="h-28" />
    <Skeleton className="h-20" />
    <Skeleton className="ml-auto h-10 w-32" />
  </div>
);

const AnnouncementFormData = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const usersResult = await listAllAnnouncementTargetUsers(tenantId, locale);

  await redirectToLoginIfSessionRejected(usersResult);

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
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.announcements.new_title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.announcements.new_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/announcements" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.announcements.back_to_list" />
          </Suspense>
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
