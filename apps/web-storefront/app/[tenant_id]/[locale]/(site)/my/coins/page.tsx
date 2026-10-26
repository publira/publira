import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CoinBalanceSummary } from "#components/coin-balance-summary";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLogin } from "#lib/auth-session";
import { getCoinSettings, getMyCoinBalance } from "#lib/coins";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getTenantDisplayTimeZone, getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { CoinHistory } from "./_components/coin-history";
import { CoinPacks } from "./_components/coin-packs";
import { CoinsNotice } from "./_components/coins-notice";
import { coinsPageHref } from "./_lib/search-params";
import type { CoinsPageSearchParams } from "./_lib/search-params";

/**
 * The page is titled with the tenant's word for its coins, as its heading is.
 * A tenant that offers none, or a read that failed, leaves the title of My
 * Page, which this page sits under.
 */
export const generateMetadata = async (): Promise<Metadata> => {
  const [tenantId, locale, t] = await Promise.all([
    getTenantId(),
    getLocale(),
    getMessages(),
  ]);
  const settings = await getCoinSettings(tenantId, locale);

  return {
    title:
      (settings.ok ? settings.value?.coinName : "") || t("storefront.my.title"),
  };
};

/**
 * Each heading names its section, which is what turns the `<section>` into a
 * landmark a reader can jump to and a test can scope to.
 */
const BALANCE_HEADING_ID = "coin-balance-heading";
const PACKS_HEADING_ID = "coin-packs-heading";
const HISTORY_HEADING_ID = "coin-history-heading";

const CoinBalanceSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [balance, timeZone] = await Promise.all([
    getMyCoinBalance(tenantId, locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!balance.ok && balance.requiresSignIn) {
    await redirectToLogin(locale, coinsPageHref(""), tenantId);
  }
  if (!balance.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.coins.balance_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{balance.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }
  // The tenant turned its coins off after the page read them.
  if (!balance.value) {
    return null;
  }

  return (
    <CoinBalanceSummary
      balance={balance.value}
      locale={locale}
      timeZone={timeZone}
    />
  );
};

/**
 * The page under its heading: the tenant's coins are read before anything
 * else, because a tenant that offers none has no such page, and only then is
 * the request's query awaited.
 */
const CoinsContent = async ({
  searchParams,
}: {
  searchParams: CoinsPageSearchParams;
}) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [settingsResult, tenant] = await Promise.all([
    getCoinSettings(tenantId, locale),
    getTenantSiteInfo(tenantId),
  ]);
  if (!settingsResult.ok) {
    return <PageLoadError description={settingsResult.message} />;
  }
  if (!settingsResult.value) {
    notFound();
  }
  const settings = settingsResult.value;

  return (
    <>
      <section className="border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">{settings.coinName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message
              message="storefront.coins.description"
              values={{ coin_name: settings.coinName }}
            />
          </Suspense>
        </p>
      </section>

      <Suspense fallback={null}>
        <CoinsNotice coinName={settings.coinName} searchParams={searchParams} />
      </Suspense>

      <section
        aria-labelledby={BALANCE_HEADING_ID}
        className="border border-border bg-card p-6"
      >
        <h2 className="mb-4 text-lg font-semibold" id={BALANCE_HEADING_ID}>
          <Suspense fallback={<SkeletonLine className="h-6 w-24" />}>
            <Message message="storefront.coins.balance_heading" />
          </Suspense>
        </h2>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.coins.balance_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<SkeletonLine className="h-8 w-32" />}>
            <CoinBalanceSection />
          </Suspense>
        </SectionErrorBoundary>
      </section>

      <section
        aria-labelledby={PACKS_HEADING_ID}
        className="border border-border bg-card p-6"
      >
        <h2 className="mb-4 text-lg font-semibold" id={PACKS_HEADING_ID}>
          <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
            <Message
              message="storefront.coins.packs_heading"
              values={{ coin_name: settings.coinName }}
            />
          </Suspense>
        </h2>
        <CoinPacks
          acceptsPayments={tenant?.acceptsPayments ?? false}
          locale={locale}
          settings={settings}
          tenantId={tenantId}
        />
      </section>

      <section
        aria-labelledby={HISTORY_HEADING_ID}
        className="border border-border bg-card p-6"
      >
        <h2 className="mb-4 text-lg font-semibold" id={HISTORY_HEADING_ID}>
          <Suspense fallback={<SkeletonLine className="h-6 w-24" />}>
            <Message message="storefront.coins.history_heading" />
          </Suspense>
        </h2>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.coins.history_error" />
            </Suspense>
          }
        >
          <Suspense
            fallback={<div className="h-32 w-full animate-pulse bg-muted" />}
          >
            <CoinHistory searchParams={searchParams} />
          </Suspense>
        </SectionErrorBoundary>
      </section>
    </>
  );
};

type CoinsPageProps = PageProps<"/[tenant_id]/[locale]/my/coins">;

/**
 * The reader's coins, under the tenant's word for them: what they hold and
 * when it expires, the packs on sale with what the tenant discloses about
 * them, and everything that added or took coins, a page at a time. It is
 * where a pack's checkout sends the reader back to when it was not started
 * from an episode.
 */
const CoinsPage = ({ searchParams }: CoinsPageProps) => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <Suspense
      fallback={
        <section className="border border-border bg-card p-6">
          <SkeletonLine className="h-6 w-32" />
          <SkeletonLine className="mt-2 h-4 w-80" />
        </section>
      }
    >
      <CoinsContent searchParams={searchParams} />
    </Suspense>
  </div>
);

export default CoinsPage;
