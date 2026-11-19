import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

import { emailSearchParamSchema } from "#lib/auth-input";

interface ParseResetPasswordRequestedSearchParamsInput {
  email?: SearchParamValue;
}

export interface ResetPasswordRequestedSearchParams {
  email: string;
}

const resetPasswordRequestedSearchParamsSchema = z.object({
  email: emailSearchParamSchema,
});

export const parseResetPasswordRequestedSearchParams = (
  input: ParseResetPasswordRequestedSearchParamsInput
): ResetPasswordRequestedSearchParams =>
  resetPasswordRequestedSearchParamsSchema.parse(input);
