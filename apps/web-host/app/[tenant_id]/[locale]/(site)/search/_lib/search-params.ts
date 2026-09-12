import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

import { SEARCH_QUERY_MAX_LENGTH } from "#lib/catalog";
import { cursorTokenSchema } from "#lib/cursor-token";

/**
 * Which of the three result groups the screen is showing. `all` is the
 * overview: a short preview of every group, so one keyword answers with series,
 * creators, and labels at once. The other three are that group on its own, which
 * is where the cursor pagination lives.
 */
export const searchKinds = ["all", "series", "creators", "labels"] as const;

export type SearchKind = (typeof searchKinds)[number];

/**
 * The group a URL that names none shows. It is also the one value the href
 * builder leaves out of the query string, so the overview a reader arrives on
 * has a single address rather than two that render the same page.
 */
export const DEFAULT_SEARCH_KIND: SearchKind = "all";

const searchPageSearchParamsSchema = z.object({
  kind: searchParamEnum(searchKinds, { fallback: DEFAULT_SEARCH_KIND }),
  q: searchParamString({
    fallback: "",
    maxLength: SEARCH_QUERY_MAX_LENGTH,
    truncate: true,
  }),
  token: cursorTokenSchema,
});

interface ParseSearchPageSearchParamsInput {
  kind?: SearchParamValue;
  q?: SearchParamValue;
  token?: SearchParamValue;
}

export interface SearchPageSearchParams {
  /** Which result group is on screen. */
  kind: SearchKind;
  /** Trimmed keyword. Empty when the page is showing the prompt. */
  query: string;
  /** Empty on the first result page, and on the overview, which has none. */
  token: string;
}

export const parseSearchPageSearchParams = (
  input: ParseSearchPageSearchParamsInput
): SearchPageSearchParams => {
  const parsed = searchPageSearchParamsSchema.parse(input);
  return {
    kind: parsed.kind,
    query: parsed.q,
    // The overview shows the head of three lists side by side and pages none of
    // them, so a token arriving with it names a position nothing on screen has.
    // Each group's own view is where a token means something.
    token: parsed.kind === DEFAULT_SEARCH_KIND ? "" : parsed.token,
  };
};

export const searchPageHref = (
  query: string,
  kind: SearchKind = DEFAULT_SEARCH_KIND,
  token = ""
): string => {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (kind !== DEFAULT_SEARCH_KIND) {
    params.set("kind", kind);
    if (token) {
      params.set("token", token);
    }
  }
  const serialized = params.toString();
  return serialized.length > 0 ? `/search?${serialized}` : "/search";
};
