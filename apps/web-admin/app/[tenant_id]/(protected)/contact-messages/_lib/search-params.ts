import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-page";

import { CONTACT_MESSAGE_STATUSES } from "../contact-message-types";

interface ParseContactMessageFiltersInput {
  status?: SearchParamValue;
  token?: SearchParamValue;
}

export interface ContactMessageFilters {
  status: string;
  token: string;
}

const allowedStatusValues: ReadonlySet<string> = new Set(
  CONTACT_MESSAGE_STATUSES
);

/**
 * Both filters fall back to `""`, which is also the API's "no filter" value, so
 * a hand-edited query string still renders the whole inbox. The status set is
 * the API's own, so a value outside it never reaches an RPC that would answer
 * `invalid_argument` for it.
 */
const contactMessageFiltersSchema = z.object({
  status: searchParamEnum(allowedStatusValues, { fallback: "" }),
  token: cursorTokenSchema,
});

export const parseContactMessageFilters = (
  input: ParseContactMessageFiltersInput
): ContactMessageFilters => contactMessageFiltersSchema.parse(input);
