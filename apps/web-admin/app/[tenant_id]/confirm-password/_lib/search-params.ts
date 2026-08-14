import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import {
  authTokenSearchParamSchema,
  errorSearchParamSchema,
} from "#lib/auth-input";

interface ParseConfirmPasswordSearchParamsInput {
  error?: SearchParamValue;
  status?: SearchParamValue;
  token?: SearchParamValue;
}

export interface ConfirmPasswordSearchParams {
  errorMessage?: string;
  status: "expired" | "invalid" | "";
  token: string;
}

const confirmPasswordSearchParamsSchema = z.object({
  error: errorSearchParamSchema,
  status: searchParamEnum(["expired", "invalid"], { fallback: "" }),
  token: authTokenSearchParamSchema,
});

export const parseConfirmPasswordSearchParams = (
  input: ParseConfirmPasswordSearchParamsInput
): ConfirmPasswordSearchParams => {
  const parsed = confirmPasswordSearchParamsSchema.parse(input);
  return {
    errorMessage: parsed.error || undefined,
    status: parsed.status,
    token: parsed.token,
  };
};
