import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { CoinBalanceItem } from "#lib/coins";

/**
 * The reader's coins at a glance: how many they can spend, when the first of
 * them expire, and what a refunded pack left them owing, each in the tenant's
 * word for its coins.
 */
export const CoinBalanceSummary = ({
  balance,
  locale,
  timeZone,
}: {
  balance: CoinBalanceItem;
  locale: Locale;
  /** The tenant's time zone, which the expiry date is written in. */
  timeZone: string;
}) => {
  const expiresOn = formatDate(balance.nearestExpiryAt, {
    fallback: "",
    locale,
    timeZone,
  });

  return (
    <div className="grid gap-1">
      <p className="font-serif text-3xl leading-tight tabular-nums">
        <Suspense fallback={<SkeletonLine className="h-8 w-32" />}>
          <Message
            message="storefront.coins.balance_value"
            values={{ coin_name: balance.coinName, count: balance.coins }}
          />
        </Suspense>
      </p>
      {expiresOn && balance.nearestExpiryCoins > 0 ? (
        <p className="text-sm text-muted-foreground tabular-nums">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message
              message="storefront.coins.nearest_expiry"
              values={{
                coin_name: balance.coinName,
                count: balance.nearestExpiryCoins,
                date: expiresOn,
              }}
            />
          </Suspense>
        </p>
      ) : null}
      {balance.owedCoins > 0 ? (
        <p className="text-sm text-muted-foreground tabular-nums">
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message
              message="storefront.coins.owed"
              values={{ coin_name: balance.coinName, count: balance.owedCoins }}
            />
          </Suspense>
        </p>
      ) : null}
    </div>
  );
};
