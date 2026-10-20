import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatPrice } from "@publira/utils";
import { Suspense } from "react";

import { CampaignPrice } from "#components/campaign-price";
import { FreeUntilBadge } from "#components/free-until-badge";
import { Message } from "#components/message";
import { episodeSaleDestination } from "#lib/app-payments";
import type { TenantSales } from "#lib/app-payments";
import type { EpisodeCampaign, EpisodePurchaseSurface } from "#lib/catalog";

/**
 * What is open on the episode until a moment — a free reading period, a
 * campaign price — and the zone that moment is written in. Neither is passed
 * without the zone, so a caller that has an end cannot leave it to be written
 * in a zone nobody chose.
 */
type DatedPriceProps =
  | { campaign?: undefined; freeUntil?: undefined; timeZone?: undefined }
  | {
      /** The campaign price open on the episode; absent when none is. */
      campaign?: EpisodeCampaign;
      /** RFC3339 end of the open free period; absent when none is open. */
      freeUntil?: string;
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
 * after that. One under a campaign quotes the campaign price beside the
 * regular one and says until when, for the same reason; a free period open
 * over a campaign still opens the episode to everyone, so it wins. A price is
 * quoted in the tenant's currency, and not at all while the tenant could not
 * be read: a number with no currency is no price.
 */
export const EpisodePrice = ({
  campaign,
  freeUntil,
  locale,
  price,
  purchaseSurface,
  sales,
  timeZone,
}: DatedPriceProps & {
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
        <Message message="storefront.common.free" />
      </Suspense>
    );
  }
  if (episodeSaleDestination(purchaseSurface, sales) === "app") {
    return (
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="storefront.common.sold_in_app" />
      </Suspense>
    );
  }
  if (!sales.currency) {
    return null;
  }
  if (campaign && timeZone) {
    return (
      <CampaignPrice
        campaign={campaign}
        currency={sales.currency}
        locale={locale}
        price={price}
        timeZone={timeZone}
      />
    );
  }
  return formatPrice(price, { currency: sales.currency, locale });
};
