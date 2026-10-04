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
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  emptyTenantPaymentSettings,
  getTenantPaymentSettings,
  listPaymentProviders,
} from "#lib/payment-settings";
import {
  getTenantStorePaymentSettings,
  listTenantStoreProducts,
} from "#lib/store-payment-settings";
import { storefrontOrigin, tenantWebhookUrl } from "#lib/storefront-url";
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";
import { getTenantPurchaseSettings } from "#lib/tenant-purchase-settings";

import { StoreProductList } from "./_components/store-product-list";
import { TenantPaymentSettingsForm } from "./_components/tenant-payment-settings-form";
import { TenantPurchaseSettingsForm } from "./_components/tenant-purchase-settings-form";
import { TenantStorePaymentSettingsForm } from "./_components/tenant-store-payment-settings-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.integrations.payment_title")
      : t("admin.not_found.title"),
  };
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

const SettingsPaymentForm = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [
    paymentSettingsResult,
    providersResult,
    currentUserResult,
    tenantResult,
  ] = await Promise.all([
    getTenantPaymentSettings(tenantId, locale),
    listPaymentProviders(tenantId, locale),
    getAdminCurrentUser(tenantId),
    getTenantForSession(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(
    paymentSettingsResult,
    providersResult,
    currentUserResult,
    tenantResult
  );

  let loadErrorMessage: string | undefined;
  if (!paymentSettingsResult.ok) {
    loadErrorMessage = paymentSettingsResult.message;
  } else if (!providersResult.ok) {
    loadErrorMessage = providersResult.message;
  }

  return (
    <TenantPaymentSettingsForm
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      initialSettings={
        paymentSettingsResult.ok
          ? paymentSettingsResult.settings
          : emptyTenantPaymentSettings
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
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      initialSettings={
        purchaseSettingsResult.ok ? purchaseSettingsResult.settings : undefined
      }
      loadErrorMessage={
        purchaseSettingsResult.ok ? undefined : purchaseSettingsResult.message
      }
      tenantId={tenantId}
    />
  );
};

const SettingsStorePaymentFormSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-40" />
    <div className="grid gap-3">
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  </div>
);

const SettingsStorePaymentForm = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [storeSettingsResult, currentUserResult, tenantResult] =
    await Promise.all([
      getTenantStorePaymentSettings(tenantId, locale),
      getAdminCurrentUser(tenantId),
      getTenantForSession(tenantId),
    ]);

  await redirectToLoginIfSessionRejected(
    storeSettingsResult,
    currentUserResult,
    tenantResult
  );

  return (
    <TenantStorePaymentSettingsForm
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      initialSettings={
        storeSettingsResult.ok ? storeSettingsResult.settings : undefined
      }
      loadErrorMessage={
        storeSettingsResult.ok ? undefined : storeSettingsResult.message
      }
      notificationUrl={
        tenantResult.ok
          ? tenantWebhookUrl(tenantResult.tenant.domain, "app-store")
          : undefined
      }
      tenantId={tenantId}
    />
  );
};

const StoreProductsSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-32" />
    <div className="grid gap-2">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  </div>
);

const StoreProducts = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const result = await listTenantStoreProducts(tenantId, locale);

  await redirectToLoginIfSessionRejected(result);

  return (
    <StoreProductList
      listErrorMessage={result.ok ? undefined : result.message}
      locale={locale}
      products={result.ok ? result.products : []}
    />
  );
};

const IntegrationsPaymentPage = () => (
  <AdminPage>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <AdminPageHeader>
          <AdminPageHeading>
            <AdminPageTitle>
              <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
                <Message message="admin.integrations.payment_title" />
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
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.settings.store_payment.section_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<SettingsStorePaymentFormSkeleton />}>
                <SettingsStorePaymentForm />
              </Suspense>
            </SectionErrorBoundary>
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.settings.store_products.section_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<StoreProductsSkeleton />}>
                <StoreProducts />
              </Suspense>
            </SectionErrorBoundary>
          </div>
        </AdminPageContent>
      </TenantAdminRoute>
    </Suspense>
  </AdminPage>
);

export default IntegrationsPaymentPage;
