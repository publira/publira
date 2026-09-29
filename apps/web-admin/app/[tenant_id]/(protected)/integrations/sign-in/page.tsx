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
import { getTenantSignInSettings } from "#lib/tenant-sign-in-settings";

import { IntegrationsTabNav } from "../_components/integrations-tab-nav";
import { TenantSignInSettingsForm } from "./_components/tenant-sign-in-settings-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.integrations.sign_in_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SignInSettingsSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-40" />
    <div className="grid gap-3 sm:max-w-3xl">
      <Skeleton className="h-64" />
      <Skeleton className="h-40" />
    </div>
  </div>
);

const SignInSettingsSection = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const [result, currentUserResult] = await Promise.all([
    getTenantSignInSettings(tenantId, locale),
    getAdminCurrentUser(tenantId),
  ]);
  await redirectToLoginIfSessionRejected(result, currentUserResult);

  return (
    <TenantSignInSettingsForm
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      initialSettings={result.ok ? result.settings : undefined}
      loadErrorMessage={result.ok ? undefined : result.message}
      tenantId={tenantId}
    />
  );
};

const IntegrationsSignInPage = () => (
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
            <Message message="admin.integrations.sign_in_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <IntegrationsTabNav current="sign-in" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.integrations.sign_in_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<SignInSettingsSkeleton />}>
            <SignInSettingsSection />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default IntegrationsSignInPage;
