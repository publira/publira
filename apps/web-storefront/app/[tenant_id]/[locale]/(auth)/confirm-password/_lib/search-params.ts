import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

import {
  authTokenSearchParamSchema,
  errorSearchParamSchema,
} from "#lib/auth-input";

interface ParseConfirmPasswordSearchParamsInput {
  error?: SearchParamValue;
  token?: SearchParamValue;
}

export interface ConfirmPasswordSearchParams {
  errorMessage?: string;
  token: string;
}

const confirmPasswordSearchParamsSchema = z.object({
  error: errorSearchParamSchema,
  token: authTokenSearchParamSchema,
});

export const parseConfirmPasswordSearchParams = (
  input: ParseConfirmPasswordSearchParamsInput
): ConfirmPasswordSearchParams => {
  const parsed = confirmPasswordSearchParamsSchema.parse(input);
  return {
    errorMessage: parsed.error || undefined,
    token: parsed.token,
  };
};
