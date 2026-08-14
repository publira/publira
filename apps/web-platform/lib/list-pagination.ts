/**
 * Shared `limit` / `offset` query schemas for offset-based lists.
 *
 * An unusable or out-of-range value must not reach an RPC: invalid input
 * becomes the default, and a number outside the bounds is clamped.
 */

import {
  searchParamEnum,
  searchParamNumber,
} from "@publira/utils/search-params";

export const DEFAULT_LIST_PAGE_SIZE = 20;

export const LIST_PAGE_SIZE_VALUES = ["10", "20", "50"] as const;

/** Far enough for real paging, tight enough that `?offset=1e9` never hits RPC. */
export const MAX_LIST_OFFSET = 10_000;

export const listLimitSearchParam = searchParamEnum(LIST_PAGE_SIZE_VALUES, {
  fallback: String(DEFAULT_LIST_PAGE_SIZE),
});

export const listOffsetSearchParam = searchParamNumber({
  clamp: true,
  fallback: 0,
  max: MAX_LIST_OFFSET,
  min: 0,
});
