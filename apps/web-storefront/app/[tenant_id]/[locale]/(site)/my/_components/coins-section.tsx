import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { CoinBalanceSummary } from "#components/coin-balance-summary";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { redirectToLogin } from "#lib/auth-session";
import { getCoinSettings, getMyCoinBalance } from "#lib/coins";
import { getLocale } from "#lib/locale";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

/**
 * Its heading names the section, which is what turns the `<section>` into a
 * landmark a reader can jump to and a test can scope to.
 */
const COINS_HEADING_ID = "coins-heading";

/**
 * The section, headed by the tenant's word for its coins. A reader whose
 * reads both failed is shown the failure alone, because there is then no word
 * to head it with.
 */
const CoinsFrame = ({
  children,
  coinName,
}: {
  children: ReactNode;
  coinName: string;
}) =>
  coinName ? (
    <section
      aria-labelledby={COINS_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2 className="mb-4 text-lg font-semibold" id={COINS_HEADING_ID}>
        {coinName}
      </h2>
      {children}
    </section>
  ) : (
    <section className="border border-border bg-card p-6">{children}</section>
  );

/**
 * The reader's coins on My Page: what they hold and when the first of them
 * expire, and the way to `/my/coins`, where packs are bought and the history
 * is listed. On a site that offers no coins the section renders nothing.
 */
export const CoinsSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [settings, balance] = await Promise.all([
    getCoinSettings(tenantId, locale),
    getMyCoinBalance(tenantId, locale),
  ]);

  if (!balance.ok && balance.requiresSignIn) {
    await redirectToLogin(locale, "/my", tenantId);
  }
  if ((settings.ok && !settings.value) || (balance.ok && !balance.value)) {
    return null;
  }

  const coinName =
    (settings.ok ? settings.value?.coinName : "") ||
    (balance.ok ? balance.value?.coinName : "") ||
    "";

  if (!(balance.ok && balance.value)) {
    return (
      <CoinsFrame coinName={coinName}>
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="storefront.coins.balance_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {balance.ok ? "" : balance.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      </CoinsFrame>
    );
  }

  const timeZone = await getTenantDisplayTimeZone(tenantId);

  return (
    <CoinsFrame coinName={coinName}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <CoinBalanceSummary
          balance={balance.value}
          locale={locale}
          timeZone={timeZone}
        />
        <LinkButton render={<LocaleLink href="/my/coins" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
            <Message
              message="storefront.my.to_coins"
              values={{ coin_name: coinName }}
            />
          </Suspense>
        </LinkButton>
      </div>
    </CoinsFrame>
  );
};
