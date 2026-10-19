import type { Locale } from "@publira/i18n";
import { Button } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatPercent, formatPrice } from "@publira/utils";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import type { TenantSales } from "#lib/app-payments";
import { getMySeriesPurchaseState } from "#lib/series-purchases";

import { startSeriesRemainderCheckoutAction } from "../_lib/actions";

/**
 * Every episode the reader does not hold yet, in one checkout: how many, what
 * they cost together, and what the series takes off buying them one by one.
 *
 * Member-specific — the quote leaves out what the reader already holds — so it
 * sits in a `<Suspense>` of its own above the episode list, and renders nothing
 * while the API quotes no sale: nothing left to buy, more left than one
 * checkout lists, or a reader credited on one of them. A read that failed says
 * so in place of the offer, since there is no price to quote without it.
 *
 * Offered only where the site takes payments and the tenant's currency is
 * known, so a site that sells nothing never asks what the reader holds.
 */
export const SeriesRemainderOffer = async ({
  locale,
  sales,
  seriesId,
  seriesPublicId,
  tenantId,
}: {
  locale: Locale;
  /** Where the tenant can sell right now, and in which currency. */
  sales: TenantSales;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
}) => {
  const { currency } = sales;
  if (!(sales.web && currency)) {
    return null;
  }

  const state = await getMySeriesPurchaseState(tenantId, seriesId, locale);

  if (!state.ok) {
    return <p className="text-sm text-muted-foreground">{state.message}</p>;
  }

  const { remainder } = state;
  if (!remainder) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <form action={startSeriesRemainderCheckoutAction}>
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />
        <input name="seriesId" type="hidden" value={seriesId} />
        <input name="seriesPublicId" type="hidden" value={seriesPublicId} />
        <Button type="submit" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message
              message="storefront.series.remainder_buy"
              values={{
                count: remainder.episodeCount,
                price: formatPrice(remainder.price, { currency, locale }),
              }}
            />
          </Suspense>
        </Button>
      </form>
      {remainder.discountPercent > 0 ? (
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message
              message="storefront.series.remainder_discount"
              values={{
                list_price: formatPrice(remainder.listPrice, {
                  currency,
                  locale,
                }),
                percent: formatPercent(remainder.discountPercent / 100, {
                  fractionDigits: 0,
                  locale,
                }),
              }}
            />
          </Suspense>
        </p>
      ) : null}
    </div>
  );
};
