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
import {
  emptyTenantPaymentSettings,
  getTenantPaymentSettings,
} from "#lib/payment-settings";
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";
import { getTenantPurchaseSettings } from "#lib/tenant-purchase-settings";

import { IntegrationsTabNav } from "../_components/integrations-tab-nav";
import { TenantPaymentSettingsForm } from "./_components/tenant-payment-settings-form";
import { TenantPurchaseSettingsForm } from "./_components/tenant-purchase-settings-form";
import {
  updateTenantPaymentSettingsAction,
  updateTenantPurchaseSettingsAction,
} from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.integrations.payment_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SettingsPaymentFormSkeleton = () => (
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

const SettingsPurchaseFormSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-40" />
    <div className="grid gap-3">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  </div>
);

const SettingsPurchaseForm = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [purchaseSettingsResult, currentUserResult] = await Promise.all([
    getTenantPurchaseSettings(tenantId, locale),
    getAdminCurrentUser(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(
    purchaseSettingsResult,
    currentUserResult
  );

  return (
    <TenantPurchaseSettingsForm
      action={updateTenantPurchaseSettingsAction}
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      initialSettings={
        purchaseSettingsResult.ok ? purchaseSettingsResult.settings : undefined
      }
      loadErrorMessage={
        purchaseSettingsResult.ok ? undefined : purchaseSettingsResult.message
      }
    />
  );
};

const IntegrationsPaymentPage = () => (
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
            <Message message="admin.integrations.payment_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <IntegrationsTabNav current="payment" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.integrations.payment_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<SettingsPaymentFormSkeleton />}>
            <SettingsPaymentForm />
          </Suspense>
        </SectionErrorBoundary>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.purchase.section_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<SettingsPurchaseFormSkeleton />}>
            <SettingsPurchaseForm />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default IntegrationsPaymentPage;
