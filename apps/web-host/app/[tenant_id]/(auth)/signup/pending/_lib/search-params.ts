import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

import { emailSearchParamSchema } from "#lib/auth-input";

interface ParseSignupPendingSearchParamsInput {
  email?: SearchParamValue;
}

export interface SignupPendingSearchParams {
  email: string;
}

const signupPendingSearchParamsSchema = z.object({
  email: emailSearchParamSchema,
});

export const parseSignupPendingSearchParams = (
  input: ParseSignupPendingSearchParamsInput
): SignupPendingSearchParams => signupPendingSearchParamsSchema.parse(input);
