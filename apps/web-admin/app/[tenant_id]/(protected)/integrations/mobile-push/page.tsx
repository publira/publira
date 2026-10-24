import * as ConsolePage from "@publira/layouts/admin/console-page";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

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
import {
  emptyTenantFcmSettings,
  getTenantFcmSettings,
} from "#lib/fcm-settings";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { FcmCredentialsForm } from "./_components/fcm-credentials-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.integrations.mobile_push_title")
      : t("admin.not_found.title"),
  };
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
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
                <Message message="admin.integrations.mobile_push_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.integrations.mobile_push_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
        </ConsolePage.Header>
        <ConsolePage.Content>
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
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default IntegrationsMobilePushPage;
