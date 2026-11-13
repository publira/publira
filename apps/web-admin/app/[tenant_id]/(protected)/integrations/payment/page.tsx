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
  listTenantPaymentProviders,
} from "#lib/payment-settings";
import type { PaymentProvider } from "#lib/payment-settings";
import { getTenantCurrency } from "#lib/public-api";
import {
  getTenantStorePaymentSettings,
  listTenantStoreProducts,
} from "#lib/store-payment-settings";
import { storefrontOrigin, tenantWebhookUrl } from "#lib/storefront-url";
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";
import { getTenantPurchaseSettings } from "#lib/tenant-purchase-settings";

import { StoreProductList } from "./_components/store-product-list";
import { TenantPaymentProviderList } from "./_components/tenant-payment-provider-list";
import { TenantPaymentSettingsForm } from "./_components/tenant-payment-settings-form";
import { TenantPurchaseSettingsForm } from "./_components/tenant-purchase-settings-form";
import { TenantStorePaymentSettingsForm } from "./_components/tenant-store-payment-settings-form";
import { TenantTipSettingsForm } from "./_components/tenant-tip-settings-form";

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

/**
 * The single-provider form, for a server of the release before, which holds one
 * provider per tenant.
 */
const SettingsPaymentSingleProviderForm = async ({
  canEdit,
  providers,
  providersErrorMessage,
  webhookOrigin,
}: {
  canEdit: boolean;
  providers: PaymentProvider[];
  providersErrorMessage?: string;
  webhookOrigin?: string;
}) => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const paymentSettingsResult = await getTenantPaymentSettings(
    tenantId,
    locale
  );

  await redirectToLoginIfSessionRejected(paymentSettingsResult);

  return (
    <TenantPaymentSettingsForm
      canEdit={canEdit}
      initialSettings={
        paymentSettingsResult.ok
          ? paymentSettingsResult.settings
          : emptyTenantPaymentSettings
      }
      loadErrorMessage={
        paymentSettingsResult.ok
          ? providersErrorMessage
          : paymentSettingsResult.message
      }
      locale={locale}
      providers={providers}
      tenantId={tenantId}
      webhookOrigin={webhookOrigin}
    />
  );
};

const SettingsPaymentForm = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [heldResult, providersResult, currentUserResult, tenantResult] =
    await Promise.all([
      listTenantPaymentProviders(tenantId, locale),
      listPaymentProviders(tenantId, locale),
      getAdminCurrentUser(tenantId),
      getTenantForSession(tenantId),
    ]);

  await redirectToLoginIfSessionRejected(
    heldResult,
    providersResult,
    currentUserResult,
    tenantResult
  );

  const canEdit = isTenantAdminRole(
    currentUserResult.ok ? currentUserResult.user.role : undefined
  );

  const providers = providersResult.ok ? providersResult.providers : [];

  const webhookOrigin = tenantResult.ok
    ? storefrontOrigin(tenantResult.tenant.domain)
    : undefined;

  if (!heldResult.ok && heldResult.unsupported) {
    return (
      <SettingsPaymentSingleProviderForm
        canEdit={canEdit}
        providers={providers}
        providersErrorMessage={
          providersResult.ok ? undefined : providersResult.message
        }
        webhookOrigin={webhookOrigin}
      />
    );
  }

  let loadErrorMessage: string | undefined;

  if (!heldResult.ok) {
    loadErrorMessage = heldResult.message;
  } else if (!providersResult.ok) {
    loadErrorMessage = providersResult.message;
  }

  return (
    <TenantPaymentProviderList
      canEdit={canEdit}
      held={
        heldResult.ok
          ? heldResult.held
          : { currency: "", currencyLocked: false, providers: [] }
      }
      loadErrorMessage={loadErrorMessage}
      locale={locale}
      providers={providers}
      tenantId={tenantId}
      webhookOrigin={webhookOrigin}
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
      googlePlayNotificationUrl={
        tenantResult.ok
          ? tenantWebhookUrl(tenantResult.tenant.domain, "google-play")
          : undefined
      }
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

const SettingsTipFormSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-16" />
    <div className="grid gap-3">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  </div>
);

const SettingsTipForm = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [purchaseSettingsResult, currentUserResult, currency, t] =
    await Promise.all([
      getTenantPurchaseSettings(tenantId, locale),
      getAdminCurrentUser(tenantId),
      getTenantCurrency(tenantId),
      getMessagesFor(locale),
    ]);

  await redirectToLoginIfSessionRejected(
    purchaseSettingsResult,
    currentUserResult
  );

  let loadErrorMessage: string | undefined;

  if (!purchaseSettingsResult.ok) {
    loadErrorMessage = t("admin.settings.tips.load_failed");
  } else if (!currency) {
    loadErrorMessage = t("admin.settings.tips.currency_unavailable");
  }

  return (
    <TenantTipSettingsForm
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      currency={currency ?? undefined}
      initialSettings={
        purchaseSettingsResult.ok
          ? purchaseSettingsResult.settings.tips
          : undefined
      }
      loadErrorMessage={loadErrorMessage}
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
      subscriptionPlans={result.ok ? result.subscriptionPlans : []}
    />
  );
};

const IntegrationsPaymentPage = () => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
                <Message message="admin.integrations.payment_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.integrations.payment_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
        </ConsolePage.Header>
        <ConsolePage.Content>
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
                  <Message message="admin.settings.tips.section_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<SettingsTipFormSkeleton />}>
                <SettingsTipForm />
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
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default IntegrationsPaymentPage;
