import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

const checkoutStateSchema = searchParamEnum(
  ["cancelled", "error", "success"] as const,
  { fallback: "" }
);

const checkoutSessionIDSchema = searchParamString({
  fallback: "",
  maxLength: 255,
});

/** Set by the Action that spends a wait-for-free ticket, when it could not. */
const waitFreeStateSchema = searchParamEnum(["error"] as const, {
  fallback: "",
});

/**
 * Set by the pack checkout beside `checkout`: the public id of the pack the
 * reader was sent to buy, which tells a return from it apart from one from the
 * episode's own checkout.
 */
const coinPackSchema = searchParamString({ fallback: "", maxLength: 64 });

/** Set by the Actions that spend coins or buy them, when they could not. */
const coinsStateSchema = searchParamEnum(
  ["pack_error", "pack_unavailable", "pay_error", "price_changed"] as const,
  { fallback: "" }
);

const purchaseSearchParamsSchema = z.object({
  checkout: checkoutStateSchema,
  coin_pack: coinPackSchema,
  coins: coinsStateSchema,
  session_id: checkoutSessionIDSchema,
  wait_free: waitFreeStateSchema,
});

interface ParsePurchaseSearchParamsInput {
  checkout?: SearchParamValue;
  coin_pack?: SearchParamValue;
  coins?: SearchParamValue;
  session_id?: SearchParamValue;
  wait_free?: SearchParamValue;
}

export type PurchaseSearchParams = z.output<typeof purchaseSearchParamsSchema>;

export const parsePurchaseSearchParams = (
  input: ParsePurchaseSearchParamsInput
): PurchaseSearchParams => purchaseSearchParamsSchema.parse(input);
