import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { COMMENT_REPORT_STATUSES, COMMENT_STATUSES } from "../comment-types";

interface ParseCommentFiltersInput {
  episode?: SearchParamValue;
  report_status?: SearchParamValue;
  report_token?: SearchParamValue;
  series?: SearchParamValue;
  status?: SearchParamValue;
  token?: SearchParamValue;
}

export interface CommentFilters {
  episode: string;
  /**
   * The report queue's own state filter, kept apart from the comment list's.
   *
   * It defaults to every state for the reason the comment list's does: a
   * decision is read back beside the reports still waiting, so a moderator
   * sees what they just did instead of watching the row disappear. The queue
   * offers "Waiting" as one click when only the outstanding work is wanted.
   */
  reportStatus: string;
  /** The report queue's own cursor, so the two lists page independently. */
  reportToken: string;
  series: string;
  status: string;
  token: string;
}

const allowedStatusValues: ReadonlySet<string> = new Set(COMMENT_STATUSES);
const allowedReportStatusValues: ReadonlySet<string> = new Set(
  COMMENT_REPORT_STATUSES
);

/**
 * Every filter falls back to `""`, which is also the API's "no filter" value:
 * a query string an operator hand-edited into something unusable still renders
 * the whole queue instead of 404ing them out of the moderation screen.
 *
 * The status sets are the API's own, so a value outside them never reaches the
 * RPC that would answer `invalid_argument` for it.
 *
 * The report queue carries a second state filter and a second cursor because
 * the screen holds two lists: one query parameter each would make paging the
 * comments reset the reports, and the reverse.
 */
const commentFiltersSchema = z.object({
  episode: searchParamString({ fallback: "" }),
  reportStatus: searchParamEnum(allowedReportStatusValues, { fallback: "" }),
  reportToken: searchParamString({ fallback: "" }),
  series: searchParamString({ fallback: "" }),
  status: searchParamEnum(allowedStatusValues, { fallback: "" }),
  token: searchParamString({ fallback: "" }),
});

export const parseCommentFilters = (
  input: ParseCommentFiltersInput
): CommentFilters =>
  commentFiltersSchema.parse({
    ...input,
    reportStatus: input.report_status,
    reportToken: input.report_token,
  });
