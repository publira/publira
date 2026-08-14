import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamNumber } from "@publira/utils/search-params";
import { z } from "zod";

interface ParseAuthorsListSearchParamsInput {
  page?: SearchParamValue;
}

export interface AuthorsListSearchParams {
  page: number;
}

/**
 * Offset pages start at 1. An unusable `page` still has a meaningful default
 * view (the first page), so the schema never 404s.
 */
const authorsListSearchParamsSchema = z.object({
  page: searchParamNumber({ fallback: 1, min: 1 }),
});

export const parseAuthorsListSearchParams = (
  input: ParseAuthorsListSearchParamsInput
): AuthorsListSearchParams => authorsListSearchParamsSchema.parse(input);
