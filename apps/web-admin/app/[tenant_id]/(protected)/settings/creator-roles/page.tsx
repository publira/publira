import { getMessage } from "@publira/i18n";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listCreatorRoles } from "#lib/creator-roles";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { CreatorRoleManager } from "./_components/creator-role-manager";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.creator_roles.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const CreatorRoleManagerSkeleton = () => (
  <div className="grid gap-6">
    <div className="grid gap-4">
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-10" />
    </div>
    <div className="grid gap-4">
      <SkeletonLine className="h-5 w-32" />
      <div className="grid gap-3">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    </div>
  </div>
);

const CreatorRoleManagerData = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const listResult = await listCreatorRoles(tenantId, locale);

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <CreatorRoleManager
      creatorRoles={listResult.creatorRoles}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      tenantId={tenantId}
    />
  );
};

const SettingsCreatorRolesPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.creator_roles.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.creator_roles.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="creator-roles" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.creator_roles.list_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<CreatorRoleManagerSkeleton />}>
            <CreatorRoleManagerData />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default SettingsCreatorRolesPage;
