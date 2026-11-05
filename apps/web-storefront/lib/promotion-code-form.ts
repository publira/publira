import {
  RPC_ERROR_REASON,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { z } from "zod";

import { PROMOTION_CODE_MAX_LENGTH } from "./promotion-code";

/**
 * The code a form posts: what the reader typed into the field, or what a
 * checkout button carries once a code applies to its sale. Empty, or absent,
 * is no code.
 */
export const promotionCodeFormSchema = z
  .string()
  .trim()
  .max(PROMOTION_CODE_MAX_LENGTH)
  .default("");

/** Whether a checkout was refused for the code it carried. */
export const refusedForPromotionCode = (cause: unknown): boolean =>
  [
    RPC_ERROR_REASON.promotionCodeAlreadyRedeemed,
    RPC_ERROR_REASON.promotionCodeExhausted,
    RPC_ERROR_REASON.promotionCodeExpired,
    RPC_ERROR_REASON.promotionCodeInvalid,
    RPC_ERROR_REASON.promotionCodeNotApplicable,
  ].some((reason) => rpcErrorHasReason(cause, reason));
