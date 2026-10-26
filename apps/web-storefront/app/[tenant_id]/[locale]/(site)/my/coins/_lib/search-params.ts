import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

/**
 * How the reader arrives back from buying a pack: `success` and `cancelled`
 * from the payment provider's checkout, `error` and `unavailable` from the
 * Action that could not start one.
 */
const checkoutStateSchema = searchParamEnum(
  ["cancelled", "error", "success", "unavailable"] as const,
  { fallback: "" }
);

/**
 * `/my/coins` shows one paginated list, the history, so the bare `token` is
 * unambiguous and reads the way it does on `/my`.
 */
const coinsSearchParamsSchema = z.object({
  checkout: checkoutStateSchema,
  token: cursorTokenSchema,
});

export type CoinsSearchParams = z.output<typeof coinsSearchParamsSchema>;

export const parseCoinsSearchParams = (input: unknown): CoinsSearchParams =>
  coinsSearchParamsSchema.parse(input);

/**
 * `/my/coins` at the history page the token names, which is where the pager
 * links and where a reader sent to sign in comes back to.
 */
export const coinsPageHref = (token: string): string =>
  cursorPageHref("/my/coins", token);

/** What the page hands its sections so each can resolve what it needs. */
export type CoinsPageSearchParams =
  PageProps<"/[tenant_id]/[locale]/my/coins">["searchParams"];
