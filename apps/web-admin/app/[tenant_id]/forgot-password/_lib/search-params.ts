import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import {
  emailSearchParamSchema,
  errorSearchParamSchema,
} from "#lib/auth-input";

interface ParseForgotPasswordSearchParamsInput {
  email?: SearchParamValue;
  error?: SearchParamValue;
  requested?: SearchParamValue;
}

export interface ForgotPasswordSearchParams {
  defaultEmail: string;
  errorMessage?: string;
  requested: boolean;
}

const forgotPasswordSearchParamsSchema = z.object({
  email: emailSearchParamSchema,
  error: errorSearchParamSchema,
  requested: searchParamEnum(["done"], { fallback: "" }),
});

export const parseForgotPasswordSearchParams = (
  input: ParseForgotPasswordSearchParamsInput
): ForgotPasswordSearchParams => {
  const parsed = forgotPasswordSearchParamsSchema.parse(input);
  return {
    defaultEmail: parsed.email,
    errorMessage: parsed.error || undefined,
    requested: parsed.requested === "done",
  };
};
