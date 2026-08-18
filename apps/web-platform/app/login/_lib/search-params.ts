import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import { nextPathSearchParamSchema } from "#lib/auth-input";
import { SESSION_REVOKED_REASON } from "#lib/auth-shared";

interface ParseLoginSearchParamsInput {
  next?: SearchParamValue;
  reason?: SearchParamValue;
  reset?: SearchParamValue;
}

export interface LoginSearchParams {
  nextPath: string;
  passwordResetDone: boolean;
  sessionRevoked: boolean;
}

const loginSearchParamsSchema = z.object({
  next: nextPathSearchParamSchema,
  reason: searchParamEnum([SESSION_REVOKED_REASON], { fallback: "" }),
  reset: searchParamEnum(["done"], { fallback: "" }),
});

export const parseLoginSearchParams = (
  input: ParseLoginSearchParamsInput
): LoginSearchParams => {
  const parsed = loginSearchParamsSchema.parse(input);
  return {
    nextPath: parsed.next,
    passwordResetDone: parsed.reset === "done",
    sessionRevoked: parsed.reason === SESSION_REVOKED_REASON,
  };
};
