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
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantAnalyticsSettings } from "#lib/tenant-analytics-settings";
import { getTenantId } from "#lib/tenant-id";

import { GoogleTagForm } from "./_components/google-tag-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.integrations.google_tag_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const GoogleTagSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-4 w-80" />
    <div className="grid gap-3 sm:max-w-3xl">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-40" />
    </div>
  </div>
);

const GoogleTagSection = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const result = await getTenantAnalyticsSettings(tenantId, locale);
  await redirectToLoginIfSessionRejected(result);

  return (
    <GoogleTagForm
      initialSettings={result.ok ? result.settings : undefined}
      loadErrorMessage={result.ok ? undefined : result.message}
      tenantId={tenantId}
    />
  );
};

const IntegrationsGoogleTagPage = () => (
  <AdminPage>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <AdminPageHeader>
          <AdminPageHeading>
            <AdminPageTitle>
              <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
                <Message message="admin.integrations.google_tag_title" />
              </Suspense>
            </AdminPageTitle>
            <AdminPageDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.integrations.google_tag_description" />
              </Suspense>
            </AdminPageDescription>
          </AdminPageHeading>
        </AdminPageHeader>
        <AdminPageContent>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.integrations.google_tag_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<GoogleTagSkeleton />}>
              <GoogleTagSection />
            </Suspense>
          </SectionErrorBoundary>
        </AdminPageContent>
      </TenantAdminRoute>
    </Suspense>
  </AdminPage>
);

export default IntegrationsGoogleTagPage;
