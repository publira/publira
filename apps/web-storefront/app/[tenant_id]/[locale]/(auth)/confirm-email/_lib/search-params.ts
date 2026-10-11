import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

import { authTokenSearchParamSchema } from "#lib/auth-input";

interface ParseConfirmEmailSearchParamsInput {
  token?: SearchParamValue;
}

export interface ConfirmEmailSearchParams {
  token: string;
}

const confirmEmailSearchParamsSchema = z.object({
  token: authTokenSearchParamSchema,
});

export const parseConfirmEmailSearchParams = (
  input: ParseConfirmEmailSearchParamsInput
): ConfirmEmailSearchParams => confirmEmailSearchParamsSchema.parse(input);
