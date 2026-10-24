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
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
                <Message message="admin.integrations.google_tag_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.integrations.google_tag_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
        </ConsolePage.Header>
        <ConsolePage.Content>
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
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default IntegrationsGoogleTagPage;
