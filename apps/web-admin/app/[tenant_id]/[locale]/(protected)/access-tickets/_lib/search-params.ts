import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamBoolean,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-page";

interface ParseAccessTicketFiltersInput {
  active?: SearchParamValue;
  episode?: SearchParamValue;
  token?: SearchParamValue;
  user?: SearchParamValue;
}

export interface AccessTicketFilters {
  active: boolean;
  episode: string;
  token: string;
  user: string;
}

/**
 * Every filter falls back to the "no filter" value this screen already uses:
 * an unusable query string still renders the default view instead of 404ing
 * an operator out of the ticket list.
 */
const accessTicketFiltersSchema = z.object({
  active: searchParamBoolean({ fallback: false }),
  episode: searchParamString({ fallback: "" }),
  token: cursorTokenSchema,
  user: searchParamString({ fallback: "" }),
});

export const parseAccessTicketFilters = (
  input: ParseAccessTicketFiltersInput
): AccessTicketFilters => accessTicketFiltersSchema.parse(input);
