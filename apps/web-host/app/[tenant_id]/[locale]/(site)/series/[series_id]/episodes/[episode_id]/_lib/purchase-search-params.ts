import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

const checkoutStateSchema = searchParamEnum(
  ["cancelled", "error", "success"] as const,
  { fallback: "" }
);

const checkoutSessionIDSchema = searchParamString({
  fallback: "",
  maxLength: 255,
});

const purchaseSearchParamsSchema = z.object({
  checkout: checkoutStateSchema,
  session_id: checkoutSessionIDSchema,
});

export type PurchaseSearchParams = z.output<typeof purchaseSearchParamsSchema>;

export const parsePurchaseSearchParams = (
  input: unknown
): PurchaseSearchParams => purchaseSearchParamsSchema.parse(input);
