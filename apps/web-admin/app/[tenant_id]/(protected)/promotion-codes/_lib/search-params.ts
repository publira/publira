import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-page";
import { buildQueryString } from "#lib/query-string";

interface ParsePromotionCodeParamsInput {
  code?: SearchParamValue;
  edit?: SearchParamValue;
  redemptions?: SearchParamValue;
  token?: SearchParamValue;
}

export interface PromotionCodeParams {
  /** The code the drawer shows, or `""` while it is closed. */
  code: string;
  /** Whether the drawer shows the form that edits the code's limits. */
  edit: boolean;
  /** The page of the drawer's redemptions. */
  redemptions: string;
  /** The page of the list behind the drawer. */
  token: string;
}

/**
 * Every value falls back to the default view: an unusable query string still
 * renders the list instead of 404ing an operator out of it. A `code` that is
 * not a UUID leaves the drawer closed, since no code is addressed by anything
 * else.
 */
const promotionCodeParamsSchema = z.object({
  code: searchParamString({ fallback: "" }).transform((value) =>
    z.guid().safeParse(value).success ? value : ""
  ),
  edit: searchParamEnum(["1"], { fallback: "" }).transform(
    (value) => value === "1"
  ),
  redemptions: cursorTokenSchema,
  token: cursorTokenSchema,
});

export const parsePromotionCodeParams = (
  input: ParsePromotionCodeParamsInput
): PromotionCodeParams => promotionCodeParamsSchema.parse(input);

/**
 * The query string of the list on the page `token` names, with the drawer
 * open on `code`, on the page `redemptions` names of its redemptions, and on
 * its edit form while `edit` is set. A page link of the list closes the
 * drawer, and the drawer keeps the page of the list it was opened from.
 */
export const promotionCodeListQuery = ({
  code,
  edit,
  redemptions,
  token,
}: {
  code?: string;
  edit?: boolean;
  redemptions?: string;
  token?: string;
}): string =>
  buildQueryString({
    code,
    edit: edit ? "1" : undefined,
    redemptions,
    token,
  }) || "?";
