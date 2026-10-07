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
import { getTenantEmailSettings } from "#lib/email-settings";
import type { TenantSmtpSettings } from "#lib/email-settings";
import {
  emptyTenantInboundEmailSettings,
  getTenantInboundEmailSettings,
  listInboundEmailProviders,
} from "#lib/inbound-email-settings";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { storefrontOrigin } from "#lib/storefront-url";
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";

import { TenantEmailSettingsForm } from "./_components/tenant-email-settings-form";
import { TenantInboundEmailSettingsForm } from "./_components/tenant-inbound-email-settings-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.integrations.email_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const emptySettings: TenantSmtpSettings = {
  encryption: "starttls",
  fromAddress: "",
  fromName: "",
  hasPassword: false,
  host: "",
  port: 587,
  replyTo: "",
  smtpOverrideEnabled: false,
  username: "",
};

const SettingsEmailFormSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-40" />
    <div className="grid gap-3">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  </div>
);

const SettingsEmailForm = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [emailSettingsResult, currentUserResult, tenantResult, t] =
    await Promise.all([
      getTenantEmailSettings(tenantId, locale),
      getAdminCurrentUser(tenantId),
      getTenantForSession(tenantId),
      getMessagesFor(locale),
    ]);

  await redirectToLoginIfSessionRejected(
    emailSettingsResult,
    currentUserResult,
    tenantResult
  );

  return (
    <TenantEmailSettingsForm
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      fromNamePlaceholder={
        (tenantResult.ok ? tenantResult.tenant.name : "") ||
        t("admin.settings.email.from_name_fallback")
      }
      initialSettings={
        emailSettingsResult.ok ? emailSettingsResult.settings : emptySettings
      }
      loadErrorMessage={
        emailSettingsResult.ok ? undefined : emailSettingsResult.message
      }
      tenantId={tenantId}
    />
  );
};

const SettingsInboundEmailFormSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-32" />
    <div className="grid gap-3">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  </div>
);

const SettingsInboundEmailForm = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [settingsResult, providersResult, currentUserResult, tenantResult] =
    await Promise.all([
      getTenantInboundEmailSettings(tenantId, locale),
      listInboundEmailProviders(tenantId, locale),
      getAdminCurrentUser(tenantId),
      getTenantForSession(tenantId),
    ]);

  await redirectToLoginIfSessionRejected(
    settingsResult,
    providersResult,
    currentUserResult,
    tenantResult
  );

  let loadErrorMessage: string | undefined;
  if (!settingsResult.ok) {
    loadErrorMessage = settingsResult.message;
  } else if (!providersResult.ok) {
    loadErrorMessage = providersResult.message;
  }

  return (
    <TenantInboundEmailSettingsForm
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      initialSettings={
        settingsResult.ok
          ? settingsResult.settings
          : emptyTenantInboundEmailSettings
      }
      loadErrorMessage={loadErrorMessage}
      providers={providersResult.ok ? providersResult.providers : []}
      tenantId={tenantId}
      webhookOrigin={
        tenantResult.ok
          ? storefrontOrigin(tenantResult.tenant.domain)
          : undefined
      }
    />
  );
};

const IntegrationsEmailPage = () => (
  <AdminPage>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <AdminPageHeader>
          <AdminPageHeading>
            <AdminPageTitle>
              <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
                <Message message="admin.integrations.email_title" />
              </Suspense>
            </AdminPageTitle>
            <AdminPageDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.integrations.email_description" />
              </Suspense>
            </AdminPageDescription>
          </AdminPageHeading>
        </AdminPageHeader>
        <AdminPageContent>
          <div className="grid gap-6">
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.integrations.email_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<SettingsEmailFormSkeleton />}>
                <SettingsEmailForm />
              </Suspense>
            </SectionErrorBoundary>
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.settings.inbound_email.section_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<SettingsInboundEmailFormSkeleton />}>
                <SettingsInboundEmailForm />
              </Suspense>
            </SectionErrorBoundary>
          </div>
        </AdminPageContent>
      </TenantAdminRoute>
    </Suspense>
  </AdminPage>
);

export default IntegrationsEmailPage;
