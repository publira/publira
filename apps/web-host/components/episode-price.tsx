import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { EpisodePurchaseSurface } from "#lib/catalog";

/**
 * What an episode costs on this site: free, its price, or — where it is sold
 * in the app alone — that it is sold there, because a price the web cannot
 * take leads nowhere.
 */
export const EpisodePrice = ({
  locale,
  price,
  purchaseSurface,
}: {
  locale: Locale;
  price: number;
  purchaseSurface: EpisodePurchaseSurface;
}) => {
  if (price <= 0) {
    return (
      <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
        <Message message="host.common.free" />
      </Suspense>
    );
  }
  if (purchaseSurface === "app") {
    return (
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="host.common.sold_in_app" />
      </Suspense>
    );
  }
  return `¥${price.toLocaleString(toIntlLocale(locale))}`;
};
