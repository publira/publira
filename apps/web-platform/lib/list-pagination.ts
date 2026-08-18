/**
 * Shared `limit` query schema for lists.
 *
 * An unusable or out-of-range value must not reach an RPC: it becomes the
 * default.
 */

import { searchParamEnum } from "@publira/utils/search-params";

export const DEFAULT_LIST_PAGE_SIZE = 20;

export const LIST_PAGE_SIZE_VALUES = ["10", "20", "50"] as const;

export const listLimitSearchParam = searchParamEnum(LIST_PAGE_SIZE_VALUES, {
  fallback: String(DEFAULT_LIST_PAGE_SIZE),
});
