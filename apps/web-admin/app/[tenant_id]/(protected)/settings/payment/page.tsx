import { getMessage } from "@publira/i18n";
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
import { getLocale, loadAdminMessages } from "#lib/locale";
import {
  emptyTenantPaymentSettings,
  getTenantPaymentSettings,
} from "#lib/payment-settings";
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { TenantPaymentSettingsForm } from "../_components/tenant-payment-settings-form";
import { updateTenantPaymentSettingsAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.settings.payment_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SettingsPaymentFormSkeleton = () => (
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

const tenantWebhookUrl = (domain: string): string | undefined => {
  const host = domain.trim();
  if (!host) {
    return undefined;
  }

  return `https://${host}/api/v1/webhook/stripe`;
};

const SettingsPaymentForm = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [paymentSettingsResult, currentUserResult, tenantResult] =
    await Promise.all([
      getTenantPaymentSettings(tenantId, locale),
      getAdminCurrentUser(tenantId),
      getTenantForSession(tenantId),
    ]);

  await redirectToLoginIfSessionRejected(
    paymentSettingsResult,
    currentUserResult,
    tenantResult
  );

  return (
    <TenantPaymentSettingsForm
      action={updateTenantPaymentSettingsAction}
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      initialSettings={
        paymentSettingsResult.ok
          ? paymentSettingsResult.settings
          : emptyTenantPaymentSettings
      }
      loadErrorMessage={
        paymentSettingsResult.ok ? undefined : paymentSettingsResult.message
      }
      webhookUrl={
        tenantResult.ok
          ? tenantWebhookUrl(tenantResult.tenant.domain)
          : undefined
      }
    />
  );
};

const SettingsPaymentPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
            <Message message="admin.settings.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.payment_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="payment" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.payment_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<SettingsPaymentFormSkeleton />}>
            <SettingsPaymentForm />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default SettingsPaymentPage;
