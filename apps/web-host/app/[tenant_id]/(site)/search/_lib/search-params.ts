import { searchParamString } from "@publira/utils/search-params";
import { z } from "zod";

import { SEARCH_QUERY_MAX_LENGTH } from "#lib/catalog";
import { cursorTokenSchema } from "#lib/cursor-token";

const searchPageSearchParamsSchema = z.object({
  q: searchParamString({
    fallback: "",
    maxLength: SEARCH_QUERY_MAX_LENGTH,
    truncate: true,
  }),
  token: cursorTokenSchema,
});

interface ParseSearchPageSearchParamsInput {
  q?: string | string[] | undefined;
  token?: string | string[] | undefined;
}

export interface SearchPageSearchParams {
  /** Trimmed keyword. Empty when the page is showing the prompt. */
  query: string;
  /** Empty on the first result page. */
  token: string;
}

export const parseSearchPageSearchParams = (
  input: ParseSearchPageSearchParamsInput
): SearchPageSearchParams => {
  const parsed = searchPageSearchParamsSchema.parse(input);
  return { query: parsed.q, token: parsed.token };
};

export const searchPageHref = (query: string, token = ""): string => {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (token) {
    params.set("token", token);
  }
  const serialized = params.toString();
  return serialized.length > 0 ? `/search?${serialized}` : "/search";
};
