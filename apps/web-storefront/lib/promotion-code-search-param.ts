import { searchParamString } from "@publira/utils/search-params";

import { PROMOTION_CODE_MAX_LENGTH } from "./promotion-code";

/**
 * The promotion code the reader applied on a page, which the page quotes again
 * when it is reloaded. Longer than any code a tenant can hold is no code.
 */
export const promotionCodeSearchParamSchema = searchParamString({
  fallback: "",
  maxLength: PROMOTION_CODE_MAX_LENGTH,
});
