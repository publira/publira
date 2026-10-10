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
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getTenantEmailSender } from "#lib/email-settings";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  appleAndroidCallbackUrl,
  signInCallbackUrl,
} from "#lib/storefront-url";
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";
import { getTenantMobileAppAssociation } from "#lib/tenant-mobile-app-association";
import { getTenantSignInSettings } from "#lib/tenant-sign-in-settings";

import { TenantSignInSettingsForm } from "./_components/tenant-sign-in-settings-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.integrations.sign_in_title")
      : t("admin.not_found.title"),
  };
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
  const [
    result,
    currentUserResult,
    tenantResult,
    associationResult,
    senderResult,
  ] = await Promise.all([
    getTenantSignInSettings(tenantId, locale),
    getAdminCurrentUser(tenantId),
    getTenantForSession(tenantId),
    getTenantMobileAppAssociation(tenantId, locale),
    getTenantEmailSender(tenantId, locale),
  ]);
  await redirectToLoginIfSessionRejected(
    result,
    currentUserResult,
    tenantResult,
    associationResult,
    senderResult
  );
  const domain = tenantResult.ok ? tenantResult.tenant.domain : "";

  return (
    <TenantSignInSettingsForm
      androidApplicationId={
        associationResult.ok
          ? (associationResult.association.android?.applicationId ?? "")
          : undefined
      }
      appLinksErrorMessage={
        associationResult.ok ? undefined : associationResult.message
      }
      callbackUrls={{
        apple: signInCallbackUrl(domain, "apple"),
        appleAndroid: appleAndroidCallbackUrl(domain),
        google: signInCallbackUrl(domain, "google"),
      }}
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      emailSender={senderResult.ok ? senderResult.fromAddress : undefined}
      emailSenderErrorMessage={
        senderResult.ok ? undefined : senderResult.message
      }
      initialSettings={result.ok ? result.settings : undefined}
      loadErrorMessage={result.ok ? undefined : result.message}
      tenantId={tenantId}
    />
  );
};

const IntegrationsSignInPage = () => (
  <AdminPage>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <AdminPageHeader>
          <AdminPageHeading>
            <AdminPageTitle>
              <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
                <Message message="admin.integrations.sign_in_title" />
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
        </AdminPageContent>
      </TenantAdminRoute>
    </Suspense>
  </AdminPage>
);

export default IntegrationsSignInPage;
