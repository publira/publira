import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-page";

import { READER_STATUSES } from "../reader-types";

interface ParseReaderFiltersInput {
  q?: SearchParamValue;
  status?: SearchParamValue;
  token?: SearchParamValue;
}

export interface ReaderFilters {
  query: string;
  status: string;
  token: string;
}

const allowedStatusValues: ReadonlySet<string> = new Set(READER_STATUSES);

/**
 * Every filter falls back to `""`, which is also the API's "no filter" value,
 * so a hand-edited query string still renders the whole list. The status set
 * is the API's own, so a value outside it never reaches an RPC that would
 * answer `invalid_argument` for it.
 */
const readerFiltersSchema = z.object({
  q: searchParamString({ fallback: "" }),
  status: searchParamEnum(allowedStatusValues, { fallback: "" }),
  token: cursorTokenSchema,
});

export const parseReaderFilters = (
  input: ParseReaderFiltersInput
): ReaderFilters => {
  const parsed = readerFiltersSchema.parse(input);

  return { query: parsed.q, status: parsed.status, token: parsed.token };
};
