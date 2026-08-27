import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
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
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { TenantEmailSettingsForm } from "../_components/tenant-email-settings-form";
import {
  sendTenantSmtpTestEmailAction,
  updateTenantEmailSettingsAction,
} from "../_lib/actions";

export const metadata: Metadata = {
  title: "設定 - メール情報",
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
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-10 animate-pulse rounded bg-muted/70" />
      <div className="h-10 animate-pulse rounded bg-muted/70" />
      <div className="h-10 animate-pulse rounded bg-muted/70" />
      <div className="h-10 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const SettingsEmailForm = async () => {
  const tenantId = await getTenantId();

  const [emailSettingsResult, currentUserResult, tenantResult] =
    await Promise.all([
      getTenantEmailSettings(tenantId),
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
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>設定</AdminPageTitle>
        <AdminPageDescription>
          テナントごとのメール送信設定を管理します。
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="email" />
        <SectionErrorBoundary
          description={
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.common.retry_later" />
            </Suspense>
          }
          digestLabel={
            <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
              <Message message="admin.common.error_id" />
            </Suspense>
          }
          retryLabel={
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.common.retry" />
            </Suspense>
          }
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
