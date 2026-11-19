import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-page";
import { buildQueryString } from "#lib/query-string";

/** The statuses the delivery list can be narrowed to; `""` lists every one. */
export const DELIVERY_STATUS_FILTERS = ["failed", "dead"] as const;

export type DeliveryStatusFilter = (typeof DELIVERY_STATUS_FILTERS)[number];

export interface DeliveryFilters {
  status: DeliveryStatusFilter | "";
  token: string;
}

/**
 * An unknown status falls back to every delivery rather than 404ing the
 * whole page: the keys and the endpoints above the list do not depend on it.
 */
const deliveryFiltersSchema = z.object({
  status: searchParamEnum(DELIVERY_STATUS_FILTERS, { fallback: "" }),
  token: cursorTokenSchema,
});

export const parseDeliveryFilters = (input: {
  status?: SearchParamValue;
  token?: SearchParamValue;
}): DeliveryFilters => deliveryFiltersSchema.parse(input);

/**
 * The query string of the list under `status`, on the page `token` names. A
 * new status starts again from the first page, since a token belongs to the
 * filter it was issued under.
 */
export const deliveryListQuery = (
  status: DeliveryFilters["status"],
  token?: string
): string => buildQueryString({ status, token }) || "?";
