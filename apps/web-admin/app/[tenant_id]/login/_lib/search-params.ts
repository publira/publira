import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import { SESSION_REVOKED_REASON } from "#lib/admin-auth-shared";
import {
  emailSearchParamSchema,
  errorSearchParamSchema,
  nextPathSearchParamSchema,
} from "#lib/auth-input";

interface ParseLoginSearchParamsInput {
  email?: SearchParamValue;
  error?: SearchParamValue;
  invited?: SearchParamValue;
  next?: SearchParamValue;
  reason?: SearchParamValue;
  reset?: SearchParamValue;
}

export interface LoginSearchParams {
  defaultEmail: string;
  errorMessage?: string;
  invitedDone: boolean;
  nextPath: string;
  passwordResetDone: boolean;
  sessionRevoked: boolean;
}

const loginSearchParamsSchema = z.object({
  email: emailSearchParamSchema,
  error: errorSearchParamSchema,
  invited: searchParamEnum(["done"], { fallback: "" }),
  next: nextPathSearchParamSchema,
  reason: searchParamEnum([SESSION_REVOKED_REASON], { fallback: "" }),
  reset: searchParamEnum(["done"], { fallback: "" }),
});

export const parseLoginSearchParams = (
  input: ParseLoginSearchParamsInput
): LoginSearchParams => {
  const parsed = loginSearchParamsSchema.parse(input);
  return {
    defaultEmail: parsed.email,
    errorMessage: parsed.error || undefined,
    invitedDone: parsed.invited === "done",
    nextPath: parsed.next,
    passwordResetDone: parsed.reset === "done",
    sessionRevoked: parsed.reason === SESSION_REVOKED_REASON,
  };
};
