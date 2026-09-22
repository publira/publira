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
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantMobileAppAssociation } from "#lib/tenant-mobile-app-association";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { AppLinksForm } from "./_components/app-links-form";
import { updateAppLinksAction } from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.settings.app_links_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const AppLinksSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-24" />
    <div className="grid gap-3 sm:max-w-3xl">
      <Skeleton className="h-48" />
      <Skeleton className="h-48" />
    </div>
  </div>
);

const AppLinksSection = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const [result, currentUserResult] = await Promise.all([
    getTenantMobileAppAssociation(tenantId, locale),
    getAdminCurrentUser(tenantId),
  ]);
  await redirectToLoginIfSessionRejected(result, currentUserResult);

  return (
    <AppLinksForm
      action={updateAppLinksAction}
      association={result.ok ? result.association : {}}
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      loadErrorMessage={result.ok ? undefined : result.message}
      tenantId={tenantId}
    />
  );
};

const SettingsAppLinksPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
            <Message message="admin.settings.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.app_links_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="app-links" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.app_links_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<AppLinksSkeleton />}>
            <AppLinksSection />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default SettingsAppLinksPage;
