import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

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
  reset?: SearchParamValue;
}

export interface LoginSearchParams {
  defaultEmail: string;
  errorMessage?: string;
  invitedDone: boolean;
  nextPath: string;
  passwordResetDone: boolean;
}

const loginSearchParamsSchema = z.object({
  email: emailSearchParamSchema,
  error: errorSearchParamSchema,
  invited: searchParamEnum(["done"], { fallback: "" }),
  next: nextPathSearchParamSchema,
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
  };
};
