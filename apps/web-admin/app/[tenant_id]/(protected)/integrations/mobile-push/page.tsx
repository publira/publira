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
import {
  emptyTenantFcmSettings,
  getTenantFcmSettings,
} from "#lib/fcm-settings";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { IntegrationsTabNav } from "../_components/integrations-tab-nav";
import { FcmCredentialsForm } from "./_components/fcm-credentials-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.integrations.mobile_push_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const FcmCredentialsSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-48" />
    <div className="grid gap-3 sm:max-w-3xl">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  </div>
);

const FcmCredentialsSection = async () => {
  const tenantId = await getTenantId();
  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const result = await getTenantFcmSettings(tenantId, locale);
  await redirectToLoginIfSessionRejected(result);

  return (
    <FcmCredentialsForm
      loadErrorMessage={result.ok ? undefined : result.message}
      locale={locale}
      settings={result.ok ? result.settings : emptyTenantFcmSettings}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const IntegrationsMobilePushPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
            <Message message="admin.integrations.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.integrations.mobile_push_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <IntegrationsTabNav current="mobile-push" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.integrations.mobile_push_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<FcmCredentialsSkeleton />}>
            <FcmCredentialsSection />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default IntegrationsMobilePushPage;
