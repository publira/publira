import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

/**
 * Where the reader comes back from a checkout started on the series page: the
 * provider's return names the outcome, and the Actions name `error` when the
 * checkout could not be started. The volume or `remainder` the provider's
 * return also names is not read: the page says what the reader holds now
 * whichever of them was bought.
 */
const seriesCheckoutSearchParamsSchema = z.object({
  checkout: searchParamEnum(["cancelled", "error", "success"] as const, {
    fallback: "",
  }),
});

export type SeriesCheckoutSearchParams = z.output<
  typeof seriesCheckoutSearchParamsSchema
>;

export const parseSeriesCheckoutSearchParams = (
  input: unknown
): SeriesCheckoutSearchParams => seriesCheckoutSearchParamsSchema.parse(input);
