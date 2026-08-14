import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

export const EDIT_TABS = ["basic", "eye-catch"] as const;

export type EditTab = (typeof EDIT_TABS)[number];

interface ParseEditTabInput {
  tab?: SearchParamValue;
}

const editTabSchema = z.object({
  tab: searchParamEnum(EDIT_TABS, { fallback: "basic" }),
});

/**
 * Series / label edit screens share one pair of tabs. An unknown, missing, or
 * conflicting `tab` falls back to the basic form so the operator still sees
 * the record instead of a 404.
 */
export const parseEditTab = (input: ParseEditTabInput): EditTab =>
  editTabSchema.parse(input).tab;
