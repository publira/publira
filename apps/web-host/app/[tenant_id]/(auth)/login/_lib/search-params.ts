import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import {
  errorSearchParamSchema,
  returnToSearchParamSchema,
} from "#lib/auth-input";

interface ParseLoginSearchParamsInput {
  error?: SearchParamValue;
  reset?: SearchParamValue;
  returnTo?: SearchParamValue;
}

export interface LoginSearchParams {
  errorMessage?: string;
  resetDone: boolean;
  returnToPath: string;
}

const loginSearchParamsSchema = z.object({
  error: errorSearchParamSchema,
  reset: searchParamEnum(["done"], { fallback: "" }),
  returnTo: returnToSearchParamSchema,
});

export const parseLoginSearchParams = (
  input: ParseLoginSearchParamsInput
): LoginSearchParams => {
  const parsed = loginSearchParamsSchema.parse(input);
  return {
    errorMessage: parsed.error || undefined,
    resetDone: parsed.reset === "done",
    returnToPath: parsed.returnTo,
  };
};
