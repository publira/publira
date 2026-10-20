import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTimeWithWeekday, formatPrice } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { EpisodeCampaign } from "#lib/catalog";

/**
 * What an episode costs while a campaign undercuts it: the campaign price, the
 * regular one struck through beside it, and "Sale until Sun, Oct 11,
 * 11:59 PM".
 *
 * The regular price stays on screen because the campaign is only worth
 * something against it, and it is what the episode costs again afterwards.
 * Strike-through is not announced by a screen reader, so the regular price
 * carries its name in words for one.
 *
 * The end is written in the tenant's time zone, as a free period's is, and as
 * an absolute date for the reason `FreeUntilBadge` gives: the page is a shared
 * cache entry, dropped when the campaign ends, which is what takes the badge
 * down.
 */
export const CampaignPrice = ({
  campaign,
  currency,
  locale,
  price,
  timeZone,
}: {
  campaign: EpisodeCampaign;
  /** The tenant's currency, which both prices are in. */
  currency: string;
  locale: Locale;
  /** The episode's regular price. */
  price: number;
  timeZone: string;
}) => (
  <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
    <span className="text-foreground">
      {formatPrice(campaign.price, { currency, locale })}
    </span>
    <s>
      <span className="sr-only">
        <Suspense fallback={null}>
          <Message message="storefront.common.regular_price" />
        </Suspense>{" "}
      </span>
      {formatPrice(price, { currency, locale })}
    </s>
    <Badge tone="info">
      <time dateTime={campaign.endsAt}>
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message
            message="storefront.common.campaign_until"
            values={{
              date: formatDateTimeWithWeekday(campaign.endsAt, {
                fallback: "",
                locale,
                timeZone,
              }),
            }}
          />
        </Suspense>
      </time>
    </Badge>
  </span>
);
