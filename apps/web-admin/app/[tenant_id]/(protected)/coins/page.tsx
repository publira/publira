import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
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
import {
  coinNameFor,
  coinStatus,
  getCoinSettings,
  listCoinPacks,
} from "#lib/coins";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { findTenantLocales } from "#lib/tenant-locales";

import { CoinPackManager } from "./_components/coin-pack-manager";
import { CoinSettingsForm } from "./_components/coin-settings-form";
import { CoinStatusSummary } from "./_components/coin-status";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin ? t("admin.coins.title") : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const CoinsSkeleton = () => (
  <div className="grid gap-10">
    <div className="grid gap-2">
      <SkeletonLine className="h-5 w-40" />
      <SkeletonLine className="h-4 w-3/4" />
    </div>
    <div className="grid gap-3">
      <SkeletonLine className="h-5 w-32" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-24" />
    </div>
    <div className="grid gap-3">
      <SkeletonLine className="h-5 w-20" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  </div>
);

const CoinsLoadError = ({ message }: { message: string }) => (
  <SectionError.Root>
    <SectionError.Heading>
      <SectionError.Title>
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="admin.coins.section_error" />
        </Suspense>
      </SectionError.Title>
      <SectionError.Description>{message}</SectionError.Description>
    </SectionError.Heading>
  </SectionError.Root>
);

const CoinsContent = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [settingsResult, packsResult, tenantLocales, t] = await Promise.all([
    getCoinSettings(tenantId, locale),
    listCoinPacks(tenantId, locale),
    findTenantLocales(tenantId),
    getMessagesFor(locale),
  ]);

  await redirectToLoginIfSessionRejected(settingsResult, packsResult);

  if (!settingsResult.ok) {
    return <CoinsLoadError message={settingsResult.message} />;
  }

  // Reached by its URL while the platform does not let tenants issue coins:
  // nothing here could take effect, so the screen says why instead.
  if (!settingsResult.platformAllowsCoins) {
    return (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.coins.not_allowed_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message message="admin.coins.not_allowed_description" />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
    );
  }

  const { currency, settings } = settingsResult;

  if (!currency) {
    return (
      <CoinsLoadError
        message={t("admin.series.episodes.currency_unavailable")}
      />
    );
  }

  if (!tenantLocales) {
    return (
      <CoinsLoadError message={t("admin.coins.settings.locales_unavailable")} />
    );
  }

  const savedCoinName =
    coinNameFor(settings.names, locale, tenantLocales.defaultLocale) ?? "";

  const coinName = savedCoinName || t("admin.coins.fallback_name");

  return (
    <ConsoleSection.Stack>
      <CoinStatusSummary coinName={coinName} status={coinStatus(settings)} />
      <CoinSettingsForm
        coinName={coinName}
        currency={currency}
        savedCoinName={savedCoinName}
        settings={settings}
        tenantId={tenantId}
        tenantLocales={tenantLocales}
      />
      <CoinPackManager
        coinName={coinName}
        currency={currency}
        listErrorMessage={packsResult.ok ? undefined : packsResult.message}
        locale={locale}
        packs={packsResult.packs}
        savedCoinName={savedCoinName}
        tenantId={tenantId}
      />
    </ConsoleSection.Stack>
  );
};

const CoinsPage = () => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-20" />}>
                <Message message="admin.coins.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.coins.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.coins.section_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<CoinsSkeleton />}>
              <CoinsContent />
            </Suspense>
          </SectionErrorBoundary>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default CoinsPage;
