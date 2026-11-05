import type { Locale } from "@publira/i18n";
import { formatPrice } from "@publira/utils";

import type { StorefrontMessageAccessor } from "#lib/messages";

/**
 * What a purchase cost: the amount paid and, where a promotion code took a
 * discount off, the price before it struck through beside it and the
 * tenant's code named under them. A discount taken on the payment provider's
 * own page names no code, since the tenant did not issue it.
 *
 * Strike-through is not announced by a screen reader, so the price before
 * the code carries its name in words for one, as a campaign's regular price
 * does.
 */
export const PaidPrice = ({
  currency,
  listPrice,
  locale,
  price,
  promotionCode,
  t,
}: {
  currency: string;
  /** The price before any code, equal to `price` where none discounted it. */
  listPrice: number;
  locale: Locale;
  price: number;
  /** The tenant's code the reader entered; empty where none was. */
  promotionCode: string;
  t: StorefrontMessageAccessor;
}) => {
  const paid = formatPrice(price, { currency, locale });

  if (listPrice <= price) {
    return paid;
  }

  return (
    <span className="inline-grid gap-0.5">
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span>{paid}</span>
        <s className="text-muted-foreground">
          <span className="sr-only">
            {t("storefront.promotion_code.list_price")}{" "}
          </span>
          {formatPrice(listPrice, { currency, locale })}
        </s>
      </span>
      {promotionCode ? (
        <span className="text-xs text-muted-foreground">
          {t("storefront.promotion_code.code", { code: promotionCode })}
        </span>
      ) : null}
    </span>
  );
};
