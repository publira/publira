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
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getTenantEmailSettings } from "#lib/email-settings";
import type { TenantSmtpSettings } from "#lib/email-settings";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { TenantEmailSettingsForm } from "../_components/tenant-email-settings-form";
import {
  sendTenantSmtpTestEmailAction,
  updateTenantEmailSettingsAction,
} from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.settings.email_title") };
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

  const [emailSettingsResult, currentUserResult, tenantResult] =
    await Promise.all([
      getTenantEmailSettings(tenantId, locale),
      getAdminCurrentUser(tenantId),
      getTenantForSession(tenantId),
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
      initialSettings={
        emailSettingsResult.ok ? emailSettingsResult.settings : emptySettings
      }
      loadErrorMessage={
        emailSettingsResult.ok ? undefined : emailSettingsResult.message
      }
      saveAction={updateTenantEmailSettingsAction}
      tenantName={tenantResult.ok ? tenantResult.tenant.name : ""}
      testAction={sendTenantSmtpTestEmailAction}
    />
  );
};

const SettingsEmailPage = () => (
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
            <Message message="admin.settings.email_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="email" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.email_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<SettingsEmailFormSkeleton />}>
            <SettingsEmailForm />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default SettingsEmailPage;
