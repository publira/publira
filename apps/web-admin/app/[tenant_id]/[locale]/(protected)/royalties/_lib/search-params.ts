import { searchParamString } from "@publira/utils/search-params";
import { z } from "zod";

import { royaltyPeriodSchema } from "#lib/royalty-period";

const openMonthSearchParamsSchema = z.object({
  period: searchParamString({ fallback: "" }).transform((value) =>
    royaltyPeriodSchema.safeParse(value).success ? value : ""
  ),
});

export type OpenMonthSearchParams = z.output<
  typeof openMonthSearchParamsSchema
>;

/**
 * The month the operator asked for, or `""` when none was. Anything that is not
 * a `YYYY-MM` month falls back to the month the console picks by itself.
 */
export const parseOpenMonthSearchParams = (input: {
  period?: string | string[];
}): OpenMonthSearchParams => openMonthSearchParamsSchema.parse(input);
