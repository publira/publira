import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import { nextPathSearchParamSchema } from "#lib/auth-input";

interface ParseLoginSearchParamsInput {
  next?: SearchParamValue;
  reset?: SearchParamValue;
}

export interface LoginSearchParams {
  nextPath: string;
  passwordResetDone: boolean;
}

const loginSearchParamsSchema = z.object({
  next: nextPathSearchParamSchema,
  reset: searchParamEnum(["done"], { fallback: "" }),
});

export const parseLoginSearchParams = (
  input: ParseLoginSearchParamsInput
): LoginSearchParams => {
  const parsed = loginSearchParamsSchema.parse(input);
  return {
    nextPath: parsed.next,
    passwordResetDone: parsed.reset === "done",
  };
};
