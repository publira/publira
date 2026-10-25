import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

/**
 * How the reader came back to `/my`: from paying Stripe's checkout of a plan
 * (`subscription=success`, which the API's return URL names), or from a
 * billing portal the Action could not open. Anything else is the page as it
 * is.
 */
const myNoticeSearchParamsSchema = z.object({
  billing: searchParamEnum(["error", "unavailable"] as const, { fallback: "" }),
  subscription: searchParamEnum(["success"] as const, { fallback: "" }),
});

export type MyNoticeSearchParams = z.output<typeof myNoticeSearchParamsSchema>;

export const parseMyNoticeSearchParams = (
  input: unknown
): MyNoticeSearchParams => myNoticeSearchParamsSchema.parse(input);
