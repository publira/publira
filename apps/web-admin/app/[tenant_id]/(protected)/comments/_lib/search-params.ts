import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { COMMENT_STATUSES } from "../comment-types";

interface ParseCommentFiltersInput {
  episode?: SearchParamValue;
  series?: SearchParamValue;
  status?: SearchParamValue;
  token?: SearchParamValue;
}

export interface CommentFilters {
  episode: string;
  series: string;
  status: string;
  token: string;
}

const allowedStatusValues: ReadonlySet<string> = new Set(COMMENT_STATUSES);

/**
 * Every filter falls back to `""`, which is also the API's "no filter" value:
 * a query string an operator hand-edited into something unusable still renders
 * the whole queue instead of 404ing them out of the moderation screen.
 *
 * The status set is the API's own, so a value outside it never reaches the RPC
 * that would answer `invalid_argument` for it.
 */
const commentFiltersSchema = z.object({
  episode: searchParamString({ fallback: "" }),
  series: searchParamString({ fallback: "" }),
  status: searchParamEnum(allowedStatusValues, { fallback: "" }),
  token: searchParamString({ fallback: "" }),
});

export const parseCommentFilters = (
  input: ParseCommentFiltersInput
): CommentFilters => commentFiltersSchema.parse(input);
