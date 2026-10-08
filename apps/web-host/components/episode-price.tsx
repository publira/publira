import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { FreeUntilBadge } from "#components/free-until-badge";
import { Message } from "#components/message";
import { episodeSaleDestination } from "#lib/app-payments";
import type { TenantSales } from "#lib/app-payments";
import type { EpisodePurchaseSurface } from "#lib/catalog";

/**
 * The end of a free reading period open on the episode, and the zone it is
 * written in. Passed together or not at all, so a caller that has the end
 * cannot leave it to be written in a zone nobody chose.
 */
type FreeUntilProps =
  | { freeUntil?: undefined; timeZone?: undefined }
  | {
      /** RFC3339 end of the open period; absent when none is open. */
      freeUntil: string | undefined;
      /** The tenant's time zone. */
      timeZone: string;
    };

/**
 * What an episode costs on this site: free, its price, or — where the site
 * sends the reader to the app to buy it, as the access gate does — that it is
 * sold there, because a price the web cannot take leads nowhere. An episode
 * nobody can buy right now is quoted like any other.
 *
 * A priced episode inside an open free reading period says until when it is
 * free instead of quoting the price, because the price is what it costs only
 * after that.
 */
export const EpisodePrice = ({
  freeUntil,
  locale,
  price,
  purchaseSurface,
  sales,
  timeZone,
}: FreeUntilProps & {
  locale: Locale;
  price: number;
  purchaseSurface: EpisodePurchaseSurface;
  /** Where the tenant can sell an episode right now. */
  sales: TenantSales;
}) => {
  if (freeUntil && timeZone) {
    return (
      <FreeUntilBadge
        freeUntil={freeUntil}
        locale={locale}
        timeZone={timeZone}
      />
    );
  }
  if (price <= 0) {
    return (
      <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
        <Message message="host.common.free" />
      </Suspense>
    );
  }
  if (episodeSaleDestination(purchaseSurface, sales) === "app") {
    return (
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="host.common.sold_in_app" />
      </Suspense>
    );
  }
  return `¥${price.toLocaleString(toIntlLocale(locale))}`;
};
