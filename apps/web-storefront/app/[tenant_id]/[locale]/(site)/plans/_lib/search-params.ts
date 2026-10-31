import { searchParamEnum } from "@publira/utils/search-params";
import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

/**
 * How the reader came back to the plan page: from leaving Stripe's checkout,
 * or from a checkout the subscribe Action could not start. Anything else is
 * the page as it is.
 */
const plansSearchParamsSchema = z.object({
  subscription: searchParamEnum(
    ["cancelled", "error", "unavailable"] as const,
    { fallback: "" }
  ),
});

interface ParsePlansSearchParamsInput {
  subscription?: SearchParamValue;
}

export type PlansSearchParams = z.output<typeof plansSearchParamsSchema>;

export const parsePlansSearchParams = (
  input: ParsePlansSearchParamsInput
): PlansSearchParams => plansSearchParamsSchema.parse(input);
