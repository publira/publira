import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import {
  errorSearchParamSchema,
  returnToSearchParamSchema,
} from "#lib/auth-input";
import { SESSION_REVOKED_REASON } from "#lib/auth-shared";

interface ParseLoginSearchParamsInput {
  error?: SearchParamValue;
  reason?: SearchParamValue;
  reset?: SearchParamValue;
  returnTo?: SearchParamValue;
}

export interface LoginSearchParams {
  errorMessage?: string;
  resetDone: boolean;
  returnToPath: string;
  sessionRevoked: boolean;
}

const loginSearchParamsSchema = z.object({
  error: errorSearchParamSchema,
  reason: searchParamEnum([SESSION_REVOKED_REASON], { fallback: "" }),
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
    sessionRevoked: parsed.reason === SESSION_REVOKED_REASON,
  };
};
