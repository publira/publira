import { startOfDayIsoString } from "@publira/utils";
import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamDate,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-page";
import { buildQueryString } from "#lib/query-string";

interface ParsePurchaseFiltersInput {
  email?: SearchParamValue;
  episode?: SearchParamValue;
  from?: SearchParamValue;
  purchase?: SearchParamValue;
  series?: SearchParamValue;
  to?: SearchParamValue;
  token?: SearchParamValue;
}

export interface PurchaseFilters {
  email: string;
  episode: string;
  /** The first day of the period, `YYYY-MM-DD`, or `""`. */
  from: string;
  /** The purchase the detail drawer shows, or `""` while it is closed. */
  purchase: string;
  series: string;
  /** The last day of the period, inclusive, `YYYY-MM-DD`, or `""`. */
  to: string;
  token: string;
}

/**
 * Every filter falls back to `""`, the "no filter" value: an unusable query
 * string still renders the default list instead of 404ing an operator out of
 * it. A `purchase` that is not a UUID leaves the drawer closed, since no
 * purchase is addressed by anything else.
 */
const purchaseFiltersSchema = z.object({
  email: searchParamString({ fallback: "" }),
  episode: searchParamString({ fallback: "" }),
  from: searchParamDate({ fallback: "" }),
  purchase: searchParamString({ fallback: "" }).transform((value) =>
    z.guid().safeParse(value).success ? value : ""
  ),
  series: searchParamString({ fallback: "" }),
  to: searchParamDate({ fallback: "" }),
  token: cursorTokenSchema,
});

export const parsePurchaseFilters = (
  input: ParsePurchaseFiltersInput
): PurchaseFilters => purchaseFiltersSchema.parse(input);

/**
 * The query string of the list under `filters`, on the page `token` names and
 * with the drawer open on `purchase`. A page link closes the drawer, and the
 * drawer keeps the page it was opened from.
 */
export const purchaseListQuery = (
  filters: PurchaseFilters,
  { purchase, token }: { purchase?: string; token?: string }
): string =>
  buildQueryString({
    email: filters.email,
    episode: filters.episode,
    from: filters.from,
    purchase,
    series: filters.series,
    to: filters.to,
    token,
  }) || "?";

/**
 * The period the filters name, as the instants ListPurchases takes: from the
 * start of the first day to the start of the day after the last, both in the
 * tenant's time zone, since the API reads the end as exclusive. `null` for a
 * period that ends before it starts, which matches no purchase and which the
 * API refuses.
 */
export const purchasePeriod = (
  filters: Pick<PurchaseFilters, "from" | "to">,
  timeZone: string
): { purchasedFrom: string; purchasedTo: string } | null => {
  if (
    filters.from &&
    filters.to &&
    Temporal.PlainDate.compare(filters.from, filters.to) > 0
  ) {
    return null;
  }

  return {
    purchasedFrom: startOfDayIsoString(filters.from, timeZone),
    purchasedTo: filters.to
      ? startOfDayIsoString(
          Temporal.PlainDate.from(filters.to).add({ days: 1 }).toString(),
          timeZone
        )
      : "",
  };
};
