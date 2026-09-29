import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

import { authTokenSearchParamSchema } from "#lib/auth-input";

interface ParseVerifySearchParamsInput {
  token?: SearchParamValue;
}

export interface VerifySearchParams {
  token: string;
}

const verifySearchParamsSchema = z.object({
  token: authTokenSearchParamSchema,
});

export const parseVerifySearchParams = (
  input: ParseVerifySearchParamsInput
): VerifySearchParams => verifySearchParamsSchema.parse(input);
